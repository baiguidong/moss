import { describe, expect, it } from 'bun:test';
import {
  attachAuthorizedConnectorToSession,
  authorizeAppConnector,
  runMcpConnectorAuthorization,
} from '../src/renderer-react/lib/connector-auth-flow';
import type { StoredApp } from '../src/renderer-react/types';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

describe('connector authorization session flow', () => {
  for (const status of ['authenticated', 'authorization_url_opened', 'failed']) {
    it(`routes App reauthorization to a fresh session (${status})`, async () => {
      const app = { id: 'moss.baidu-netdisk', name: 'moss.baidu-netdisk', displayName: '百度网盘',
        connectorApp: { id: 'baidu-netdisk', connection: { connected: true } } } as StoredApp;
      let activeSessionId = 'esp32-project';
      const calls: any[] = [];
      const api: any = {
        connectorApp: async (payload: any) => {
          calls.push(['auth', payload]);
          // Switching views while OAuth is pending must not redirect the result.
          activeSessionId = 'esp32-project';
          if (status === 'failed') throw new Error('OAuth failed');
          return { connector: { id: 'baidu-netdisk' }, auth: { status } };
        },
        getSession: async (payload: any) => { calls.push(['get', payload]); return { connectorIds: [] }; },
        setSessionConnectors: async (payload: any) => { calls.push(['attach', payload]); return { success: true, data: payload }; },
        setConnectorAuthStatus: async (payload: any) => { calls.push(['status', payload]); },
      };
      const result = authorizeAppConnector({ app, api, createSession: async title => {
        calls.push(['create', title]); activeSessionId = 'new-auth'; return activeSessionId;
      } });
      if (status === 'failed') await expect(result).rejects.toThrow('OAuth failed');
      else await result;
      expect(calls[0]).toEqual(['create', '百度网盘授权']);
      expect(calls.find(call => call[0] === 'auth')[1]).toEqual({ appId: app.id, action: 'auth', sessionId: 'new-auth' });
      expect(calls.filter(call => call[0] !== 'create').every(call => call[1].sessionId === 'new-auth')).toBe(true);
      expect(calls.some(call => call[0] === 'attach')).toBe(status === 'authenticated');
      expect(calls.filter(call => call[0] === 'status').map(call => call[1].status)).toEqual(
        status === 'authenticated' ? ['pending', 'success'] : status === 'failed' ? ['pending', 'failed'] : ['pending'],
      );
    });
  }

  it('browser authorization without an owner creates a session instead of borrowing the selected project', async () => {
    const renderer = readFileSync(new URL('../src/renderer-react/App.tsx', import.meta.url), 'utf8');
    const start = renderer.indexOf('  const openRightBrowser =');
    const end = renderer.indexOf('\n  React.useEffect', start);
    const created: any[] = [], opened: string[] = [], tabs: any[] = [];
    const context = {
      React: { useCallback: (fn: any) => fn }, activeSessionIdRef: { current: 'esp32-project' },
      openSession: async (id: string) => { opened.push(id); return true; },
      window: { agentDesktop: { createSession: async (payload: any) => {
        created.push(payload); return { summary: { id: `auth-${created.length}` } };
      }, presentation: { action: async () => {} } } },
      setSummaries: () => {}, openBrowserPanelUrl: async (...args: any[]) => { tabs.push(args); },
      setActiveView: () => {}, setLayout: () => {}, setBrowserOpenSignal: () => {}, showPermissionNotice: () => {},
    };
    const open = vm.runInNewContext(new Bun.Transpiler({ loader: 'tsx' }).transformSync(renderer.slice(start, end)) + '; openRightBrowser;', context);
    await open({ url: 'https://auth.example.test', connectorAuth: { connectorId: 'baidu-netdisk', displayName: '百度网盘' } });
    expect(created).toEqual([{ title: '百度网盘授权', agentMode: 'local' }]);
    expect(opened).toEqual(['auth-1']);
    expect(tabs[0][0]).toBe('auth-1');
    await open({ url: 'https://auth.example.test', sessionId: 'explicit-owner', mcpAuth: { serverName: 'test' } });
    expect(created).toHaveLength(1);
    expect(tabs[1][0]).toBe('explicit-owner');
    await open({ url: 'https://example.test' });
    expect(tabs[2][0]).toBe('esp32-project');
  });

  it('App authorization IPC forwards the created session to the browser authentication flow', async () => {
    const main = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
    const start = main.indexOf("  updateGuardedAppIpc.handle('app:connector'");
    const end = main.indexOf('\n  if (isWebHost)', start);
    let handler: any;
    const authentications: any[] = [];
    vm.runInNewContext(main.slice(start, end), {
      updateGuardedAppIpc: { handle: (_name: string, fn: any) => { handler = fn; } },
      appRuntime: { getActivePackage: async () => ({ manifest: { connectorApp: { id: 'baidu-netdisk' } } }),
        getInstallation: () => ({ enabled: true, grants: ['connector:use'] }) },
      getSessionRecord: (id: string) => { if (id !== 'new-auth') throw new Error('Unknown session'); },
      authenticateMcpServerByName: async (...args: any[]) => { authentications.push(args); return { auth: { status: 'authorization_url_opened' } }; },
      resetLocalRuntimesForMcpReload: () => {}, emitAppsChanged: async () => {},
      listInstalledConnectors: async () => [{ id: 'baidu-netdisk' }],
    });
    await handler({}, { appId: 'moss.baidu-netdisk', action: 'auth', sessionId: 'new-auth' });
    expect(authentications).toEqual([['baidu-netdisk', { sessionId: 'new-auth' }]]);
    await expect(handler({}, { appId: 'moss.baidu-netdisk', action: 'auth', sessionId: 'missing' })).rejects.toThrow('Unknown session');
    expect(authentications).toHaveLength(1);
  });

  it('creates an unconfigured bootstrap session and attaches the connector after OAuth', async () => {
    const events: string[] = [];

    const result = await runMcpConnectorAuthorization({
      connectorId: 'qcc-company',
      createSession: async () => {
        events.push('session:create');
        return 'session-1';
      },
      onSessionCreated: async (sessionId) => {
        events.push(`status:pending:${sessionId}`);
      },
      authenticate: async (sessionId) => {
        events.push(`authenticate:${sessionId}`);
        return { auth: { status: 'authenticated' } };
      },
      attachConnector: async (sessionId, connectorId) => {
        events.push(`attach:${sessionId}:${connectorId}`);
      },
      onAuthenticated: async (sessionId, connectorId) => {
        events.push(`status:success:${sessionId}:${connectorId}`);
      },
    });

    expect(result.sessionId).toBe('session-1');
    expect(events).toEqual([
      'session:create',
      'status:pending:session-1',
      'authenticate:session-1',
      'attach:session-1:qcc-company',
      'status:success:session-1:qcc-company',
    ]);
  });

  it('does not attach the connector while a provider authorization page is still open', async () => {
    let attached = false;
    await runMcpConnectorAuthorization({
      connectorId: 'baidu-netdisk',
      createSession: async () => 'session-2',
      authenticate: async () => ({ auth: { status: 'authorization_url_opened' } }),
      attachConnector: async () => {
        attached = true;
      },
    });

    expect(attached).toBe(false);
  });

  it('reports authentication failures in the created authorization session', async () => {
    const statuses: string[] = [];
    await expect(runMcpConnectorAuthorization({
      connectorId: 'qcc-company',
      createSession: async () => 'session-3',
      onSessionCreated: async () => {
        statuses.push('pending');
      },
      authenticate: async () => {
        throw new Error('授权请求缺少必要参数：resource');
      },
      attachConnector: async () => {},
      onFailed: async (_sessionId, _connectorId, error) => {
        statuses.push(`failed:${error instanceof Error ? error.message : String(error)}`);
      },
    })).rejects.toThrow('resource');

    expect(statuses).toEqual([
      'pending',
      'failed:授权请求缺少必要参数：resource',
    ]);
  });

  it('preserves existing session connectors when authorization completes', async () => {
    let savedConnectorIds: string[] = [];
    const detail = await attachAuthorizedConnectorToSession({
      sessionId: 'session-3',
      connectorId: 'qcc-company',
      getSession: async () => ({ connectorIds: ['qq-mail'] }),
      setSessionConnectors: async ({ connectorIds }) => {
        savedConnectorIds = connectorIds;
        return { success: true, data: { connectorIds } };
      },
    });

    expect(savedConnectorIds).toEqual(['qq-mail', 'qcc-company']);
    expect(detail.connectorIds).toEqual(['qq-mail', 'qcc-company']);
  });
});
