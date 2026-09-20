import { describe, expect, it } from 'bun:test';
import { pathToFileURL } from 'node:url';

import {
  materializeRemoteBrowserFile,
  resolveRemoteWorkspaceFileUrl,
} from '../src/remote-browser-file.mjs';

describe('remote browser file mapping', () => {
  it('maps a remote workspace file to a downloaded local file URL', async () => {
    const downloads: Array<[string, string]> = [];
    const result = await materializeRemoteBrowserFile({
      rawUrl: 'file:///srv/moss/session/workspace/pages/welcome.html',
      remoteWorkspace: '/srv/moss/session/workspace',
      cacheDir: '/tmp/moss-browser-cache',
      sessionId: 'session-1',
      download: async (remotePath, localPath) => {
        downloads.push([remotePath, localPath]);
      },
    });

    expect(result?.remotePath).toBe('/srv/moss/session/workspace/pages/welcome.html');
    expect(result?.relativePath).toBe('pages/welcome.html');
    expect(result?.localPath.startsWith('/tmp/moss-browser-cache/')).toBe(true);
    expect(result?.localPath.endsWith('.html')).toBe(true);
    expect(result?.localUrl).toBe(pathToFileURL(result!.localPath).href);
    expect(downloads).toEqual([[
      '/srv/moss/session/workspace/pages/welcome.html',
      result!.localPath,
    ]]);
  });

  it('ignores non-file URLs and rejects files outside the remote workspace', () => {
    expect(resolveRemoteWorkspaceFileUrl(
      'https://example.com',
      '/srv/moss/session/workspace',
    )).toBeNull();
    expect(() => resolveRemoteWorkspaceFileUrl(
      'file:///etc/passwd',
      '/srv/moss/session/workspace',
    )).toThrow('inside the session workspace');
    expect(() => resolveRemoteWorkspaceFileUrl(
      'file://other-host/srv/moss/session/workspace/welcome.html',
      '/srv/moss/session/workspace',
    )).toThrow('network host');
  });
});
