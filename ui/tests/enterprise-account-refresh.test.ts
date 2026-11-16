import { afterEach, describe, expect, it } from 'bun:test';
import { createEnterpriseAccountClient } from '../src/enterprise-account-client.mjs';

const originalFetch = globalThis.fetch;
const serverUrl = 'https://moss.example.com';
const jwt = (expiresAt: number, userId = 'user-1') => `header.${Buffer.from(JSON.stringify({ sub: userId, org_id: 'org-1', exp: expiresAt })).toString('base64url')}.signature`;
const freshToken = () => jwt(Math.floor(Date.now() / 1000) + 3600);
const expiredToken = () => jwt(Math.floor(Date.now() / 1000) - 3600);

afterEach(() => { globalThis.fetch = originalFetch; });

function fixture(accessToken = expiredToken()) {
  let settings = { enterpriseAccountServerUrl: serverUrl, enterpriseAccountAccessToken: accessToken, enterpriseAccountRefreshToken: 'old-refresh' };
  let saves = 0;
  const client = createEnterpriseAccountClient({
    getSettings: () => settings,
    onCredentials: ({ accessToken, refreshToken }: { accessToken: string; refreshToken: string }) => {
      saves += 1;
      settings = { ...settings, enterpriseAccountAccessToken: accessToken, enterpriseAccountRefreshToken: refreshToken };
    },
  });
  return { client, get settings() { return settings; }, get saves() { return saves; }, replace: (value: typeof settings) => { settings = value; } };
}

function discovery() {
  return Response.json({ desktop_client_id: 'custom-desktop', token_endpoint: `${serverUrl}/oidc/token` });
}

describe('enterprise account refresh', () => {
  it('refreshes the legacy browser session when OIDC is disabled', async () => {
    const f = fixture();
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('openid-configuration')) return new Response('', { status: 404 });
      expect(String(input)).toBe(`${serverUrl}/api/v1/auth/oauth/refresh`);
      expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'old-refresh' });
      return Response.json({ access_token: freshToken(), refresh_token: 'legacy-new-refresh' });
    };
    await f.client.resolveEnterpriseAccountConnection();
    expect(f.settings.enterpriseAccountRefreshToken).toBe('legacy-new-refresh');
  });
  it('does not refresh on creation, while idle, or for background heartbeats; refreshes on use', async () => {
    let requests = 0;
    const f = fixture();
    const next = freshToken();
    globalThis.fetch = async (input, init) => {
      requests += 1;
      if (String(input).endsWith('openid-configuration')) return discovery();
      expect(new URLSearchParams(String(init?.body)).get('client_id')).toBe('custom-desktop');
      return Response.json({ access_token: next, refresh_token: 'new-refresh' });
    };
    expect(requests).toBe(0);
    const background = await f.client.resolveEnterpriseAccountConnection(undefined, { allowRefresh: false });
    expect(background.authToken).toBe(f.settings.enterpriseAccountAccessToken);
    expect(requests).toBe(0);
    expect((await f.client.resolveEnterpriseAccountConnection()).authToken).toBe(next);
    expect(f.saves).toBe(1);
    expect(f.settings.enterpriseAccountRefreshToken).toBe('new-refresh');
    expect((await f.client.resolveEnterpriseAccountConnection()).authToken).toBe(next);
    expect(requests).toBe(2);
  });

  it('shares one token rotation across concurrent model, account and connector requests', async () => {
    const f = fixture();
    let refreshes = 0;
    const next = freshToken();
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('openid-configuration')) return discovery();
      refreshes += 1;
      expect(new URLSearchParams(String(init?.body)).get('refresh_token')).toBe('old-refresh');
      return Response.json({ access_token: next, refresh_token: 'new-refresh' });
    };
    const connections = await Promise.all(Array.from({ length: 20 }, () => f.client.resolveEnterpriseAccountConnection()));
    expect(new Set(connections.map(connection => connection.authToken))).toEqual(new Set([next]));
    expect(refreshes).toBe(1);
    expect(f.saves).toBe(1);
    expect(connections.every(connection => !Object.hasOwn(connection, 'refreshToken'))).toBe(true);
  });

  it('finishes and persists a shared rotation even when its first caller cancels', async () => {
    const f = fixture();
    const controller = new AbortController();
    let started!: () => void;
    let complete!: (response: Response) => void;
    let refreshSignal: AbortSignal | undefined;
    const refreshing = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('openid-configuration')) return discovery();
      refreshSignal = init?.signal as AbortSignal;
      started();
      return new Promise<Response>((resolve, reject) => {
        complete = resolve;
        refreshSignal?.addEventListener('abort', () => reject(refreshSignal?.reason), { once: true });
      });
    };
    const canceled = f.client.resolveEnterpriseAccountConnection(undefined, { signal: controller.signal });
    await refreshing;
    controller.abort(new Error('view closed'));
    await expect(canceled).rejects.toThrow('view closed');
    expect(refreshSignal?.aborted).toBe(false);
    const other = f.client.resolveEnterpriseAccountConnection();
    const next = freshToken();
    complete(Response.json({ access_token: next, refresh_token: 'new-refresh' }));
    expect((await other).authToken).toBe(next);
    expect(f.saves).toBe(1);
    expect(f.settings.enterpriseAccountRefreshToken).toBe('new-refresh');
  });

  it('persists rotation if a settings draft changes only the same account access token', async () => {
    const f = fixture();
    let started!: () => void;
    let complete!: (response: Response) => void;
    const refreshing = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async input => {
      if (String(input).endsWith('openid-configuration')) return discovery();
      started();
      return new Promise<Response>(resolve => { complete = resolve; });
    };
    const operation = f.client.resolveEnterpriseAccountConnection();
    await refreshing;
    f.replace({ ...f.settings, enterpriseAccountAccessToken: jwt(Math.floor(Date.now() / 1000) - 7200) });
    const next = freshToken();
    complete(Response.json({ access_token: next, refresh_token: 'new-refresh' }));
    expect((await operation).authToken).toBe(next);
    expect(f.settings.enterpriseAccountRefreshToken).toBe('new-refresh');
  });

  it('does not rotate again for a delayed 401 when the new JWT equals the old JWT', async () => {
    const sameToken = freshToken();
    const f = fixture(sameToken);
    let releaseDelayed!: (response: Response) => void;
    const calls = new Map<string, number>();
    let rotations = 0;
    globalThis.fetch = async input => {
      const url = String(input);
      if (url.endsWith('openid-configuration')) return discovery();
      if (url.endsWith('/oidc/token')) {
        rotations += 1;
        return Response.json({ access_token: sameToken, refresh_token: `new-refresh-${rotations}` });
      }
      const count = (calls.get(url) || 0) + 1;
      calls.set(url, count);
      if (count > 1) return Response.json({ ok: true });
      if (url.endsWith('/delayed')) return new Promise<Response>(resolve => { releaseDelayed = resolve; });
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    };
    const first = f.client.fetchWithEnterpriseAccount('/first');
    const delayed = f.client.fetchWithEnterpriseAccount('/delayed');
    expect((await first).ok).toBe(true);
    releaseDelayed(Response.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await delayed).ok).toBe(true);
    expect(rotations).toBe(1);
  });

  it('revokes the captured session after local logout, with a bounded request', async () => {
    const f = fixture();
    const previous = f.settings;
    f.replace({ ...previous, enterpriseAccountAccessToken: '', enterpriseAccountRefreshToken: '' });
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      calls += 1;
      expect(String(input)).toBe(`${serverUrl}/api/v1/auth/oauth/revoke`);
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(String(init?.body))).toEqual({ refresh_token: 'old-refresh' });
      return Response.json({});
    };
    await f.client.revokeEnterpriseAccountSession(previous);
    await f.client.revokeEnterpriseAccountSession();
    expect(calls).toBe(1);
  });

  it('recovers a server-side 401 once and shares the rotation across concurrent API calls', async () => {
    const oldToken = jwt(Math.floor(Date.now() / 1000) + 7200);
    const f = fixture(oldToken);
    const next = freshToken();
    let rotations = 0;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith('openid-configuration')) return discovery();
      if (String(input).endsWith('/oidc/token')) {
        rotations += 1;
        return Response.json({ access_token: next, refresh_token: 'new-refresh' });
      }
      calls += 1;
      return new Headers(init?.headers).get('authorization') === `Bearer ${oldToken}`
        ? Response.json({ error: 'Unauthorized' }, { status: 401 })
        : Response.json({ availableModels: ['model-1'] });
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => f.client.fetchWithEnterpriseAccount('/api/v1/model-access')));
    expect(results.every(result => result.ok)).toBe(true);
    expect(rotations).toBe(1);
    expect(calls).toBe(10);
  });

  it('does not retry a persistent 401 indefinitely', async () => {
    const f = fixture(jwt(Math.floor(Date.now() / 1000) + 7200));
    let calls = 0;
    globalThis.fetch = async input => {
      if (String(input).endsWith('openid-configuration')) return discovery();
      if (String(input).endsWith('/oidc/token')) return Response.json({ access_token: freshToken(), refresh_token: 'new-refresh' });
      calls += 1;
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    };
    expect((await f.client.fetchWithEnterpriseAccount('/api/v1/model-access')).status).toBe(401);
    expect(calls).toBe(2);
  });

  it('keeps credentials on network failure so a later use can retry', async () => {
    const f = fixture();
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await expect(f.client.resolveEnterpriseAccountConnection()).rejects.toThrow('offline');
    expect(f.settings.enterpriseAccountRefreshToken).toBe('old-refresh');
    expect(f.saves).toBe(0);
    globalThis.fetch = async input => String(input).endsWith('openid-configuration')
      ? discovery() : Response.json({ access_token: freshToken(), refresh_token: 'recovered-refresh' });
    await f.client.resolveEnterpriseAccountConnection();
    expect(f.settings.enterpriseAccountRefreshToken).toBe('recovered-refresh');
  });

  it('requires login for an expired session or a legacy access token without refresh credentials', async () => {
    const f = fixture();
    globalThis.fetch = async input => String(input).endsWith('openid-configuration')
      ? discovery() : Response.json({ error: 'invalid_grant' }, { status: 400 });
    await expect(f.client.resolveEnterpriseAccountConnection()).rejects.toMatchObject({ code: 'MOSS_LOGIN_REQUIRED' });
    expect(f.saves).toBe(0);
    f.replace({ ...f.settings, enterpriseAccountRefreshToken: '' });
    globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
    await expect(f.client.resolveEnterpriseAccountConnection()).rejects.toMatchObject({ code: 'MOSS_LOGIN_REQUIRED' });
  });

  it.each(['logout', 'switch'])('does not restore an account after %s while refresh was in flight', async change => {
    const f = fixture();
    let complete!: (value: Response) => void;
    let started!: () => void;
    const refreshing = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async input => {
      if (String(input).endsWith('openid-configuration')) return discovery();
      started();
      return new Promise<Response>(resolve => { complete = resolve; });
    };
    const operation = f.client.resolveEnterpriseAccountConnection();
    await refreshing;
    f.replace(change === 'logout'
      ? { ...f.settings, enterpriseAccountAccessToken: '', enterpriseAccountRefreshToken: '' }
      : { ...f.settings, enterpriseAccountAccessToken: jwt(Math.floor(Date.now() / 1000) + 3600, 'another-user') });
    complete(Response.json({ access_token: freshToken(), refresh_token: 'new-refresh' }));
    await expect(operation).rejects.toMatchObject({ code: 'MOSS_LOGIN_REQUIRED' });
    expect(f.saves).toBe(0);
  });

  it('does not send refresh credentials to another origin advertised by discovery', async () => {
    const f = fixture();
    let requests = 0;
    globalThis.fetch = async () => {
      requests += 1;
      return Response.json({ token_endpoint: 'https://another.example/token' });
    };
    await expect(f.client.resolveEnterpriseAccountConnection()).rejects.toThrow('无效的 token 地址');
    expect(requests).toBe(1);
  });
});
