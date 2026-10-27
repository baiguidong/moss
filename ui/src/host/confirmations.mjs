import { createHash } from 'node:crypto';
import { getHostRequestContext } from './request-registry.mjs';

export function createHostConfirmations({ broker, ownerId = 'owner', mode = 'desktop', showNative, showRenderer,
  publish = () => {}, now = Date.now, timeoutMs = 30 * 60_000 }) {
  const pending = new Map();
  let revision = 0;
  let closed = false;
  const changed = () => publish('host:confirmations-changed', { revision: ++revision });
  const assertCaller = context => {
    if (context?.transport === 'web') {
      if (context.principal?.userId !== ownerId) throw new Error('此确认不属于当前用户。');
    } else if (mode === 'web') throw new Error('请在已登录的 WebUI 中处理确认。');
  };
  const snapshot = () => ({ revision, requests: [...pending.values()].map(entry => entry.request) });
  const respond = async (context, input = {}) => {
    assertCaller(context);
    if (typeof input.allowed !== 'boolean') throw new Error('确认结果必须是允许或取消。');
    const entry = pending.get(input.id);
    if (!entry) throw new Error('此确认已处理或过期。');
    return broker.respond({ decisionId: input.id, allowed: input.allowed,
      source: context?.transport === 'web' ? 'web' : 'desktop',
      context: { confirmationOwner: ownerId, confirmationRevision: input.revision },
    });
  };
  function request(options, { signal, sessionId, kind = 'operation' } = {}) {
    if (closed || signal?.aborted) return Promise.resolve(false);
    if (pending.size >= 16) throw new Error('待确认操作过多，请先处理已有请求。');
    const content = {
      kind, title: String(options.title || '确认操作'), message: String(options.message || ''),
      detail: String(options.detail || ''), confirmLabel: String(options.confirmLabel || '允许'),
      cancelLabel: String(options.cancelLabel || '取消'),
      ...(options.disclosure?.type === 'app-installation' ? { disclosure: structuredClone(options.disclosure) } : {}),
    };
    const serialized = JSON.stringify(content);
    if (Buffer.byteLength(serialized) > 256 * 1024) throw new Error('确认内容过长，无法完整展示，请缩小操作范围。');
    const contentRevision = createHash('sha256').update(serialized).digest('hex');
    const originViewId = getHostRequestContext()?.viewId || null;
    const expiresAt = now() + timeoutMs;
    return new Promise((resolve, reject) => {
      let id;
      const cancel = () => { void broker.expireDecision(id, '操作已取消。').catch(reject); };
      const settle = allowed => {
        signal?.removeEventListener('abort', cancel);
        pending.delete(id);
        changed();
        resolve(allowed);
      };
      try {
        const created = broker.create({ sessionId: sessionId || 'host', kind: 'host_confirmation',
          title: content.title, summary: content.message, desktopMessage: `${content.message}\n请打开“待确认操作”查看完整内容并处理。`,
          payload: { confirmationKind: kind, contentRevision, ownerId }, expiresAt, mobilePolicy: 'disabled',
          responseGuard: ({ allowed, source, context }) => {
            if (typeof allowed !== 'boolean' || !['web', 'desktop'].includes(source)
              || context?.confirmationOwner !== ownerId || context?.confirmationRevision !== contentRevision) {
              throw new Error('请打开“待确认操作”查看完整内容后再处理。');
            }
          },
          handler: ({ allowed, expired }) => {
            const accepted = Boolean(allowed && !expired && !signal?.aborted && !closed);
            settle(accepted);
            return { allowed: accepted };
          },
        });
        id = created.decision.id;
        const item = { id, ...content, revision: contentRevision, originViewId, expiresAt, createdAt: now() };
        pending.set(id, { request: item });
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        changed();
        if (mode === 'desktop' && content.disclosure) {
          // Structured installation reviews need a bounded, scrollable UI. A
          // native message box grows with every tool and can hide its buttons.
          showRenderer?.();
        } else if (mode === 'desktop') {
          void Promise.resolve().then(() => showNative({ type: 'question', title: item.title,
            message: item.message, detail: item.detail, buttons: [item.cancelLabel, item.confirmLabel],
            defaultId: 0, cancelId: 0, noLink: true,
          })).then(result => pending.has(id) && respond({}, { id, revision: contentRevision, allowed: result.response === 1 }))
            .catch(() => { if (pending.has(id)) cancel(); });
        }
      } catch (error) { if (id) pending.delete(id); reject(error); }
    });
  }
  return {
    request, snapshot, respond,
    list(context) { assertCaller(context); return snapshot(); },
    register(ipc) {
      ipc.handle('host:confirmations-list', context => this.list(context));
      ipc.handle('host:confirmations-respond', respond);
    },
    // Existing two-choice disclosure builders can retain their native dialog DTO.
    dialog: { async showMessageBox(options) {
      if (options.cancelId !== 0 || options.buttons?.length !== 2) throw new Error('Unsupported Host confirmation');
      const allowed = await request({ ...options, confirmLabel: options.buttons[1], cancelLabel: options.buttons[0] });
      return { response: allowed ? 1 : 0 };
    } },
    async close() {
      closed = true;
      await Promise.all([...pending.keys()].map(id => broker.expireDecision(id, 'Host 已停止，操作未继续。')));
    },
  };
}
