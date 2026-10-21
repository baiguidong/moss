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
  const cookieId = req => /(?:^|;\s*)moss_web=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || '')?.[1];
  return {
    mode: serverUrl ? 'server' : 'token', tokenPath,
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
