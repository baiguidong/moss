import { afterEach, describe, expect, it } from 'bun:test';

import {
  fetchRemoteAppAvailability,
  fetchRemoteDirectSessions,
  forkRemoteDirectSession,
  getRemoteDirectSettings,
  parseRemoteDirectServerInput,
  requestRemoteDirectAccessToken,
  startRemoteFeishuAdapter,
} from '../src/remote-direct-client.mjs';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('remote direct client settings', () => {
  it('prefers structured remote settings and preserves passwords verbatim', () => {
    expect(getRemoteDirectSettings({
      remoteDirectServerUrl: 'https://legacy.example.com',
      remoteDirect: {
        serverUrl: ' https://remote.example.com ',
        credentialMode: 'api-key',
        userEmail: ' user@example.com ',
        userPassword: '  password  ',
        apiKey: ' key ',
        workspace: ' /workspace ',
      },
    })).toEqual({
      serverUrl: 'https://remote.example.com',
      credentialMode: 'api-key',
      userEmail: 'user@example.com',
      userPassword: '  password  ',
      apiKey: 'key',
      workspace: '/workspace',
    });
  });

  it('parses direct-connect URLs into server and auth-center endpoints', () => {
    expect(parseRemoteDirectServerInput(
      'cc://127.0.0.1:8787?auth_mode=auth-center&auth_center=https%3A%2F%2Fauth.example.com',
    )).toEqual({
      serverUrl: 'http://127.0.0.1:8787',
      authCenterUrl: 'https://auth.example.com',
    });
    expect(() => parseRemoteDirectServerInput('cc+unix:///tmp/moss.sock')).toThrow(
      'Unix domain socket',
    );
  });

  it('authenticates and pushes a Feishu runtime snapshot to Moss Server', async () => {
    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith('/api/v1/auth/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ ok: true, status: { status: 'running' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await startRemoteFeishuAdapter({
      remoteDirect: {
        serverUrl: 'https://moss.example.com',
        credentialMode: 'api-key',
        apiKey: 'server-key',
      },
    }, { appId: 'cli_test', appSecret: 'secret' });

    expect(result.ok).toBe(true);
    expect(requests[1].url).toBe('https://moss.example.com/api/v1/adapters/feishu/start');
    expect(requests[1].init.headers.authorization).toBe('Bearer access-token');
    expect(JSON.parse(requests[1].init.body)).toEqual({
      config: { appId: 'cli_test', appSecret: 'secret' },
    });
  });

  it('reports the Moss Server address when the authentication endpoint is unreachable', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };

    await expect(requestRemoteDirectAccessToken({
      authCenterUrl: 'http://127.0.0.1:43127',
      credentialMode: 'api-key',
      apiKey: 'server-key',
    })).rejects.toThrow(
      'Failed to connect to Moss Server at http://127.0.0.1:43127: fetch failed',
    );
  });

  it('checks known Server package versions with bearer auth', async () => {
    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith('/api/v1/auth/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        packages: [{ appId: 'example.app', version: '1.0.0', available: true }],
      }), { status: 200 });
    };

    const packages = await fetchRemoteAppAvailability({
      remoteDirect: {
        serverUrl: 'https://moss.example.com',
        credentialMode: 'api-key',
        apiKey: 'server-key',
      },
    }, [{ appId: 'example.app', version: '1.0.0' }]);

    expect(packages).toEqual([{ appId: 'example.app', version: '1.0.0', available: true }]);
    expect(requests[1].url).toBe('https://moss.example.com/api/v1/apps/availability');
    expect(requests[1].init.headers.authorization).toBe('Bearer access-token');
    expect(JSON.parse(requests[1].init.body)).toEqual({
      packages: [{ appId: 'example.app', version: '1.0.0' }],
    });
  });

  it('lists authoritative Moss Server sessions with bearer auth', async () => {
    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({
        sessions: [{
          sessionId: 'server-session-1',
          title: '飞书会话',
          originChannel: 'feishu',
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await fetchRemoteDirectSessions({
      serverUrl: 'https://moss.example.com',
      authToken: 'access-token',
    });

    expect(result.sessions).toEqual([{
      sessionId: 'server-session-1',
      title: '飞书会话',
      originChannel: 'feishu',
    }]);
    expect(requests[0].url).toBe('https://moss.example.com/api/v1/sessions');
    expect(requests[0].init.headers.authorization).toBe('Bearer access-token');
  });

  it('forks a remote session with bearer auth', async () => {
    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({
        session: { sessionId: 'fork-1', title: 'Research (Fork)' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const result = await forkRemoteDirectSession({
      serverUrl: 'https://moss.example.com',
      authToken: 'access-token',
      sessionId: 'source/1',
      title: 'Research (Fork)',
      dangerouslySkipPermissions: true,
    });

    expect(result.session.sessionId).toBe('fork-1');
    expect(requests[0].url).toBe('https://moss.example.com/api/v1/sessions/source%2F1/fork');
    expect(requests[0].init.headers.authorization).toBe('Bearer access-token');
    expect(JSON.parse(requests[0].init.body)).toEqual({
      title: 'Research (Fork)',
      dangerously_skip_permissions: true,
    });
  });
});
