import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const OPERATION_DRAFT_STATUSES = Object.freeze([
  'draft', 'ready', 'executing', 'succeeded', 'failed', 'unknown', 'cancelled', 'expired',
]);

const MAX_DRAFTS = 200;
const MAX_CONTENT_LENGTH = 200_000;
const MAX_RESULT_LENGTH = 32_000;
const EDITABLE = new Set(['draft', 'ready', 'failed']);
const TERMINAL = new Set(['succeeded', 'cancelled', 'expired']);

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeActionRefs(value = {}) {
  const refs = {};
  for (const key of ['resolveTarget', 'validateDraft', 'execute', 'queryResult']) {
    const ref = text(value[key], 300);
    if (ref) refs[key] = ref;
  }
  return refs;
}

function normalizeDraft(input = {}, now = Date.now()) {
  const id = text(input.draftId || input.id, 160) || randomUUID();
  const createdAt = Number(input.createdAt) || now;
  const status = OPERATION_DRAFT_STATUSES.includes(input.status) ? input.status : 'draft';
  const content = text(input.content, MAX_CONTENT_LENGTH);
  if (!content) throw new Error('草稿内容不能为空。');
  const target = input.target && typeof input.target === 'object' ? clone(input.target) : {};
  const attachments = Array.isArray(input.attachments)
    ? input.attachments.slice(0, 20).map(item => ({
      name: text(item?.name, 160), uri: text(item?.uri || item?.path, 2_000),
    })).filter(item => item.name || item.uri)
    : [];
  return {
    id,
    draftId: id,
    appId: text(input.appId, 200),
    appVersion: text(input.appVersion, 120) || null,
    owner: input.owner && typeof input.owner === 'object' ? clone(input.owner) : null,
    instanceId: text(input.instanceId, 200) || null,
    channel: text(input.channel, 120) || 'unknown',
    accountId: text(input.accountId, 240) || null,
    accountLabel: text(input.accountLabel, 240) || null,
    title: text(input.title, 240) || '草稿箱',
    summary: text(input.summary, 1_000) || '等待检查后执行',
    target,
    content,
    attachments,
    baseVersion: text(input.baseVersion, 240) || null,
    revision: Math.max(1, Number(input.revision) || 1),
    status,
    idempotencyKey: text(input.idempotencyKey, 240) || `draft:${id}`,
    expiresAt: Number(input.expiresAt) || now + 24 * 60 * 60 * 1_000,
    createdAt,
    updatedAt: Number(input.updatedAt) || now,
    resultRef: input.resultRef ? clone(input.resultRef) : null,
    error: text(input.error, 4_000) || null,
    actionRefs: normalizeActionRefs(input.actionRefs),
    metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {},
  };
}

function toPublicDraft(draft) {
  return clone(draft);
}

async function readStore(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(value) ? value.map(item => normalizeDraft(item, item.createdAt || Date.now())) : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeStore(filePath, drafts) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(drafts, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

function assertRevision(draft, expectedRevision) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== draft.revision) {
    throw new Error(`草稿已被更新，请刷新后再操作（当前 revision ${draft.revision}）。`);
  }
}

function normalizeResult(value) {
  // Only an explicit receipt proves completion. Missing/malformed responses are uncertain.
  const status = ['succeeded', 'failed', 'unknown'].includes(value?.status) ? value.status : 'unknown';
  const raw = value?.result ?? value?.data ?? value ?? null;
  const serialized = JSON.stringify(raw);
  const result = serialized.length > MAX_RESULT_LENGTH
    ? { truncated: true, summary: serialized.slice(0, MAX_RESULT_LENGTH) }
    : raw && typeof raw === 'object' ? clone(raw) : { value: raw };
  return { status, result };
}

function assertActionScope(draft) {
  for (const ref of Object.values(draft.actionRefs)) {
    if (!ref.startsWith(`${draft.appId}/`) || ref.length <= draft.appId.length + 1) {
      throw new Error('草稿操作必须属于绑定的 App。');
    }
  }
}

export function createOperationDraftService({ filePath, getRuntime = () => null, onChanged = () => {}, now = () => Date.now() }) {
  if (!filePath) throw new Error('Operation draft store path is required.');
  let initialized = false;
  let queue = Promise.resolve();
  async function load() {
    const drafts = await readStore(filePath);
    let changed = false;
    for (const draft of drafts) {
      if (!initialized && draft.status === 'executing') {
        draft.status = 'unknown';
        draft.error = 'Moss 重启前的执行结果未确认，请查询结果。';
        draft.updatedAt = now(); draft.revision += 1; changed = true;
      } else if (EDITABLE.has(draft.status) && draft.expiresAt <= now()) {
        draft.status = 'expired'; draft.updatedAt = now(); draft.revision += 1; changed = true;
      }
    }
    if (changed) await writeStore(filePath, drafts);
    initialized = true;
    return drafts;
  }
  const transact = operation => {
    const run = queue.then(operation, operation);
    queue = run.catch(() => {});
    return run;
  };
  const emit = (reason, draft = null) => {
    void Promise.resolve().then(() => onChanged({ reason, draft: draft ? toPublicDraft(draft) : null })).catch(() => {});
  };

  async function list() {
    return transact(async () => (await load()).sort((a, b) => b.updatedAt - a.updatedAt).map(toPublicDraft));
  }

  async function create(input = {}) {
    return transact(async () => {
      const timestamp = now();
      const runtime = getRuntime();
      const pkg = await runtime?.getActivePackage?.(input.appId);
      const draft = normalizeDraft({ ...input, appVersion: pkg?.manifest?.version || null, owner: input.owner || runtime?.currentOwner?.(), status: 'draft', revision: 1, idempotencyKey: `draft:${randomUUID()}`, resultRef: null, error: null, createdAt: timestamp, updatedAt: timestamp }, timestamp);
      assertActionScope(draft);
      if (!draft.appId) throw new Error('草稿必须绑定 App。');
      const drafts = await load();
      if (drafts.some(item => item.id === draft.id)) throw new Error('草稿 ID 已存在。');
      while (drafts.length >= MAX_DRAFTS) {
        const index = drafts.findIndex(item => TERMINAL.has(item.status));
        if (index < 0) throw new Error('未处理草稿已达上限，请先处理现有草稿。');
        drafts.splice(index, 1);
      }
      drafts.push(draft);
      await writeStore(filePath, drafts);
      emit('created', draft);
      return toPublicDraft(draft);
    });
  }

  async function update({ draftId, expectedRevision, patch = {} } = {}) {
    return transact(async () => {
      const drafts = await load();
      const draft = drafts.find(item => item.id === draftId);
      if (!draft) throw new Error('草稿不存在。');
      assertRevision(draft, expectedRevision);
      if (!EDITABLE.has(draft.status)) throw new Error('当前草稿已进入执行生命周期，不能编辑。');
      const allowed = ['title', 'summary', 'accountId', 'accountLabel', 'target', 'content', 'attachments', 'baseVersion', 'metadata'];
      for (const key of allowed) if (patch[key] !== undefined) draft[key] = clone(patch[key]);
      if (!text(draft.content, MAX_CONTENT_LENGTH)) throw new Error('草稿内容不能为空。');
      Object.assign(draft, normalizeDraft(draft, now()));
      draft.revision += 1;
      draft.idempotencyKey = `draft:${randomUUID()}`;
      draft.resultRef = null;
      draft.status = 'draft';
      draft.error = null;
      draft.updatedAt = now();
      await writeStore(filePath, drafts);
      emit('updated', draft);
      return toPublicDraft(draft);
    });
  }

  async function cancel({ draftId, expectedRevision } = {}) {
    return transact(async () => {
      const drafts = await load();
      const draft = drafts.find(item => item.id === draftId);
      if (!draft) throw new Error('草稿不存在。');
      assertRevision(draft, expectedRevision);
      if (!EDITABLE.has(draft.status)) throw new Error('当前草稿不能取消，请先核实执行结果。');
      draft.status = 'cancelled'; draft.updatedAt = now(); draft.revision += 1;
      await writeStore(filePath, drafts); emit('cancelled', draft); return toPublicDraft(draft);
    });
  }

  async function invokeAction(draft, ref, input) {
    if (!ref) throw new Error('草稿缺少必要的 App 操作。');
    assertActionScope(draft);
    const runtime = getRuntime();
    if (!runtime) throw new Error('App Runtime 尚未就绪。');
    const authorizeDispatch = () => {
      if (draft.owner?.key && runtime.currentOwner?.()?.key !== draft.owner.key) throw new Error('草稿所属账号已变化，请重新生成。');
      if (ref !== draft.actionRefs.queryResult && draft.appVersion && runtime.installations?.get(draft.appId)?.activeVersion !== draft.appVersion) throw new Error('App 版本已更新，请重新生成草稿后确认。');
    };
    authorizeDispatch();
    return runtime.invokeCommandContribution(ref, input, {
      authorizeDispatch,
      instanceId: draft.instanceId || undefined,
      requestId: `${draft.id}:${draft.revision}:${randomUUID()}`,
      invocation: { surface: 'app', origin: 'operation-draft' },
    });
  }

  async function confirm({ draftId, expectedRevision } = {}) {
    let claimed;
    await transact(async () => {
      const drafts = await load();
      const draft = drafts.find(item => item.id === draftId);
      if (!draft) throw new Error('业务操作草稿不存在。');
      assertRevision(draft, expectedRevision);
      if (draft.status === 'succeeded') { claimed = toPublicDraft(draft); return; }
      if (draft.status === 'executing') throw new Error('草稿正在执行，请稍候。');
      if (draft.status === 'unknown') throw new Error('草稿执行结果未知，请先查询结果，不能重复执行。');
      if (!EDITABLE.has(draft.status)) throw new Error('草稿已取消或过期，请重新生成。');
      if (!draft.accountId || !Object.keys(draft.target).length || draft.channel === 'unknown') throw new Error('请先在来源 App 确认账号、渠道和目标。');
      if (!draft.actionRefs.execute || !draft.actionRefs.validateDraft) throw new Error('草稿尚未绑定校验和执行操作。');
      assertActionScope(draft);
      draft.status = 'executing'; draft.updatedAt = now(); draft.error = null;
      await writeStore(filePath, drafts); emit('executing', draft); claimed = toPublicDraft(draft);
    });
    if (claimed?.status === 'succeeded') return claimed;
    const draft = claimed;
    let dispatched = false;
    try {
      const validation = await invokeAction(draft, draft.actionRefs.validateDraft, { draft });
      if (validation?.ok === false || validation?.valid === false || (validation?.ok !== true && validation?.valid !== true)) throw new Error(text(validation?.error, 2_000) || 'App 校验未通过。');
      dispatched = true;
      const result = normalizeResult(await invokeAction(draft, draft.actionRefs.execute, { draft, idempotencyKey: draft.idempotencyKey }));
      return transact(async () => {
        const drafts = await load(); const current = drafts.find(item => item.id === draft.id);
        if (!current) throw new Error('草稿已被删除。');
        current.status = result.status; current.resultRef = result.result && typeof result.result === 'object' ? clone(result.result) : { value: result.result };
        current.error = result.status === 'failed' ? text(result.result?.error, 4_000) || 'App 执行失败。' : null;
        current.updatedAt = now(); current.revision += 1;
        await writeStore(filePath, drafts); emit(result.status, current); return toPublicDraft(current);
      });
    } catch (error) {
      return transact(async () => {
        const drafts = await load(); const current = drafts.find(item => item.id === draft.id);
        if (!current) throw error;
        current.status = dispatched ? 'unknown' : 'failed'; current.error = text(error?.message || error, 4_000); current.updatedAt = now(); current.revision += 1;
        await writeStore(filePath, drafts); emit(current.status, current); throw error;
      });
    }
  }

  async function queryResult({ draftId } = {}) {
    const draft = await transact(async () => (await load()).find(item => item.id === draftId));
    if (!draft) throw new Error('草稿不存在。');
    if (draft.status !== 'unknown') return toPublicDraft(draft);
    if (!draft.actionRefs.queryResult) throw new Error('此 App 尚不支持查询，请在来源系统核实结果；不要重复执行。');
    const result = normalizeResult(await invokeAction(draft, draft.actionRefs.queryResult, { draft, idempotencyKey: draft.idempotencyKey }));
    return transact(async () => {
      const drafts = await load(); const current = drafts.find(item => item.id === draftId);
      if (!current) throw new Error('草稿不存在。');
      if (current.revision !== draft.revision || current.status !== 'unknown') return toPublicDraft(current);
      current.status = result.status; current.resultRef = clone(result.result);
      current.error = result.status === 'failed' ? text(result.result?.error, 4_000) || 'App 执行失败。' : null;
      current.updatedAt = now(); current.revision += 1;
      await writeStore(filePath, drafts); emit('queried', current); return toPublicDraft(current);
    });
  }

  return { list, create, update, cancel, confirm, queryResult, get: async ({ draftId } = {}) => (await list()).find(item => item.id === draftId) || null };
}
