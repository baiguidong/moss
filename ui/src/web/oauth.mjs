import { randomUUID } from 'node:crypto';
import { getHostRequestContext } from '../host/request-registry.mjs';

export function createWebOAuth({ env = process.env, publish = () => {}, fetchImpl = fetch, now = Date.now, timeoutMs = 10 * 60_000 }) {
  const entries = new Map();
  const origin = env.MOSS_WEB_ORIGIN;
  const enabled = Boolean(origin && new URL(origin).protocol === 'https:' && new URL(origin).origin === origin);
  const redirectUri = enabled ? `${origin}/api/oauth/callback` : null;
  const changed = () => publish('web:oauth-changed', {});
  const publicEntry = item => ({ id: item.id, label: item.label, url: item.url, status: item.status, expiresAt: item.expiresAt, originViewId: item.originViewId });
  const list = () => [...entries.values()].map(publicEntry);
  const prune = () => { for (const [state, entry] of entries) if (entry.expiresAt < now()) { entry.cancel(); entries.delete(state); } };
  async function registerGateway(state, expiresAt) {
    if (!env.MOSS_ENVIRONMENT_ID) return;
    const response = await fetchImpl(`${env.MOSS_WEB_AUTH_SERVER}/oauth/register`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/json', 'X-Moss-Environment': env.MOSS_ENVIRONMENT_ID, 'X-Moss-Host-Token': env.MOSS_WEB_CONTROL_TOKEN },
      body: JSON.stringify({ state, expiresAt }),
    });
    if (!response.ok) throw new Error('云网关未能登记登录回调，请稍后重试。');
  }
  async function listen(state, { label = '账号授权', signal } = {}) {
    if (!enabled) throw new Error('浏览器授权需要配置 MOSS_WEB_ORIGIN 为公开 HTTPS 地址。');
    if (!/^[\w-]{16,256}$/.test(state)) throw new Error('Invalid OAuth state');
    prune();
    if (entries.size >= 32 || entries.has(state)) throw new Error('已有待处理授权，请先完成或取消。');
    let resolve, reject, timer;
    const callback = new Promise((yes, no) => { resolve = yes; reject = no; });
    void callback.catch(() => {});
    const item = { id: randomUUID(), label, status: 'preparing', url: null, expiresAt: now() + timeoutMs, originViewId: getHostRequestContext()?.viewId || null,
      cleanup() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); },
      cancel() { item.cleanup(); if (['preparing', 'waiting'].includes(item.status)) { item.status = 'canceled'; reject(new Error('认证已取消或超时。')); changed(); } },
      accept(url) {
        if (!['preparing', 'waiting'].includes(item.status)) throw new Error('此回调已处理或失效。');
        item.cleanup();
        if (url.searchParams.get('error')) { item.status = 'canceled'; reject(new Error('授权未完成，请重新登录。')); }
        else { item.status = 'received'; resolve(url.toString()); }
        changed();
      },
    };
    entries.set(state, item);
    const cancel = () => item.cancel();
    signal?.addEventListener('abort', cancel, { once: true });
    const close = async () => { item.cleanup(); entries.delete(state); item.cancel(); changed(); };
    timer = setTimeout(() => { item.cancel(); entries.delete(state); changed(); }, timeoutMs); timer.unref?.();
    try {
      await registerGateway(state, item.expiresAt);
      if (signal?.aborted) item.cancel();
      changed();
      return { redirectUri, callback, close };
    } catch (error) { await close(); throw error; }
  }
  return {
    enabled, redirectUri, listen, list: () => { prune(); return list(); },
    show(url, { state } = {}) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Web 授权页必须使用 HTTPS。');
      const item = entries.get(state || parsed.searchParams.get('state'));
      if (!item || !['preparing', 'waiting'].includes(item.status)) throw new Error('找不到有效的登录事务。');
      item.url = parsed.href; item.status = 'waiting'; changed();
      return () => {};
    },
    cancel(id) { const item = [...entries.values()].find(item => item.id === id); item?.cancel(); return { canceled: !!item }; },
    accept(url) {
      prune();
      if (url.pathname !== '/api/oauth/callback' || [...url.searchParams.keys()].some(key => !['code', 'state', 'error', 'error_description', 'iss'].includes(key)) || url.search.length > 8192) throw new Error('授权回调格式无效。');
      for (const key of ['state', 'code', 'error']) if (url.searchParams.getAll(key).length > 1) throw new Error('授权回调参数重复。');
      const item = entries.get(url.searchParams.get('state'));
      if (!item || item.expiresAt < now() || (!url.searchParams.get('code') && !url.searchParams.get('error'))) throw new Error('授权回调已失效。');
      item.accept(new URL(url.pathname + url.search, origin));
    },
    close() { for (const item of entries.values()) item.cancel(); entries.clear(); },
  };
}
