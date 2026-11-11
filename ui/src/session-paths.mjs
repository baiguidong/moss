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
  function getLocalSessionDir(sessionId, rootSessionId = sessionId) {
    return DESKTOP_DATA_PATHS.sessionRecordDir(normalizeSessionDirName(sessionId), normalizeSessionDirName(rootSessionId));
  }

  function getLocalSessionRuntimeDir(sessionId, rootSessionId = sessionId) {
    return DESKTOP_DATA_PATHS.sessionRuntimeDir(normalizeSessionDirName(sessionId), normalizeSessionDirName(rootSessionId));
  }

  function getLocalSessionEngineDir(sessionId, rootSessionId = sessionId) {
    return DESKTOP_DATA_PATHS.sessionEngineDir(normalizeSessionDirName(sessionId), normalizeSessionDirName(rootSessionId));
  }

  function getLocalSessionResourceManifestPath(sessionId, rootSessionId = sessionId) {
    return DESKTOP_DATA_PATHS.sessionResourceManifestPath(normalizeSessionDirName(sessionId), normalizeSessionDirName(rootSessionId));
  }

  function getLocalSessionTranscriptPath(sessionRecord) {
    if (!sessionRecord?.id || !sessionRecord?.underlyingSessionId) return null;
    const rootSessionId = normalizeSessionDirName(sessionRecord.storageRootSessionId || sessionRecord.id);
    return DESKTOP_DATA_PATHS.sessionTranscriptPath(
      normalizeSessionDirName(sessionRecord.id),
      normalizeSessionDirName(sessionRecord.underlyingSessionId),
      rootSessionId,
    );
  }

  return {
    getLocalSessionDir,
    getLocalSessionEngineDir,
    getLocalSessionResourceManifestPath,
    getLocalSessionTranscriptPath,
  };
}
