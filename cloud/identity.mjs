import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { authRequest } from './http.mjs';
const hash = value => createHash('sha256').update(String(value || '')).digest();
export async function createIdentityProvider({ stateRoot, authBase, token }) {
  const mode = authBase ? 'server' : 'token', modeFile = path.join(stateRoot, 'auth-mode');
  try { if ((await fs.readFile(modeFile, 'utf8')).trim() !== mode) throw new Error('认证模式与持久部署身份不同；请显式迁移，不能自动切换身份'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; await fs.writeFile(modeFile, mode, { flag: 'wx', mode: 0o600 }); }
  if (authBase) return { mode, request: (endpoint, body, credential) => authRequest(authBase, endpoint, body, credential) };
  const tokenFile = path.join(stateRoot, 'access-token');
  if (!token) {
    try { token = (await fs.readFile(tokenFile, 'utf8')).trim(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; token = randomBytes(32).toString('base64url'); await fs.writeFile(tokenFile, token + '\n', { flag: 'wx', mode: 0o600 }); }
  }
  if (token.length < 24) throw new Error('本地访问密钥至少需要 24 个字符');
  const identity = { user: { id: 'local-owner' }, organization: { id: '' } }, credentials = new Map();
  return { mode, tokenFile, async request(endpoint, body, credential) {
    for (const [key, until] of credentials) if (until < Date.now()) credentials.delete(key);
    if (endpoint === '/api/v1/auth/login' && timingSafeEqual(hash(body?.token), hash(token))) {
      const access_token = randomBytes(32).toString('base64url');
      if (credentials.size >= 1000) credentials.delete(credentials.keys().next().value);
      credentials.set(access_token, Date.now() + 12 * 3600_000); return { access_token, expires_in: 43200 };
    }
    if (endpoint === '/api/v1/auth/me' && credentials.has(credential)) return identity;
    throw Object.assign(new Error('访问密钥或登录状态无效'), { status: 401 });
  } };
}
