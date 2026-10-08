export function normalizeSessionDirName(sessionId) {
  const id = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(id)) {
    throw new Error('Invalid session id.');
  }
  return id;
}

/** Desktop paths with the existing session ID validation at every entry point. */
export function createSessionPaths({
  DESKTOP_DATA_PATHS,
}) {
  function getLocalSessionDir(sessionId) {
    return DESKTOP_DATA_PATHS.sessionDir(normalizeSessionDirName(sessionId));
  }

  function getLocalSessionRuntimeDir(sessionId) {
    return DESKTOP_DATA_PATHS.sessionRuntimeDir(normalizeSessionDirName(sessionId));
  }

  function getLocalSessionEngineDir(sessionId) {
    return DESKTOP_DATA_PATHS.sessionEngineDir(normalizeSessionDirName(sessionId));
  }

  function getLocalSessionResourceManifestPath(sessionId) {
    return DESKTOP_DATA_PATHS.sessionResourceManifestPath(normalizeSessionDirName(sessionId));
  }

  function getLocalSessionTranscriptPath(sessionRecord) {
    if (!sessionRecord?.id || !sessionRecord?.underlyingSessionId) return null;
    return DESKTOP_DATA_PATHS.sessionTranscriptPath(
      normalizeSessionDirName(sessionRecord.id),
      normalizeSessionDirName(sessionRecord.underlyingSessionId),
    );
  }

  return {
    getLocalSessionDir,
    getLocalSessionEngineDir,
    getLocalSessionResourceManifestPath,
    getLocalSessionTranscriptPath,
  };
}
