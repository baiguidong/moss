import { randomUUID } from 'node:crypto';

/** Bypasses the serialized foreground-send queue, while retaining session ownership. */
export function createSessionInteractions({ getSessionRecord, publish, assertWorkAllowed = () => {}, timeoutMs = 120_000, prepareSteer, ensureRuntime }) {
  const preparations = new Map();
  const activeSides = new Map();
  const latest = (record, id) => record.history.findLast(event => event.type === 'session_interaction' && event.id === id);
  const emit = (record, previous, patch) => {
    const event = { ...previous, ...patch, type: 'session_interaction', uuid: randomUUID(), timestamp: Date.now() };
    if (!record.deleted) publish(record, event);
    return event;
  };
  return {
    handle({ sessionId, action, id, prompt, details } = {}) {
      assertWorkAllowed();
      const record = getSessionRecord(sessionId);
      if (record.deleted || record.isSubAgent || record.agentMode === 'remote-direct') throw new Error('当前会话不支持侧问或运行中补充。');
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('消息标识无效。');
      const existing = latest(record, id);
      if (action === 'inspect') {
        if (existing && ((existing.kind === 'side_question' && existing.status === 'running' && activeSides.get(sessionId)?.id !== id)
          || (existing.kind === 'steer' && existing.status === 'accepted' && !record.busy))) {
          return { status: emit(record, existing, { status: 'unknown' }).status, id };
        }
        return { status: existing?.status || 'unknown', id };
      }
      if (action === 'cancel_side') {
        const run = activeSides.get(sessionId);
        if (run?.id !== id) return { status: existing?.status || 'unknown', id };
        run.controller.abort(new Error('侧问已取消'));
        run.finish({ status: 'cancelled', response: null });
        return { status: 'cancelled', id };
      }
      if (!['steer', 'side_question'].includes(action)) throw new Error('消息操作无效。');
      if (typeof prompt !== 'string' || (!prompt.trim() && !(action === 'steer' && details?.files?.length)) || Buffer.byteLength(prompt) > 64_000) throw new Error('请输入问题或补充内容（最多 64 KB）。');
      if (existing) {
        if (existing.prompt !== prompt || existing.kind !== action || JSON.stringify(existing.details) !== JSON.stringify(details)) throw new Error('同一消息标识不能用于不同内容。');
        return { status: existing.status, id }; // Never replay an uncertain delivery.
      }
      const runtime = record.runtime;
      if (!runtime) {
        if (action === 'steer') return { status: 'not_running', id };
        if (typeof ensureRuntime !== 'function') {
          throw new Error('当前会话尚未建立模型上下文，请先发送主会话消息。');
        }
      }
      const base = { id, kind: action, prompt, ...(details ? { details: structuredClone(details) } : {}), status: 'accepted', ...(action === 'steer' && record.activeInputTurnId ? { turnId: record.activeInputTurnId } : {}) };
      if (action === 'steer') {
        if (typeof runtime.steer !== 'function') return { status: 'unsupported', id };
        if (!record.busy) return { status: 'not_running', id };
        const accept = text => {
          if (text === null) return { status: 'deferred', id };
          if (record.deleted || !record.busy || record.runtime !== runtime || record.activeInputTurnId !== base.turnId) return { status: 'not_running', id };
          if (Buffer.byteLength(text) > 64_000) throw new Error('补充内容和附件说明过长，请分开发送。');
          const accepted = runtime.steer(text, id, status => emit(record, base, { status }));
          if (!accepted) return { status: 'not_running', id };
          emit(record, base, {});
          return { status: 'accepted', id };
        };
        if (!details || !prepareSteer) return accept(prompt);
        if (Buffer.byteLength(JSON.stringify(details)) > 64_000) throw new Error('消息附件信息过长。');
        const key = `${sessionId}:${id}`, signature = JSON.stringify({ prompt, details });
        const pending = preparations.get(key);
        if (pending) {
          if (pending.signature !== signature) throw new Error('同一消息标识不能用于不同内容。');
          return pending.promise;
        }
        const promise = Promise.resolve().then(() => prepareSteer(record, { prompt, details: base.details }))
          .then(accept).finally(() => preparations.delete(key));
        preparations.set(key, { signature, promise });
        return promise;
      }
      if (runtime && typeof runtime.askSideQuestion !== 'function') throw new Error('当前运行时尚不支持侧问，请更新并重启 Moss。');
      if (activeSides.has(sessionId)) throw new Error('本会话已有侧问，请等待回答或先取消。');
      if (activeSides.size >= 16) throw new Error('正在回答的侧问过多，请稍后再试。');
      const controller = new AbortController();
      let finished = false;
      const finish = patch => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (activeSides.get(sessionId)?.id === id) activeSides.delete(sessionId);
        emit(record, base, patch);
      };
      // Restoration can wait on MCP startup/disposal. Acknowledge and bound the
      // entire operation so the user can cancel even before a runtime is ready.
      const timer = setTimeout(() => {
        controller.abort(new Error('侧问超时'));
        finish({ status: 'timeout', response: null });
      }, timeoutMs);
      timer.unref?.();
      activeSides.set(sessionId, { id, controller, finish });
      emit(record, base, { status: 'running' });
      void Promise.resolve().then(async () => {
        if (finished || record.deleted) return;
        const resolvedRuntime = runtime || await ensureRuntime(record, controller.signal);
        if (finished || record.deleted) return;
        if (!resolvedRuntime || typeof resolvedRuntime.askSideQuestion !== 'function') throw new Error('当前运行时尚不支持侧问，请更新并重启 Moss。');
        const result = await resolvedRuntime.askSideQuestion(prompt, controller.signal);
        finish({ status: result.status || (result.response ? 'completed' : 'empty'), response: result.response, usage: result.usage });
      }).catch(error => {
        finish({ status: controller.signal.aborted ? 'cancelled' : 'failed', response: null, error: String(error?.message || error).slice(0, 2000) });
      });
      return { status: 'running', id };
    },
  };
}
