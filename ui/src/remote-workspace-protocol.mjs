import path from 'node:path';

export const REMOTE_WORKSPACE_SCHEME = 'moss-remote-workspace';

function normalizeRelativePath(value, { allowEmpty = false } = {}) {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (
    (!allowEmpty && parts.length === 0)
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || parts.some((part) => part === '.' || part === '..')
  ) {
    throw new Error('Invalid remote workspace path.');
  }
  return parts.join('/');
}

export function toRemoteWorkspaceUrl(sessionId, relativePath, { directory = false } = {}) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalizedSessionId)) {
    throw new Error('Invalid remote workspace session id.');
  }
  const normalizedPath = normalizeRelativePath(relativePath, { allowEmpty: directory });
  const encodedPath = normalizedPath
    ? normalizedPath.split('/').map(encodeURIComponent).join('/')
    : '';
  const suffix = directory && encodedPath ? '/' : '';
  return `${REMOTE_WORKSPACE_SCHEME}://session/${encodeURIComponent(normalizedSessionId)}/${encodedPath}${suffix}`;
}

export function parseRemoteWorkspaceUrl(value) {
  const url = new URL(value);
  if (url.protocol !== `${REMOTE_WORKSPACE_SCHEME}:` || url.hostname !== 'session') {
    throw new Error('Invalid remote workspace URL.');
  }
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const sessionId = segments.shift() || '';
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(sessionId)) {
    throw new Error('Invalid remote workspace session id.');
  }
  return {
    sessionId,
    filePath: normalizeRelativePath(segments.join('/')),
  };
}

export function installRemoteWorkspaceProtocol(protocol, {
  getSessionRecord,
  fetchContent,
}) {
  protocol.handle(REMOTE_WORKSPACE_SCHEME, async (request) => {
    if (request.method !== 'GET') {
      return new Response('Method not allowed', { status: 405 });
    }
    let parsed;
    try {
      parsed = parseRemoteWorkspaceUrl(request.url);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    let sessionRecord;
    try {
      sessionRecord = getSessionRecord(parsed.sessionId);
    } catch {
      return new Response('Session not found', { status: 404 });
    }
    if (sessionRecord?.agentMode !== 'remote-direct' || !sessionRecord.underlyingSessionId) {
      return new Response('Session not found', { status: 404 });
    }

    try {
      const upstream = await fetchContent(sessionRecord, parsed.filePath, request);
      const headers = new Headers(upstream.headers);
      headers.set('access-control-allow-origin', '*');
      headers.set('cache-control', 'no-store');
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  });
}
