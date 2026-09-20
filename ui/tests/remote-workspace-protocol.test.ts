import { describe, expect, it } from 'bun:test';

import {
  installRemoteWorkspaceProtocol,
  parseRemoteWorkspaceUrl,
  toRemoteWorkspaceUrl,
} from '../src/remote-workspace-protocol.mjs';

describe('remote workspace protocol', () => {
  it('round-trips a session-scoped relative path', () => {
    const url = toRemoteWorkspaceUrl('desktop-session-1', 'site/assets/欢迎.png');
    expect(parseRemoteWorkspaceUrl(url)).toEqual({
      sessionId: 'desktop-session-1',
      filePath: 'site/assets/欢迎.png',
    });
    expect(() => toRemoteWorkspaceUrl('desktop-session-1', '../secret.txt')).toThrow(
      'Invalid remote workspace path',
    );
  });

  it('proxies content only for a matching remote session', async () => {
    let handler: ((request: Request) => Promise<Response>) | null = null;
    let fetchedPath = '';
    installRemoteWorkspaceProtocol({
      handle: (_scheme: string, callback: (request: Request) => Promise<Response>) => {
        handler = callback;
      },
    }, {
      getSessionRecord: (sessionId: string) => ({
        id: sessionId,
        agentMode: 'remote-direct',
        underlyingSessionId: 'server-session-1',
      }),
      fetchContent: async (_session: unknown, filePath: string) => {
        fetchedPath = filePath;
        return new Response('body { color: red; }', {
          status: 200,
          headers: { 'content-type': 'text/css' },
        });
      },
    });

    expect(handler).not.toBeNull();
    const response = await handler!(new Request(
      toRemoteWorkspaceUrl('desktop-session-1', 'site/styles/main.css'),
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.text()).toContain('color: red');
    expect(fetchedPath).toBe('site/styles/main.css');
  });
});
