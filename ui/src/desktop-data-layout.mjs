import path from 'node:path';

export const DESKTOP_PROJECT_KIND = 'moss-project';
export const DESKTOP_PROJECT_LAYOUT_VERSION = 3;
export const DESKTOP_SESSION_KIND = 'moss-session';
export const DESKTOP_SESSION_LAYOUT_VERSION = 3;

const PROJECT_SESSION_WORKSPACE_DIRECTORIES = Object.freeze([
  'inputs',
  'working',
  'outputs',
]);

export function getProjectSessionWorkspaceDirectories(projectId) {
  return typeof projectId === 'string' && projectId.trim()
    ? [...PROJECT_SESSION_WORKSPACE_DIRECTORIES]
    : [];
}

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
  const workspacesRoot = path.join(home, 'workspaces');

  const projectDir = (projectId) => path.join(
    projectsRoot,
    normalizePathComponent(projectId, 'project id'),
  );
  const sessionDir = (sessionId) => path.join(
    sessionsRoot,
    normalizePathComponent(sessionId, 'session id'),
  );
  const sessionRecordDir = (sessionId, rootSessionId = sessionId) => {
    const root = sessionDir(rootSessionId);
    const id = normalizePathComponent(sessionId, 'session id');
    return id === rootSessionId ? root : path.join(root, 'children', id);
  };

  return Object.freeze({
    home,
    projectsRoot,
    sessionsRoot,
    workspacesRoot,
    projectDir,
    projectWorkspaceDir: (projectId) => path.join(projectDir(projectId), 'workspace'),
    projectRuntimeDir: (projectId) => path.join(projectDir(projectId), 'runtime'),
    projectRunsDir: (projectId) => path.join(projectDir(projectId), 'runtime', 'runs'),
    sessionDir,
    sessionRecordDir,
    sessionWorkspaceDir: (sessionId, rootSessionId = sessionId) => path.join(sessionRecordDir(sessionId, rootSessionId), 'workspace'),
    sessionRuntimeDir: (sessionId, rootSessionId = sessionId) => path.join(sessionRecordDir(sessionId, rootSessionId), 'runtime'),
    sessionEngineDir: (sessionId, rootSessionId = sessionId) => path.join(sessionRecordDir(sessionId, rootSessionId), 'runtime', 'engine'),
    sessionResourceManifestPath: (sessionId, rootSessionId = sessionId) => path.join(
      sessionRecordDir(sessionId, rootSessionId),
      'runtime',
      'resource-manifest.json',
    ),
    sessionModelResourcesPath: (sessionId, rootSessionId = sessionId) => path.join(
      sessionRecordDir(sessionId, rootSessionId),
      'runtime',
      'model-resources.json',
    ),
    sessionTranscriptPath: (sessionId, engineSessionId, rootSessionId = sessionId) => path.join(
      sessionRecordDir(sessionId, rootSessionId),
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
