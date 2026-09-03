import { describe, expect, it } from 'bun:test';
import {
  attachAuthorizedConnectorToSession,
  runMcpConnectorAuthorization,
} from '../src/renderer-react/lib/connector-auth-flow';

describe('connector authorization session flow', () => {
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
