import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const hash = value => createHash('sha256').update(String(value)).digest();
export function createWebAuth({ home, env = process.env, fetchImpl = fetch }) {
  const serverUrl = env.MOSS_WEB_AUTH_SERVER?.replace(/\/$/, '');
  const ownerId = env.MOSS_WEB_OWNER_ID;
  const ownerOrg = env.MOSS_WEB_OWNER_ORG_ID;
  if (serverUrl && !ownerId) throw new Error('MOSS_WEB_OWNER_ID is required with MOSS_WEB_AUTH_SERVER.');
  const sessions = new Map();
  const oidcTransactions = new Map();
  let hostAccessToken;
  let token = env.MOSS_WEB_TOKEN;
  const tokenPath = path.join(home, 'web', 'access-token');
  if (!serverUrl && !token) {
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
    try { token = fs.readFileSync(tokenPath, 'utf8').trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      token = randomBytes(32).toString('base64url');
      fs.writeFileSync(tokenPath, `${token}\n`, { mode: 0o600, flag: 'wx' });
    }
  }
  if (!serverUrl && token.length < 24) throw new Error('MOSS_WEB_TOKEN must contain at least 24 characters.');
  const checkOwner = identity => {
    if (identity?.user?.id !== ownerId || (ownerOrg && identity?.organization?.id !== ownerOrg)) {
      throw new Error('此账号不属于这个工作环境。');
    }
  };
  async function upstream(endpoint, init) {
    const response = await fetchImpl(`${serverUrl}${endpoint}`, { ...init, headers: { ...init?.headers, ...(env.MOSS_WEB_CONTROL_TOKEN ? { 'X-Moss-Host-Token': env.MOSS_WEB_CONTROL_TOKEN, 'X-Moss-Environment': env.MOSS_ENVIRONMENT_ID || '' } : {}) }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('认证失败，请检查账号或登录状态。');
    return response.json();
  }
  const oidcClientId = env.MOSS_OIDC_WEB_CLIENT_ID || 'moss-web';
  const oidcOrigin = env.MOSS_WEB_ORIGIN || '';
  const beginOidc = () => {
    if (!serverUrl || !oidcOrigin) throw new Error('OIDC 登录需要配置公开的 Moss Server 地址。');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    const redirectUri = `${oidcOrigin}/api/oidc/callback`;
    oidcTransactions.set(state, { verifier, redirectUri, expiresAt: Date.now() + 10 * 60_000 });
    const url = new URL(`${serverUrl}/oidc/authorize`);
    url.search = new URLSearchParams({ client_id: oidcClientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile email', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return url.toString();
  };
  const completeOidc = async callbackUrl => {
    const url = new URL(callbackUrl);
    const state = url.searchParams.get('state') || '';
    const transaction = oidcTransactions.get(state);
    oidcTransactions.delete(state);
    if (!transaction || transaction.expiresAt < Date.now()) throw new Error('OIDC 登录已过期，请重试。');
    if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || 'OIDC 登录未完成。');
    const response = await fetchImpl(`${serverUrl}/oidc/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', client_id: oidcClientId, ...(env.MOSS_OIDC_WEB_CLIENT_SECRET ? { client_secret: env.MOSS_OIDC_WEB_CLIENT_SECRET } : {}), code: url.searchParams.get('code') || '', redirect_uri: transaction.redirectUri, code_verifier: transaction.verifier }).toString(), redirect: 'error', signal: AbortSignal.timeout(10_000) });
    const value = await response.json();
    if (!response.ok || !value.access_token) throw new Error(value.error || 'OIDC 登录失败。');
    return value;
  };
  const cookieId = req => /(?:^|;\s*)moss_web=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  return {
    mode: serverUrl ? 'server' : 'token', tokenPath,
    getHostAccessToken: () => hostAccessToken,
    beginOidc,
    completeOidc,
    async login(input, { trustedToken = false } = {}) {
      let accessToken;
      let expiresAt = Date.now() + 12 * 3600_000;
      let account = null;
      if (serverUrl) {
        const result = trustedToken && input.accessToken ? { access_token: input.accessToken } : await upstream('/api/v1/auth/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: input.username, password: input.password }),
        });
        if (!result.access_token) throw new Error('认证中心未返回访问凭据。');
        accessToken = result.access_token;
        const identity = await upstream('/api/v1/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } });
        checkOwner(identity);
        hostAccessToken = accessToken;
        const user = identity.user || {};
        account = { userName: [user.name, user.username, user.email, user.id].find(value => typeof value === 'string' && value.trim())?.trim() || '', userEmail: typeof user.email === 'string' ? user.email.trim() : '' };
        expiresAt = Math.min(expiresAt, Date.now() + (Number(result.expires_in) || 3600) * 1000);
      } else if (!timingSafeEqual(hash(input.token || ''), hash(token))) {
        throw new Error('访问密钥不正确。');
      }
      for (const [id, entry] of sessions) if (entry.expiresAt <= Date.now()) sessions.delete(id);
      if (sessions.size >= 32) sessions.delete(sessions.keys().next().value);
      const id = randomBytes(32).toString('base64url');
      sessions.set(id, { id, userId: ownerId || 'owner', accessToken, account, expiresAt, checkedAt: Date.now() });
      return id;
    },
    async authenticate(req) {
      const entry = sessions.get(cookieId(req));
      if (!entry || entry.expiresAt <= Date.now()) return null;
      if (serverUrl && Date.now() - entry.checkedAt > 30_000) {
        try {
          const identity = await upstream('/api/v1/auth/me', { headers: { Authorization: `Bearer ${entry.accessToken}` } });
          checkOwner(identity);
          const user = identity.user || {};
          entry.account = { userName: [user.name, user.username, user.email, user.id].find(value => typeof value === 'string' && value.trim())?.trim() || '', userEmail: typeof user.email === 'string' ? user.email.trim() : '' };
          entry.checkedAt = Date.now();
        } catch { sessions.delete(entry.id); return null; }
      }
      return Object.freeze({ userId: entry.userId, loginId: entry.id, account: entry.account });
    },
    logout(req) { sessions.delete(cookieId(req)); },
  };
}
