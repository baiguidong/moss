import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { runInKeyedQueue } from './shared/keyed-queue.mjs';
import { PERMISSION_MODES } from './permission-modes.mjs';
import { parseAppServiceKey } from '../../packages/app-sdk/src/tool-services.mjs';
import { normalizeProjectIcon } from '../../shared/project-icon.mjs';

const editable = new Set(['awaiting_confirmation', 'awaiting_authorization', 'failed', 'cancelled', 'installing', 'creating']);
const list = (value, max = 100) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max || value.some(id => typeof id !== 'string' || !id.trim() || id.length > 500)) throw new Error('资源或目录列表无效。');
  return [...new Set(value.map(id => id.trim()))];
};
const message = error => error instanceof Error ? error.message : String(error);

export function normalizeCreationPlan(input) {
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) throw new Error('项目名称应为 1–80 个字符。');
  if (input.instructions != null && (typeof input.instructions !== 'string' || input.instructions.length > 20000)) throw new Error('项目指令过长或无效。');
  if (input.firstTask != null && (typeof input.firstTask !== 'string' || input.firstTask.length > 12000)) throw new Error('首个任务过长或无效。');
  if (input.mode != null && !['chat', 'boss'].includes(input.mode)) throw new Error('会话模式无效。');
  if (input.permissionMode != null && !PERMISSION_MODES.includes(input.permissionMode)) throw new Error('权限模式无效。');
  if (input.agentTeamsEnabled != null && typeof input.agentTeamsEnabled !== 'boolean') throw new Error('协作配置无效。');
  const workspaces = list(input.workspaces ?? (input.workspace ? [input.workspace] : []), 8);
  if (workspaces.some(directory => !path.isAbsolute(directory))) throw new Error('工作目录必须是绝对路径。');
  const workspace = input.workspace || workspaces[0] || null;
  if (workspace && !workspaces.includes(workspace)) throw new Error('默认目录必须属于项目工作目录。');
  const skillIds = list(input.skillIds, 50), expertIds = list(input.expertIds, 10), appIds = list(input.appIds, 50), appServiceIds = list(input.appServiceIds);
  if (appServiceIds.some(id => !parseAppServiceKey(id))) throw new Error('App 服务选择无效。');
  const assistantName = input.assistantName ?? null;
  if (assistantName !== null && (typeof assistantName !== 'string' || (assistantName && !expertIds.includes(assistantName)))) throw new Error('默认专家必须来自已选专家。');
  return {
    project: { name: input.name.trim(), icon: normalizeProjectIcon(input.icon, { strict: true }), instructions: input.instructions || '', workspaces, workspace, defaultWorkspace: workspace,
      mode: input.mode || 'boss', permissionMode: input.permissionMode || 'default', agentTeamsEnabled: input.agentTeamsEnabled !== false,
      assistantName, appServiceIds },
    refs: [ ...skillIds.map(id => ({ kind: 'skill', id })), ...expertIds.map(id => ({ kind: 'expert', id })),
      ...[...new Set([...appIds, ...appServiceIds.map(id => parseAppServiceKey(id).appId)])].map(id => ({ kind: 'app', id })) ],
    firstTask: input.firstTask?.trim() || null,
  };
}

/** Only confirm() can install or create. Model tools can read and propose plans. */
export function createProjectCreationService({ directory, assertSession, resources, createProject, readProject,
  startFirstTask, emit = () => {}, validateWorkspace = async () => {} }) {
  const queue = new Map();
  const file = id => {
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id || '')) throw new Error('项目草稿 ID 无效。');
    return path.join(directory, `${id}.json`);
  };
  async function read(id) {
    try { const draft = JSON.parse(await fs.readFile(file(id), 'utf8')); return draft.id === id ? draft : null; }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function save(draft) {
    draft.updatedAt = Math.max(Date.now(), (draft.updatedAt || 0) + 1);
    await fs.mkdir(directory, { recursive: true });
    const temporary = `${file(draft.id)}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(draft, null, 2), { mode: 0o600 }); await fs.rename(temporary, file(draft.id)); }
    finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
    emit(structuredClone(draft));
    return draft;
  }
  async function get({ draftId, sessionId } = {}) {
    if (sessionId) {
      await assertSession(sessionId);
      // Also reads drafts written by the earlier preview implementation.
      const names = await fs.readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      const drafts = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => read(name.slice(0, -5))));
      return drafts.filter(draft => draft?.sessionId === sessionId).sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
    }
    const draft = await read(draftId);
    if (draft) await assertSession(draft.sessionId);
    return draft;
  }
  async function requireDraft(id, version) {
    const draft = await get({ draftId: id });
    if (!draft) throw new Error('项目创建草稿不存在。');
    if (!Number.isInteger(version) || version !== draft.version) throw new Error('项目方案已发生变化，请查看最新方案后重新确认。');
    return draft;
  }
  async function ensureEditable(draft) {
    if (draft?.reservedProjectId && await readProject(draft.reservedProjectId)) throw new Error('项目已经创建，请点击继续创建恢复结果。');
    if (draft && (!editable.has(draft.status) || draft.createdProjectId)) throw new Error('项目正在创建或已经创建，不能修改此方案。');
  }
  function toInput(draft) {
    return { ...draft.project, firstTask: draft.firstTask,
      ...Object.fromEntries(['skill', 'expert', 'app'].map(kind => [`${kind}Ids`, draft.resources.filter(item => item.kind === kind).map(item => item.id)])) };
  }
  async function proposeNow(input, sessionId, previous) {
    await ensureEditable(previous);
    const plan = normalizeCreationPlan(input);
    for (const directory of plan.project.workspaces) await validateWorkspace(directory);
    const selected = [];
    for (const ref of plan.refs) selected.push(await resources.inspect(ref));
    return save({ id: previous?.id || randomUUID(), sessionId, version: (previous?.version || 0) + 1,
      status: 'awaiting_confirmation', project: plan.project, resources: selected, firstTask: plan.firstTask,
      createdProjectId: null, error: null, createdAt: previous?.createdAt || Date.now(), updatedAt: previous?.updatedAt || 0 });
  }
  async function propose(input, sessionId) {
    await assertSession(sessionId);
    const existing = await get({ sessionId });
    if (existing && queue.has(existing.id)) throw new Error('项目正在创建，请等待完成。');
    return runInKeyedQueue(queue, `session:${sessionId}`, async () => {
      const previous = await get({ sessionId });
      if (previous && queue.has(previous.id)) throw new Error('项目正在创建，请等待完成。');
      return runInKeyedQueue(queue, previous?.id || sessionId, async () => {
        const latest = previous ? await get({ draftId: previous.id }) : null;
        if (latest && input.version !== latest.version) throw new Error('方案版本已变化，请先读取最新草稿。');
        return proposeNow(input, sessionId, latest);
      });
    });
  }
  async function update({ draftId, version, patch = {} }) {
    if (queue.has(draftId)) throw new Error('项目正在创建，请等待完成。');
    return runInKeyedQueue(queue, draftId, async () => {
      const draft = await requireDraft(draftId, version);
      const input = { ...toInput(draft), ...patch };
      if ('workspace' in patch && !('workspaces' in patch)) input.workspaces = patch.workspace ? [patch.workspace] : [];
      return proposeNow(input, draft.sessionId, draft);
    });
  }
  async function cancel({ draftId, version }) {
    if (queue.has(draftId)) throw new Error('项目正在创建，请等待当前操作完成后取消。');
    return runInKeyedQueue(queue, draftId, async () => {
      const draft = await requireDraft(draftId, version);
      await ensureEditable(draft);
      return { ok: true, draft: await save({ ...draft, status: 'cancelled', version: draft.version + 1 }) };
    });
  }
  async function finish(draft, project) {
    draft.status = 'completed';
    draft.error = null;
    draft.pendingActions = [];
    draft.createdProjectId = project.id;
    await save(draft); // Project identity survives first-task failures.
    if (draft.firstTask && !draft.firstTaskSessionId && !draft.firstTaskError) {
      try {
        const result = await startFirstTask(project, draft);
        draft.firstTaskSessionId = result.sessionId;
        draft.firstTaskError = result.error || null;
      } catch (error) { draft.firstTaskError = message(error); }
      await save(draft);
    }
    return { status: draft.status, project, draft };
  }
  async function confirm({ draftId, version }) {
    return runInKeyedQueue(queue, draftId, async () => {
      const draft = await requireDraft(draftId, version);
      if (draft.status === 'cancelled') throw new Error('此方案已取消，请修改方案后重新确认。');
      if (draft.createdProjectId) {
        const project = await readProject(draft.createdProjectId);
        if (!project || project.archivedAt) throw new Error('已创建的项目已删除。');
        return finish(draft, project);
      }
      draft.reservedProjectId ||= `draft-${draft.id}`;
      // A crash after writing project.json must not duplicate the project or its first task.
      const recovered = await readProject(draft.reservedProjectId);
      if (recovered?.archivedAt) throw new Error('已创建的项目已删除。');
      if (recovered) return finish(draft, recovered);
      draft.error = null;
      draft.status = 'installing';
      await save(draft);
      try {
        for (const directory of draft.project.workspaces) await validateWorkspace(directory);
        const snapshot = await Promise.all(draft.resources.map(selected => resources.inspect({ kind: selected.kind, id: selected.id })));
        if (snapshot.some((current, index) => current.fingerprint !== draft.resources[index].fingerprint)) {
          draft.resources = snapshot; draft.version++; draft.status = 'awaiting_confirmation';
          draft.error = '所选资源已变化，请检查最新资源和安装计划后重新确认。';
          await save(draft);
          return { status: draft.status, draft };
        }
        for (let index = 0; index < draft.resources.length; index++) {
          const selected = draft.resources[index];
          // Check exact identity/version before installing; never resolve by display name.
          const current = await resources.inspect({ kind: selected.kind, id: selected.id });
          if (!selected.fingerprint || current.fingerprint !== selected.fingerprint) {
            draft.resources[index] = current;
            draft.version++;
            draft.status = 'awaiting_confirmation';
            draft.error = `资源“${current.displayName}”已变化，请检查新版本并重新确认。`;
            await save(draft);
            return { status: draft.status, draft };
          }
          if (!current.installed) {
            selected.status = 'installing'; await save(draft);
            await resources.install(selected);
          }
          const installed = await resources.inspect({ kind: selected.kind, id: selected.id });
          if (!installed.installed) throw new Error(`资源“${selected.displayName}”安装未完成。`);
          if (selected.version && installed.version && selected.version !== installed.version) throw new Error(`资源“${selected.displayName}”的安装版本与方案不一致，请修改方案后重试。`);
          // Persist the actual installation identity so resuming skips completed steps.
          draft.resources[index] = installed;
          await save(draft);
        }
        // Recheck earlier selections after slower installs: another window may
        // have disabled, replaced or removed them while this operation waited.
        for (let index = 0; index < draft.resources.length; index++) {
          const selected = draft.resources[index];
          const current = await resources.inspect({ kind: selected.kind, id: selected.id });
          if (!current.installed || current.fingerprint !== selected.fingerprint) {
            draft.resources[index] = current;
            draft.status = 'awaiting_confirmation'; draft.version++;
            draft.error = `资源“${current.displayName}”在准备期间发生变化，请重新检查方案。`;
            await save(draft);
            return { status: draft.status, draft };
          }
        }
        const pending = await resources.validate(draft);
        if (pending.length) {
          draft.status = 'awaiting_authorization'; draft.pendingActions = pending;
          await save(draft);
          return { status: draft.status, draft };
        }
        await assertSession(draft.sessionId);
        draft.status = 'creating'; draft.pendingActions = []; await save(draft);
        const payload = { ...draft.project,
          skillIds: draft.resources.filter(item => item.kind === 'skill').map(item => item.runtimeId || item.id),
          expertIds: draft.resources.filter(item => item.kind === 'expert').map(item => item.runtimeId || item.id),
          appIds: draft.resources.filter(item => item.kind === 'app' && item.toolSelection !== 'services').map(item => item.id),
        };
        if (payload.assistantName) payload.assistantName = draft.resources.find(item => item.kind === 'expert' && item.id === payload.assistantName)?.runtimeId || payload.assistantName;
        const project = await createProject(payload, { id: draft.reservedProjectId, draftId: draft.id, resources: draft.resources });
        return finish(draft, project);
      } catch (error) {
        draft.status = 'failed'; draft.error = message(error);
        for (const resource of draft.resources) if (resource.status === 'installing') resource.status = 'failed';
        await save(draft);
        return { status: draft.status, draft };
      }
    });
  }
  async function reportFirstTaskError(draftId, error) {
    return runInKeyedQueue(queue, draftId, async () => {
      const draft = await get({ draftId });
      if (draft?.status === 'completed') await save({ ...draft, firstTaskError: message(error) });
    });
  }
  return { get, propose, update, cancel, confirm, reportFirstTaskError };
}
