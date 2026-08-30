export function createRemoteHistoryCheckpoint(sessionRecord, lastActiveAt, { isNew = false } = {}) {
  const previous = Number(sessionRecord?.remoteLastActiveAt) || 0;
  const current = Number(lastActiveAt) || 0;
  return {
    needsRefresh: isNew || current > previous,
    commit() {
      sessionRecord.remoteLastActiveAt = current;
      sessionRecord.remoteHistorySyncError = null;
    },
  };
}

export function applyRemoteSessionTitle(sessionRecord, remoteTitle, { isNew = false } = {}) {
  const title = typeof remoteTitle === 'string' ? remoteTitle.trim() : '';
  if (!title) return false;
  if (
    !isNew
    && sessionRecord.title
    && sessionRecord.title !== 'New Session'
    && sessionRecord.title !== 'Moss Server 会话'
  ) {
    return false;
  }
  sessionRecord.title = title;
  return true;
}
