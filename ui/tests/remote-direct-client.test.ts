import { afterEach, describe, expect, it } from 'bun:test';

import {
  getRemoteDirectSettings,
  parseRemoteDirectServerInput,
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
        profileMode: 'user',
      },
    })).toEqual({
      serverUrl: 'https://remote.example.com',
      credentialMode: 'api-key',
      userEmail: 'user@example.com',
      userPassword: '  password  ',
      apiKey: 'key',
      workspace: '/workspace',
      profileMode: 'user',
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
});
