import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createEnterpriseAccountClient,
  fetchRemoteUsageOverview,
  fetchRemoteDirectSessions,
  fetchRemoteDirectSessionTasks,
  deleteRemoteDirectSession,
  downloadRemoteDirectWorkspaceFile,
  fetchRemoteProfileMemory,
  fetchRemoteProfileMemoryFile,
  fetchRemoteProfileSkillStatus,
  fetchRemoteSessionMemory,
  forkRemoteDirectSession,
  getEnterpriseAccountSettings,
  parseRemoteDirectServerInput,
  requestEnterpriseAuthentication,
  requestEnterpriseAccessToken,
  resolveEnterpriseAccountConnection,
  uploadRemoteDirectWorkspaceData,
  uploadRemoteProfileSkills,
  writeRemoteDirectWorkspaceFile,
} from '../src/enterprise-account-client.mjs';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('enterprise login requirements', () => {
  it('reports missing server or credentials as a login requirement before making requests', async () => {
    const fetchImpl = async () => { throw new Error('Unexpected network request'); };
    for (const settings of [
      {},
      { enterpriseAccountServerUrl: 'https://moss.example.com', enterpriseAccountCredentialMode: 'api-key' },
      { enterpriseAccountServerUrl: 'https://moss.example.com', enterpriseAccountCredentialMode: 'password' },
      { enterpriseAccountServerUrl: 'https://moss.example.com', enterpriseAccountCredentialMode: 'password', enterpriseAccountUserEmail: 'alice@example.com' },
    ]) {
      await expect(resolveEnterpriseAccountConnection(settings, { fetchImpl })).rejects.toMatchObject({ code: 'MOSS_LOGIN_REQUIRED' });
    }
  });
});

describe('cloud usage', () => {
  it('does not request usage when cloud is disabled, unconfigured or not signed in', async () => {
    globalThis.fetch = async () => { throw new Error('Unexpected request'); };
    for (const settings of [
      { enterpriseEnabled: false, enterpriseAccountServerUrl: 'https://moss.example.com', enterpriseAccountApiKey: 'key' },
      { enterpriseEnabled: true },
      { enterpriseEnabled: true, enterpriseAccountServerUrl: 'https://moss.example.com', enterpriseAccountCredentialMode: 'api-key' },
    ]) {
      const client = createEnterpriseAccountClient({ getSettings: () => settings });
      expect(await client.getCloudUsageOverview()).toBeNull();
    }
  });

  it('uses the current cloud account and shares a timeout across authentication and usage', async () => {
    const requests: any[] = [];
    const overview = {
      generatedAt: Date.now(), timezone: 'Asia/Shanghai', today: '2026-09-24', historyIncomplete: false,
      totals: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        totalTokens: 0, requestCount: 0, activeDays: 0, peakDay: null, peakTokens: 0 },
      daily: [],
    };
    globalThis.fetch = async (input, init = {}) => {
      requests.push({ url: String(input), init });
      return Response.json(String(input).endsWith('/auth/token') ? { access_token: 'current-account-token' } : overview);
    };
    const client = createEnterpriseAccountClient({ getSettings: () => ({
      enterpriseEnabled: true,
      agentMode: 'local',
      enterpriseAccount: { serverUrl: 'https://moss.example.com/', credentialMode: 'api-key', apiKey: 'current-account-key' },
    }) });

    expect(await client.getCloudUsageOverview()).toEqual(overview);
    expect(requests.map(request => request.url)).toEqual([
      'https://moss.example.com/api/v1/auth/token', 'https://moss.example.com/api/v1/usage',
    ]);
    expect(JSON.parse(requests[0].init.body)).toEqual({ grant_type: 'api_key', api_key: 'current-account-key' });
    expect(requests[1].init.headers.authorization).toBe('Bearer current-account-token');
    expect(requests[1].init.signal).toBeInstanceOf(AbortSignal);
    expect(requests[1].init.signal).toBe(requests[0].init.signal);
  });

  it('reports unavailable or invalid cloud data instead of treating it as zero usage', async () => {
    const connection = { serverUrl: 'https://moss.example.com', authToken: 'token' };
    for (const status of [401, 403, 404, 503]) {
      globalThis.fetch = async () => Response.json({ error: 'Unavailable' }, { status });
      await expect(fetchRemoteUsageOverview(connection)).rejects.toThrow(String(status));
    }
    globalThis.fetch = async () => Response.json({ totals: {}, daily: [] });
    await expect(fetchRemoteUsageOverview(connection)).rejects.toThrow('云端用量数据格式无效');
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await expect(fetchRemoteUsageOverview(connection)).rejects.toThrow('offline');
  });
});

describe('remote direct client settings', () => {
  it('prefers structured remote settings and preserves passwords verbatim', () => {
    expect(getEnterpriseAccountSettings({
      enterpriseAccountServerUrl: 'https://legacy.example.com',
      enterpriseAccount: {
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

  it('reports the Moss Server address when the authentication endpoint is unreachable', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };

    await expect(requestEnterpriseAccessToken({
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

    await expect(requestEnterpriseAuthentication({
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

  it('rejects retired server execution without network requests', async () => {
    globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
    await expect(fetchRemoteDirectSessions({})).rejects.toThrow('服务端执行已退役');
    await expect(forkRemoteDirectSession({})).rejects.toThrow('服务端执行已退役');
  });
});
