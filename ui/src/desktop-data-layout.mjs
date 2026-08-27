import path from 'node:path';

export const DESKTOP_PROJECT_KIND = 'moss-project';
export const DESKTOP_PROJECT_LAYOUT_VERSION = 3;
export const DESKTOP_SESSION_KIND = 'moss-session';
export const DESKTOP_SESSION_LAYOUT_VERSION = 2;

function normalizePathComponent(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

export function createDesktopDataPaths(mossHome) {
  const home = path.resolve(mossHome);
  const projectsRoot = path.join(home, 'projects');
  const sessionsRoot = path.join(home, 'sessions');

  const projectDir = (projectId) => path.join(
    projectsRoot,
    normalizePathComponent(projectId, 'project id'),
  );
  const sessionDir = (sessionId) => path.join(
    sessionsRoot,
    normalizePathComponent(sessionId, 'session id'),
  );

  return Object.freeze({
    home,
    projectsRoot,
    sessionsRoot,
    projectDir,
    projectWorkspaceDir: (projectId) => path.join(projectDir(projectId), 'workspace'),
    projectRuntimeDir: (projectId) => path.join(projectDir(projectId), 'runtime'),
    projectRunsDir: (projectId) => path.join(projectDir(projectId), 'runtime', 'runs'),
    sessionDir,
    sessionWorkspaceDir: (sessionId) => path.join(sessionDir(sessionId), 'workspace'),
    sessionRuntimeDir: (sessionId) => path.join(sessionDir(sessionId), 'runtime'),
    sessionEngineDir: (sessionId) => path.join(sessionDir(sessionId), 'runtime', 'engine'),
    sessionResourceManifestPath: (sessionId) => path.join(
      sessionDir(sessionId),
      'runtime',
      'resource-manifest.json',
    ),
    sessionTranscriptPath: (sessionId, engineSessionId) => path.join(
      sessionDir(sessionId),
      'runtime',
      'engine',
      `${normalizePathComponent(engineSessionId, 'engine session id')}.jsonl`,
    ),
  });
}

export function isDesktopProjectRecord(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    value.kind === DESKTOP_PROJECT_KIND &&
    value.layoutVersion === DESKTOP_PROJECT_LAYOUT_VERSION,
  );
}

export function withDesktopProjectLayout(record) {
  return {
    ...record,
    kind: DESKTOP_PROJECT_KIND,
    layoutVersion: DESKTOP_PROJECT_LAYOUT_VERSION,
  };
}
