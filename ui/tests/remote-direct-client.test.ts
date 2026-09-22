import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  fetchRemoteAppAvailability,
  fetchRemoteDirectSessions,
  downloadRemoteDirectWorkspaceFile,
  fetchRemoteProfileMemory,
  fetchRemoteProfileMemoryFile,
  fetchRemoteProfileSkillStatus,
  fetchRemoteSessionMemory,
  forkRemoteDirectSession,
  getRemoteDirectSettings,
  invokeRemoteAppAction,
  parseRemoteDirectServerInput,
  requestRemoteDirectAuthentication,
  requestRemoteDirectAccessToken,
  requestRemoteAppHostCapability,
  uploadRemoteDirectWorkspaceData,
  uploadRemoteProfileSkills,
  writeRemoteDirectWorkspaceFile,
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

  it('authenticates and requests a Server App host capability', async () => {
    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith('/api/v1/auth/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ result: { revision: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const result = await requestRemoteAppHostCapability({
      remoteDirect: {
        serverUrl: 'https://moss.example.com',
        credentialMode: 'api-key',
        apiKey: 'server-key',
      },
    }, 'example.chat', 'example.chat--default', 'moss.agent/v1', 'binding.get', {
      externalConversationId: '*',
    });

    expect(result).toEqual({ revision: 1 });
    expect(requests[1].url).toBe('https://moss.example.com/api/v1/apps/example.chat/instances/example.chat--default/host');
    expect(requests[1].init.headers.authorization).toBe('Bearer access-token');
    expect(JSON.parse(requests[1].init.body)).toEqual({
      protocol: 'moss.agent/v1',
      method: 'binding.get',
      input: { externalConversationId: '*' },
    });
  });

  it('routes shared Server App actions to the organization owner', async () => {
    const requests = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      if (String(input).endsWith('/api/v1/auth/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({ result: { ok: true } }), { status: 200 });
    };

    await expect(invokeRemoteAppAction({
      remoteDirect: {
        serverUrl: 'https://moss.example.com',
        credentialMode: 'api-key',
        apiKey: 'server-key',
      },
    }, 'example.chat', 'example.chat--default', 'session.issue', {}, {
      ownerScope: 'org',
    })).resolves.toEqual({ ok: true });

    expect(requests[1].url).toBe(
      'https://moss.example.com/api/v1/apps/example.chat/instances/example.chat--default/actions/session.issue?owner_scope=org',
    );
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

  it('retains the authenticated account identity for mailbox isolation', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      access_token: 'access-token',
      user: { id: 'user-2', name: 'Second User', email: 'second@example.com' },
      organization: { id: 'org-1', name: 'Example' },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(requestRemoteDirectAuthentication({
      authCenterUrl: 'https://moss.example.com',
      credentialMode: 'api-key',
      apiKey: 'server-key',
    })).resolves.toEqual({
      authToken: 'access-token',
      userId: 'user-2',
      orgId: 'org-1',
      userName: 'Second User',
      userEmail: 'second@example.com',
    });
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
          title: 'App Channel 会话',
          originChannel: 'app:example.chat',
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
      title: 'App Channel 会话',
      originChannel: 'app:example.chat',
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

  it('downloads an authenticated remote workspace file to the requested path', async () => {
    const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-remote-preview-test-'));
    const outputPath = path.join(outputDir, 'report.pdf');
    globalThis.fetch = async (input, init = {}) => {
      expect(String(input)).toContain('/api/v1/sessions/session%2F1/workspace/content');
      expect(init.headers.authorization).toBe('Bearer access-token');
      return new Response(new Uint8Array([37, 80, 68, 70]), {
        status: 200,
        headers: { 'content-length': '4', 'content-type': 'application/pdf' },
      });
    };

    try {
      await expect(downloadRemoteDirectWorkspaceFile({
        serverUrl: 'https://moss.example.com',
        authToken: 'access-token',
        sessionId: 'session/1',
        filePath: '/workspace/report.pdf',
        destinationPath: outputPath,
      })).resolves.toEqual({ path: outputPath, size: 4 });
      expect(await fsp.readFile(outputPath)).toEqual(Buffer.from('%PDF'));
    } finally {
      await fsp.rm(outputDir, { recursive: true, force: true });
    }
  });

  it('rejects remote preview downloads above the configured limit', async () => {
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { 'content-length': '4' },
    });

    await expect(downloadRemoteDirectWorkspaceFile({
      serverUrl: 'https://moss.example.com',
      authToken: 'access-token',
      sessionId: 'session-1',
      filePath: '/workspace/large.bin',
      destinationPath: path.join(os.tmpdir(), 'unused-moss-preview.bin'),
      maxBytes: 3,
    })).rejects.toThrow('too large to preview');
  });

  it('writes and uploads remote workspace files with bearer auth', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return new Response(JSON.stringify({
        path: '/workspace/inputs/demo.txt',
        relativePath: 'inputs/demo.txt',
        content: 'hello',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    await writeRemoteDirectWorkspaceFile({
      serverUrl: 'https://moss.example.com',
      authToken: 'access-token',
      sessionId: 'session/1',
      filePath: 'index.html',
      content: '<h1>Hello</h1>',
    });
    await uploadRemoteDirectWorkspaceData({
      serverUrl: 'https://moss.example.com',
      authToken: 'access-token',
      sessionId: 'session/1',
      fileName: 'demo.txt',
      data: Buffer.from('hello'),
    });

    expect(requests[0].url).toContain('/api/v1/sessions/session%2F1/workspace/content?file=index.html');
    expect(requests[0].init.method).toBe('PUT');
    expect(Buffer.from(requests[0].init.body as Buffer).toString()).toBe('<h1>Hello</h1>');
    expect(requests[1].url).toContain('/api/v1/sessions/session%2F1/workspace/upload?name=demo.txt');
    expect(requests[1].init.method).toBe('POST');
    expect(requests[1].init.headers).toMatchObject({
      authorization: 'Bearer access-token',
      'content-length': '5',
    });
  });

  it('queries and updates remote profile resources', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      const url = String(input);
      if (url.endsWith('/profile/skills') && init.method === 'GET') {
        return new Response(JSON.stringify({ revision: 'sha256:old', fileCount: 1 }), { status: 200 });
      }
      if (url.endsWith('/profile/skills') && init.method === 'PUT') {
        return new Response(JSON.stringify({ revision: 'sha256:new', fileCount: 2 }), { status: 200 });
      }
      if (url.includes('/profile/memory/read')) {
        return new Response(JSON.stringify({ content: '# Remote', bytes: 8, readable: true }), { status: 200 });
      }
      if (url.endsWith('/profile/memory')) {
        return new Response(JSON.stringify({ global: { files: [] }, sessions: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ exists: true, content: '# Session' }), { status: 200 });
    };
    const connection = { serverUrl: 'https://moss.example.com', authToken: 'access-token' };

    await expect(fetchRemoteProfileSkillStatus(connection)).resolves.toMatchObject({ revision: 'sha256:old' });
    await expect(uploadRemoteProfileSkills({
      ...connection,
      archive: Buffer.from('zip'),
      revision: 'sha256:new',
    })).resolves.toMatchObject({ revision: 'sha256:new' });
    await expect(fetchRemoteProfileMemory(connection)).resolves.toHaveProperty('global');
    await expect(fetchRemoteProfileMemoryFile({ ...connection, filePath: 'preferences.md' }))
      .resolves.toMatchObject({ content: '# Remote' });
    await expect(fetchRemoteSessionMemory({ ...connection, sessionId: 'session-1' }))
      .resolves.toMatchObject({ exists: true, content: '# Session' });

    expect(requests[1].init.headers).toMatchObject({
      authorization: 'Bearer access-token',
      'x-moss-content-sha256': 'sha256:new',
    });
    expect(requests[3].url).toContain('file=preferences.md');
  });
});
