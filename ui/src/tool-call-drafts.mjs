import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { compileJsonSchema } from '../../packages/app-sdk/src/index.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
const waiting = draft => draft.status === 'draft';
const errorText = error => String(error?.message || error).slice(0, 4000);
function validateArgs(schema, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args) || JSON.stringify(args).length > 200_000) throw new Error('工具参数必须是有效的 JSON 对象，且不超过 200 KB。');
  const validate = compileJsonSchema(schema);
  if (!validate(args)) throw new Error(`参数不符合工具要求：${JSON.stringify(validate.errors).slice(0, 2000)}`);
}

/** Durable snapshots plus live continuations. A restart never replays an old tool call. */
export function createToolCallDraftService({ filePath, currentOwner, onChanged = () => {}, now = Date.now }) {
  let queue = Promise.resolve(), initialized = false;
  const active = new Map();
  const transaction = fn => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const emit = draft => { void Promise.resolve().then(() => onChanged({ reason: draft.status, draft: clone(draft) })).catch(() => {}); };
  async function write(drafts) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, JSON.stringify(drafts), { mode: 0o600 }); await fs.rename(temporary, filePath); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  async function read() {
    let drafts;
    try { drafts = JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; drafts = []; }
    if (!Array.isArray(drafts)) throw new Error('Invalid tool draft store');
    if (!initialized) {
      for (const draft of drafts) {
        if (draft.status === 'executing' || waiting(draft)) {
          draft.error = draft.status === 'executing' ? 'Moss 重启前的调用结果未确认，请到来源系统核实，勿重复执行。' : 'Moss 已重启，原工具调用已结束，请在会话中重新发起。';
          draft.status = draft.status === 'executing' ? 'unknown' : 'expired';
          draft.revision++; draft.updatedAt = now();
        }
      }
      await write(drafts); initialized = true;
    }
    return drafts;
  }
  function own(draft) {
    if (!draft || draft.ownerKey !== currentOwner()) throw new Error('草稿不存在或不属于当前账号。');
    return draft;
  }
  function revision(draft, expected) {
    if (!Number.isSafeInteger(expected) || draft.revision !== expected) throw new Error('草稿已更新，请刷新后重新确认。');
  }
  const list = () => transaction(async () => (await read()).filter(d => d.ownerKey === currentOwner()).sort((a, b) => b.updatedAt - a.updatedAt).map(clone));
  const get = async ({ draftId }) => (await list()).find(d => d.id === draftId) || null;
  async function update({ draftId, expectedRevision, patch = {} }) {
    return transaction(async () => {
      const drafts = await read(), draft = own(drafts.find(d => d.id === draftId)); revision(draft, expectedRevision);
      if (!waiting(draft) || !active.has(draftId)) throw new Error('原调用已结束，不能修改草稿。');
      if (Object.keys(patch).some(key => key !== 'arguments') || !Object.hasOwn(patch, 'arguments')) throw new Error('只能修改工具参数。');
      validateArgs(draft.toolCall.schema, patch.arguments);
      draft.toolCall.arguments = clone(patch.arguments); draft.revision++; draft.updatedAt = now();
      await write(drafts); emit(draft); return clone(draft);
    });
  }
  async function finish(draftId, status, error, result) {
    return transaction(async () => {
      const drafts = await read(), draft = drafts.find(d => d.id === draftId);
      if (!draft) throw new Error('草稿不存在。');
      draft.status = status; draft.error = error || null; draft.updatedAt = now(); draft.revision++;
      draft.summary = status === 'returned' ? '工具已返回结果，查看会话继续处理' : status === 'unknown' ? '调用结果待核实，请到来源系统检查' : '调用未执行，请检查原因后重新发起';
      if (result !== undefined) {
        const serialized = JSON.stringify(result) ?? 'null';
        draft.resultRef = serialized.length > 32_000 ? { truncated: true, preview: serialized.slice(0, 32_000) } : JSON.parse(serialized);
      }
      await write(drafts); emit(draft); return clone(draft);
    });
  }
  async function cancel({ draftId, expectedRevision }) {
    const result = await transaction(async () => {
      const drafts = await read(), draft = own(drafts.find(d => d.id === draftId)); revision(draft, expectedRevision);
      if (!waiting(draft)) throw new Error('当前调用不能取消。');
      draft.status = 'cancelled'; draft.revision++; draft.updatedAt = now();
      await write(drafts); emit(draft); return clone(draft);
    });
    active.get(draftId)?.reject(new Error('用户取消了工具调用，未执行。请勿自动重试。'));
    return result;
  }
  async function confirm({ draftId, expectedRevision }) {
    let continuation;
    const draft = await transaction(async () => {
      const drafts = await read(), draft = own(drafts.find(d => d.id === draftId)); revision(draft, expectedRevision);
      if (!waiting(draft)) throw new Error('此草稿已处理，不能重复执行。');
      continuation = active.get(draftId);
      if (!continuation || draft.expiresAt <= now()) throw new Error('原工具调用已结束或过期，请重新发起。');
      validateArgs(draft.toolCall.schema, draft.toolCall.arguments);
      draft.status = 'executing'; draft.summary = '正在调用工具'; draft.updatedAt = now(); draft.revision++;
      await write(drafts); emit(draft); return clone(draft);
    });
    let dispatched = false;
    try {
      await continuation.validateCurrent();
      continuation.signal.throwIfAborted();
      const result = await continuation.execute(clone(draft.toolCall.arguments), true, async () => {
        await continuation.validateCurrent(); continuation.signal.throwIfAborted(); dispatched = true;
      });
      // A generic tool return is not a business receipt (it may request further confirmation).
      const saved = await finish(draftId, 'returned', null, result);
      continuation.resolve(result); return saved;
    } catch (error) {
      try { return await finish(draftId, dispatched ? 'unknown' : 'failed', errorText(error)); }
      finally { continuation.reject(new Error(`${errorText(error)}${dispatched ? ' 调用结果未知，请到来源系统核实，不要自动重试。' : ''}`)); }
    }
  }
  async function intercept({ appId, appVersion, identity, title, sessionId, toolUseId, schema, args, execute, validateCurrent, signal }) {
    signal.throwIfAborted(); validateArgs(schema, args);
    const ownerKey = currentOwner(), id = `tool-draft:${randomUUID()}`, timestamp = now();
    const draft = { id, draftId: id, kind: 'tool-call', appId, appVersion, ownerKey, instanceId: identity.instanceId || null,
      title, summary: '等待确认工具调用', channel: identity.kind === 'mcp' ? identity.server : appId,
      accountId: null, accountLabel: null, target: {}, content: '', attachments: [], actionRefs: {}, metadata: {},
      revision: 1, status: 'draft', createdAt: timestamp, updatedAt: timestamp, expiresAt: timestamp + 24 * 60 * 60 * 1000,
      error: null, resultRef: null, toolCall: { ...identity, toolUseId, sessionId, schema: clone(schema), arguments: clone(args) } };
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    // Attach before any asynchronous store work, including abort during creation.
    promise.catch(() => {});
    const continuation = { resolve, reject, execute, validateCurrent, signal };
    let timer;
    const abort = () => {
      void transaction(async () => {
        const drafts = await read(), current = drafts.find(d => d.id === id);
        if (current && waiting(current)) {
          current.status = 'cancelled'; current.error = '原会话调用已停止，未执行。'; current.revision++; current.updatedAt = now();
          await write(drafts); emit(current); reject(new Error(current.error));
        }
      }).catch(reject);
    };
    try {
      await transaction(async () => {
        const drafts = await read(); signal.throwIfAborted();
        while (drafts.length >= 200) {
          const index = drafts.findIndex(d => !['draft', 'executing', 'unknown'].includes(d.status));
          if (index < 0) throw new Error('待处理草稿已达上限，请先处理。');
          drafts.splice(index, 1);
        }
        await write([...drafts, draft]); active.set(id, continuation); emit(draft);
      });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      timer = setTimeout(() => {
        void transaction(async () => {
          const drafts = await read(), current = drafts.find(d => d.id === id);
          if (!current || !waiting(current)) return;
          current.status = 'expired'; current.revision++; current.updatedAt = now();
          await write(drafts); emit(current); reject(new Error('草稿已过期，未执行。'));
        }).catch(reject);
      }, Math.max(1, draft.expiresAt - now())); timer.unref?.();
      return await promise;
    } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); active.delete(id); }
  }
  return { list, get, update, cancel, confirm, intercept };
}
