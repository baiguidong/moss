import fsp from 'node:fs/promises';
import { createLocalTranscriptSync, readTranscriptHistory } from './local-transcript-sync.mjs';
import { normalizeSessionDirName } from './session-paths.mjs';
import { applyRemoteSessionWorkspace } from './workspace-paths.mjs';
import { applyRemoteSessionHistoryTitle } from './remote-session-reconcile.mjs';
import { backfillVisibleUserMessageIds, truncateHistoryBeforeUserMessage } from './shared/turn-changes.mjs';
import { countSessionMessages } from './shared/session-message-count.mjs';
import { mergeInterruptedSessionHistory, shouldAdoptSessionHistory } from './shared/session-history-reconcile.mjs';
import { deriveSessionPreview, derivePendingPlanApproval, historyCompletenessScore, isDisplayTranscriptEntry } from './shared/session-history-display.mjs';

function sleepMs(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** JSONL recovery and synchronization; the returned watcher is disposed by Main. */
export function createSessionHistoryService({
  DESKTOP_DATA_PATHS,
  sessionPaths: { getLocalSessionEngineDir, getLocalSessionTranscriptPath },
  disposeRuntime,
  emitSessionHistory,
  emitSessionMeta,
  fetchRemoteDirectSessionContext,
  getLoadClaudeSessionSnapshotFn,
  hasActiveAgentTeam,
  isRemoteDirectSessionNotFoundError,
  mossLog,
  resolveRemoteDirectConnection,
  schedulePersistSession,
}) {
  async function loadDisplayHistoryFromLocalTranscript(sessionRecord, { requireComplete = false } = {}) {
    const transcriptPath = getLocalSessionTranscriptPath(sessionRecord);
    if (!transcriptPath) return null;
    return readTranscriptHistory(transcriptPath, { isDisplayEntry: isDisplayTranscriptEntry, requireComplete });
  }

  const localTranscriptSync = createLocalTranscriptSync({
    getPath: record => record.agentMode === 'remote-direct' || record.isSubAgent
      ? null : getLocalSessionTranscriptPath(record),
    readHistory: record => loadDisplayHistoryFromLocalTranscript(record, { requireComplete: true }),
    canSync: record => !record.busy && !record.syncingLocalTranscript && !hasActiveAgentTeam(record)
      && !Object.values(record.runtime?.getAppState?.()?.tasks || {}).some(task => task?.status === 'running'),
    invalidateRuntime: record => disposeRuntime(record),
    applyHistory: (record, history, { modifiedAt }) => {
      const filtered = applyPendingConversationRewind(record, history);
      syncSessionRecordHistory(record, filtered.history, { allowReplacement: true });
      record.updatedAt = Math.max(record.updatedAt || 0, modifiedAt);
      schedulePersistSession(record, true);
      emitSessionMeta(record);
      emitSessionHistory(record, { replaceHistory: true });
    },
    onError: (error, record) => mossLog('warn', 'session', 'Unable to synchronize local transcript', {
      sessionId: record.id, error: error.message,
    }),
  });

  async function findLatestLocalTranscriptSessionId(sessionRecord) {
    if (!sessionRecord?.id || sessionRecord.agentMode === 'remote-direct') return null;

    let entries;
    try {
      entries = await fsp.readdir(getLocalSessionEngineDir(sessionRecord.id), {
        withFileTypes: true,
      });
    } catch {
      return null;
    }

    const candidates = await Promise.all(entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map(async (entry) => {
        const engineSessionId = entry.name.slice(0, -'.jsonl'.length);
        try {
          normalizeSessionDirName(engineSessionId);
          const transcriptPath = DESKTOP_DATA_PATHS.sessionTranscriptPath(
            normalizeSessionDirName(sessionRecord.id),
            engineSessionId,
          );
          const stats = await fsp.stat(transcriptPath);
          return { engineSessionId, modifiedAt: stats.mtimeMs };
        } catch {
          return null;
        }
      }));

    return candidates
      .filter(Boolean)
      .sort((left, right) => (
        right.modifiedAt - left.modifiedAt ||
        right.engineSessionId.localeCompare(left.engineSessionId)
      ))[0]?.engineSessionId || null;
  }

  async function recoverInterruptedLocalSession(sessionRecord) {
    if (
      !sessionRecord ||
      sessionRecord.agentMode === 'remote-direct' ||
      sessionRecord.underlyingSessionId
    ) {
      return false;
    }

    const recoveredSessionId = await findLatestLocalTranscriptSessionId(sessionRecord);
    if (!recoveredSessionId) return false;

    sessionRecord.underlyingSessionId = recoveredSessionId;
    const candidateHistory = await loadDisplayHistoryFromLocalTranscript(sessionRecord);
    if (!Array.isArray(candidateHistory) || candidateHistory.length === 0) {
      sessionRecord.underlyingSessionId = null;
      return false;
    }

    const mergedHistory = mergeInterruptedSessionHistory(
      sessionRecord.history,
      candidateHistory,
    );
    if (mergedHistory === sessionRecord.history) {
      sessionRecord.underlyingSessionId = null;
      return false;
    }

    syncSessionRecordHistory(sessionRecord, mergedHistory, {
      sessionId: recoveredSessionId,
    });
    schedulePersistSession(sessionRecord, true);
    emitSessionMeta(sessionRecord);
    mossLog('info', 'session', 'Recovered interrupted local session transcript', {
      sessionId: sessionRecord.id,
      underlyingSessionId: recoveredSessionId,
      recoveredEntries: candidateHistory.length,
    });
    return true;
  }

  function syncSessionRecordHistory(sessionRecord, history, metadata = {}) {
    const nextHistory = Array.isArray(history) ? history : [];
    if (!metadata.allowReplacement && !shouldAdoptSessionHistory(sessionRecord.history, nextHistory)) {
      const enrichedHistory = backfillVisibleUserMessageIds(sessionRecord.history, nextHistory);
      if (enrichedHistory !== sessionRecord.history) {
        sessionRecord.history = enrichedHistory;
        sessionRecord.messageCount = countSessionMessages(enrichedHistory);
      }
      sessionRecord.historyLoadedFromSource = true;
      mossLog('warn', 'session', 'Ignored non-append-only session history refresh', {
        sessionId: sessionRecord.id,
        currentMessageCount: countSessionMessages(sessionRecord.history),
        candidateMessageCount: countSessionMessages(nextHistory),
        underlyingSessionId: sessionRecord.underlyingSessionId,
      });
      return false;
    }
    sessionRecord.history = nextHistory;
    sessionRecord.historyLoadedFromSource = true;
    sessionRecord.messageCount = countSessionMessages(nextHistory);
    sessionRecord.pendingPlanApproval = derivePendingPlanApproval(nextHistory);

    const derivedPreview = deriveSessionPreview(nextHistory);
    if (derivedPreview) {
      sessionRecord.preview = derivedPreview;
    }

    if (typeof metadata.sessionId === 'string' && metadata.sessionId.trim()) {
      sessionRecord.underlyingSessionId = metadata.sessionId.trim();
    }
    if (typeof metadata.customTitle === 'string' && metadata.customTitle.trim()) {
      sessionRecord.title = metadata.customTitle.trim();
    }
    if (sessionRecord.agentMode === 'remote-direct') {
      applyRemoteSessionHistoryTitle(sessionRecord);
    }
    if (typeof metadata.remoteWorkspace === 'string' && metadata.remoteWorkspace.trim()) {
      if (sessionRecord.agentMode === 'remote-direct') {
        applyRemoteSessionWorkspace(sessionRecord, metadata.remoteWorkspace);
      } else {
        sessionRecord.remoteWorkspace = metadata.remoteWorkspace.trim();
      }
    }
    return true;
  }

  function applyPendingConversationRewind(sessionRecord, history) {
    const userMessageId = typeof sessionRecord?.rewindMessageId === 'string'
      ? sessionRecord.rewindMessageId.trim()
      : '';
    if (!userMessageId) return { history, pending: false };

    const truncated = truncateHistoryBeforeUserMessage(history, userMessageId);
    if (truncated) return { history: truncated, pending: true };

    // The active transcript branch no longer contains the removed message,
    // which means a post-rewind turn has already been persisted.
    sessionRecord.rewindMessageId = null;
    sessionRecord.rewindCreatedAt = null;
    schedulePersistSession(sessionRecord, true);
    return { history, pending: false };
  }

  async function loadSessionHistoryFromSource(sessionRecord) {
    if (sessionRecord?.isSubAgent) {
      sessionRecord.historyLoadedFromSource = true;
      return Array.isArray(sessionRecord.history) ? sessionRecord.history : [];
    }
    if (!sessionRecord?.underlyingSessionId) {
      if (!(await recoverInterruptedLocalSession(sessionRecord))) {
        return sessionRecord.history;
      }
    }

    if (sessionRecord.agentMode !== 'remote-direct' && await localTranscriptSync.refresh(sessionRecord)) {
      return sessionRecord.history;
    }

    if (sessionRecord.runtime) {
      return sessionRecord.history;
    }

    if (sessionRecord.historyLoadedFromSource) {
      return sessionRecord.history;
    }

    if (sessionRecord.busy && Array.isArray(sessionRecord.history) && sessionRecord.history.length > 0) {
      return sessionRecord.history;
    }

    if (sessionRecord.agentMode === 'remote-direct') {
      const { serverUrl, authToken } = await resolveRemoteDirectConnection();
      let context;
      try {
        context = await fetchRemoteDirectSessionContext({
          serverUrl,
          authToken,
          sessionId: sessionRecord.underlyingSessionId,
        });
      } catch (error) {
        if (!isRemoteDirectSessionNotFoundError(error)) {
          throw error;
        }
        mossLog('warn', 'session', 'Remote Direct session missing on server', {
          sessionId: sessionRecord.id,
          underlyingSessionId: sessionRecord.underlyingSessionId,
        });
        sessionRecord.underlyingSessionId = null;
        sessionRecord.historyLoadedFromSource = true;
        sessionRecord.resumeReadOnlyReason = null;
        schedulePersistSession(sessionRecord, true);
        emitSessionMeta(sessionRecord);
        return sessionRecord.history;
      }
      const history = Array.isArray(context?.context?.messages) ? context.context.messages : [];
      syncSessionRecordHistory(sessionRecord, history, {
        sessionId: typeof context?.session?.sessionId === 'string'
          ? context.session.sessionId
          : sessionRecord.underlyingSessionId,
        customTitle: typeof context?.context?.customTitle === 'string'
          ? context.context.customTitle
          : undefined,
        mode: typeof context?.context?.mode === 'string'
          ? context.context.mode
          : undefined,
        remoteWorkspace: typeof context?.session?.workDir === 'string'
          ? context.session.workDir
          : undefined,
      });
      schedulePersistSession(sessionRecord);
      emitSessionMeta(sessionRecord);
      return sessionRecord.history;
    }

    const displayHistory = await loadDisplayHistoryFromLocalTranscript(sessionRecord);
    if (Array.isArray(displayHistory)) {
      const filtered = applyPendingConversationRewind(sessionRecord, displayHistory);
      syncSessionRecordHistory(sessionRecord, filtered.history, {
        allowReplacement: filtered.pending,
      });
      schedulePersistSession(sessionRecord);
      emitSessionMeta(sessionRecord);
      return sessionRecord.history;
    }

    const loadClaudeSessionSnapshot = await getLoadClaudeSessionSnapshotFn();
    const snapshot = await loadClaudeSessionSnapshot(sessionRecord.underlyingSessionId, {
      sourceJsonlFile: getLocalSessionTranscriptPath(sessionRecord) || undefined,
      cwdHint: sessionRecord.workspace,
    });
    if (!snapshot) {
      throw new Error(`无法从 Claude transcript 恢复会话：${sessionRecord.underlyingSessionId}`);
    }

    const filteredSnapshot = applyPendingConversationRewind(sessionRecord, snapshot.messages);
    syncSessionRecordHistory(sessionRecord, filteredSnapshot.history, {
      sessionId: snapshot.metadata.sourceSessionId || snapshot.metadata.sessionId,
      customTitle: snapshot.metadata.customTitle,
      mode: snapshot.metadata.mode,
      allowReplacement: filteredSnapshot.pending,
    });
    schedulePersistSession(sessionRecord);
    emitSessionMeta(sessionRecord);
    return sessionRecord.history;
  }

  async function refreshSessionHistoryFromTranscriptAfterTurn(sessionRecord) {
    if (!sessionRecord?.underlyingSessionId) return false;
    if ((sessionRecord.agentMode === 'remote-direct' ? 'remote-direct' : 'local') !== 'local') return false;

    const currentScore = historyCompletenessScore(sessionRecord.history);
    let bestHistory = null;
    let bestScore = -1;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const displayHistory = await loadDisplayHistoryFromLocalTranscript(sessionRecord);
      if (Array.isArray(displayHistory)) {
        const enrichedHistory = backfillVisibleUserMessageIds(sessionRecord.history, displayHistory);
        if (enrichedHistory !== sessionRecord.history) {
          sessionRecord.history = enrichedHistory;
          sessionRecord.messageCount = countSessionMessages(enrichedHistory);
        }
        const filtered = applyPendingConversationRewind(sessionRecord, displayHistory);
        const candidateHistory = filtered.history;
        const score = historyCompletenessScore(candidateHistory);
        if (score > bestScore) {
          bestHistory = candidateHistory;
          bestScore = score;
        }
        if (score >= currentScore) {
          break;
        }
      }
      if (attempt < 3) {
        await sleepMs(75);
      }
    }

    if (!Array.isArray(bestHistory)) return false;
    if (bestScore < currentScore) {
      return false;
    }

    if (!syncSessionRecordHistory(sessionRecord, bestHistory)) {
      return false;
    }
    schedulePersistSession(sessionRecord, true);
    return true;
  }

  return {
    localTranscriptSync,
    loadDisplayHistoryFromLocalTranscript,
    recoverInterruptedLocalSession,
    syncSessionRecordHistory,
    loadSessionHistoryFromSource,
    refreshSessionHistoryFromTranscriptAfterTurn,
  };
}
