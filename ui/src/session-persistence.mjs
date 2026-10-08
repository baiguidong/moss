import { hasFile } from './shared/file-path-utils.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { DESKTOP_SESSION_KIND, DESKTOP_SESSION_LAYOUT_VERSION } from './desktop-data-layout.mjs';
import { normalizePermissionMode } from './permission-modes.mjs';
import { applyRemoteSessionWorkspace } from './workspace-paths.mjs';
import { applyRemoteSessionHistoryTitle } from './remote-session-reconcile.mjs';
import { normalizeOptionalProjectId, PROJECT_TASK_STATUSES } from './shared/project-normalization.mjs';
import { normalizeStringList } from './shared/string-list.mjs';
import { normalizeSessionKind, normalizeOriginChannel, normalizeToolDisplayMode } from './shared/session-normalization.mjs';
import { deriveSessionPreview, derivePendingPlanApproval } from './shared/session-history-display.mjs';

/** Metadata/history caches; Main owns the database and session records.
 * Settings and Trace Host are read lazily because they can change after startup.
 */
export function createSessionPersistence({
  statements: { persistSessionStmt, deleteSessionStmt, loadSessionsStmt, loadSubAgentSessionsStmt },
  sessions,
  subAgentSessions,
  DESKTOP_DATA_PATHS,
  sessionPaths: { getLocalSessionDir, getLocalSessionEngineDir },
  sessionSearchIndex,
  remoteSessionDeletions,
  getSettings,
  getTraceHost,
  getDesktopAgentMode,
  mossLog,
}) {
  function toPersistedSessionRow(sessionRecord, isSubAgent = false) {
    return [
      sessionRecord.id,
      sessionRecord.title,
      sessionRecord.workspace,
      sessionRecord.createdAt,
      sessionRecord.updatedAt,
      sessionRecord.messageCount,
      sessionRecord.preview || '',
      sessionRecord.agentMode === 'remote-direct' ? 'remote-direct' : 'local',
      normalizePermissionMode(sessionRecord.permissionMode, getSettings().permissionMode),
      sessionRecord.isCoordinatorMode ? 1 : 0,
      sessionRecord.remoteWorkspace || null,
      sessionRecord.underlyingSessionId,
      serializeSessionHistory(sessionRecord.history),
      isSubAgent ? 1 : 0,
      sessionRecord.workerSummariesJson || null,
      sessionRecord.assistantName || null,
      sessionRecord.projectId || null,
      normalizeOriginChannel(sessionRecord.originChannel, sessionRecord.sessionKind),
      JSON.stringify(normalizeStringList(sessionRecord.connectorIds)),
      normalizeSessionKind(sessionRecord.sessionKind),
      sessionRecord.sourceSessionId || null,
      sessionRecord.cronTaskId || null,
      sessionRecord.parentSessionId || null,
      sessionRecord.sessionRole || 'chat',
      sessionRecord.subagentStatus || null,
      PROJECT_TASK_STATUSES.has(sessionRecord.projectTaskStatus) ? sessionRecord.projectTaskStatus : null,
      sessionRecord.projectTaskPrompt || null,
      sessionRecord.projectTaskError || null,
      Number.isFinite(sessionRecord.projectTaskCompletedAt) ? sessionRecord.projectTaskCompletedAt : null,
      typeof sessionRecord.autoCollapseToolCalls === 'boolean'
        ? (sessionRecord.autoCollapseToolCalls ? 1 : 0)
        : null,
      normalizeToolDisplayMode(sessionRecord.toolDisplayMode),
      sessionRecord.rewindMessageId || null,
      Number.isFinite(sessionRecord.rewindCreatedAt) ? sessionRecord.rewindCreatedAt : null,
      sessionRecord.channelAppId || null,
      sessionRecord.channelInstanceId || null,
      sessionRecord.channelRuntimePolicy && typeof sessionRecord.channelRuntimePolicy === 'object'
        ? JSON.stringify(sessionRecord.channelRuntimePolicy)
        : null,
    ];
  }

  function serializeSessionHistory(history) {
    try {
      return JSON.stringify(Array.isArray(history) ? history : []);
    } catch {
      return '[]';
    }
  }

  function parsePersistedSessionHistory(value) {
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function parsePersistedStringList(value) {
    if (Array.isArray(value)) return normalizeStringList(value);
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      return normalizeStringList(JSON.parse(value));
    } catch {
      return [];
    }
  }

  function parsePersistedObject(value) {
    if (!value || typeof value !== 'string') return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function toSessionManifest(sessionRecord, isSubAgent = false) {
    return {
      kind: DESKTOP_SESSION_KIND,
      layoutVersion: DESKTOP_SESSION_LAYOUT_VERSION,
      id: sessionRecord.id,
      title: sessionRecord.sessionKind === 'agent-mail' && sessionRecord.title === 'Agent Mail'
        ? '协作邮箱'
        : sessionRecord.title,
      workspace: sessionRecord.workspace,
      remoteWorkspace: sessionRecord.remoteWorkspace || null,
      agentMode: sessionRecord.agentMode === 'remote-direct' ? 'remote-direct' : 'local',
      permissionMode: normalizePermissionMode(sessionRecord.permissionMode, getSettings().permissionMode),
      isCoordinatorMode: Boolean(sessionRecord.isCoordinatorMode),
      createdAt: sessionRecord.createdAt,
      updatedAt: sessionRecord.updatedAt,
      messageCount: sessionRecord.messageCount,
      preview: sessionRecord.preview || '',
      underlyingSessionId: sessionRecord.underlyingSessionId || null,
      isSubAgent: Boolean(isSubAgent),
      assistantName: sessionRecord.assistantName || null,
      projectId: sessionRecord.projectId || null,
      connectorIds: normalizeStringList(sessionRecord.connectorIds),
      sessionKind: normalizeSessionKind(sessionRecord.sessionKind),
      originChannel: normalizeOriginChannel(sessionRecord.originChannel, sessionRecord.sessionKind),
      channelAppId: sessionRecord.channelAppId || null,
      channelInstanceId: sessionRecord.channelInstanceId || null,
      channelRuntimePolicy: sessionRecord.channelRuntimePolicy || null,
      sourceSessionId: sessionRecord.sourceSessionId || null,
      sourceSessionTitle: sessionRecord.sourceSessionId
        ? sessions.get(sessionRecord.sourceSessionId)?.title || null
        : null,
      cronTaskId: sessionRecord.cronTaskId || null,
      parentSessionId: sessionRecord.parentSessionId || null,
      sessionRole: sessionRecord.sessionRole || 'chat',
      subagentStatus: sessionRecord.subagentStatus || null,
      workerName: sessionRecord.workerName || null,
      projectTaskStatus: PROJECT_TASK_STATUSES.has(sessionRecord.projectTaskStatus)
        ? sessionRecord.projectTaskStatus
        : null,
      projectTaskPrompt: sessionRecord.projectTaskPrompt || '',
      projectTaskError: sessionRecord.projectTaskError || '',
      projectTaskCompletedAt: Number.isFinite(sessionRecord.projectTaskCompletedAt)
        ? sessionRecord.projectTaskCompletedAt
        : null,
      toolDisplayMode: normalizeToolDisplayMode(
        sessionRecord.toolDisplayMode,
        sessionRecord.autoCollapseToolCalls,
      ),
    };
  }

  function persistSessionManifest(sessionRecord, isSubAgent = false) {
    try {
      const sessionDir = getLocalSessionDir(sessionRecord.id);
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.mkdirSync(getLocalSessionEngineDir(sessionRecord.id), { recursive: true });
      fs.writeFileSync(
        path.join(sessionDir, 'session.json'),
        `${JSON.stringify(toSessionManifest(sessionRecord, isSubAgent), null, 2)}\n`,
        'utf8',
      );
    } catch (error) {
      mossLog('warn', 'session', 'Failed to persist session manifest', {
        sessionId: sessionRecord?.id,
        error: error?.message || String(error),
      });
    }
  }

  function syncSessionSearchIndexBestEffort(sessionRecord) {
    try {
      sessionSearchIndex.syncSession(sessionRecord);
    } catch (error) {
      mossLog('warn', 'session-search', 'Failed to update session search index', {
        sessionId: sessionRecord?.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function persistSessionRecord(sessionRecord, isSubAgent = false) {
    if (sessionRecord?.deleted) return;
    persistSessionStmt.run(...toPersistedSessionRow(sessionRecord, isSubAgent));
    if (!sessionRecord.busy) syncSessionSearchIndexBestEffort(sessionRecord);
    persistSessionManifest(sessionRecord, isSubAgent);
    void getTraceHost()?.recordSession(sessionRecord).catch(error => mossLog('warn', 'trace', error.message));
  }

  function flushPendingSessionPersist(sessionRecord) {
    if (sessionRecord.persistTimer) {
      clearTimeout(sessionRecord.persistTimer);
      sessionRecord.persistTimer = null;
    }
    persistSessionRecord(sessionRecord, sessionRecord.isSubAgent);
  }

  function schedulePersistSession(sessionRecord, immediate = false) {
    if (sessionRecord?.deleted) return;
    if (immediate) {
      flushPendingSessionPersist(sessionRecord);
      return;
    }
    if (sessionRecord.persistTimer) return;
    sessionRecord.persistTimer = setTimeout(() => {
      sessionRecord.persistTimer = null;
      persistSessionRecord(sessionRecord, sessionRecord.isSubAgent);
    }, 200);
  }

  function deletePersistedSession(sessionId) {
    deleteSessionStmt.run(sessionId);
    try {
      sessionSearchIndex.deleteSession(sessionId);
    } catch (error) {
      mossLog('warn', 'session-search', 'Failed to delete session search index entry', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function inferPersistedSessionAgentMode(row) {
    if (row?.agent_mode === 'remote-direct') {
      return 'remote-direct';
    }
    if (row?.agent_mode === 'local') {
      return 'local';
    }
    if (getDesktopAgentMode() !== 'remote-direct') {
      return 'local';
    }

    const sessionId = typeof row?.underlying_session_id === 'string'
      ? row.underlying_session_id.trim()
      : '';
    const uiSessionId = typeof row?.id === 'string' ? row.id.trim() : '';
    if (!uiSessionId || !sessionId) {
      return 'local';
    }

    const transcriptPath = DESKTOP_DATA_PATHS.sessionTranscriptPath(uiSessionId, sessionId);
    return transcriptPath && hasFile(transcriptPath) ? 'local' : 'remote-direct';
  }

  function hydratePersistedSessions() {
    const rows = loadSessionsStmt.all();
    for (const row of rows) {
      const agentMode = inferPersistedSessionAgentMode(row);
      if (agentMode === 'remote-direct' && remoteSessionDeletions.has(row.underlying_session_id)) continue;
      const history = parsePersistedSessionHistory(row.history_json);
      const preview = row.preview || deriveSessionPreview(history) || '';
      const messageCount = Number(row.message_count) || 0;
      const sessionRecord = {
        id: row.id,
        title: row.title,
        workspace: row.workspace,
        remoteWorkspace: agentMode === 'remote-direct'
          ? (typeof row.remote_workspace === 'string' && row.remote_workspace.trim()
            ? row.remote_workspace.trim()
            : null)
          : null,
        agentMode,
        permissionMode: normalizePermissionMode(row.permission_mode, getSettings().permissionMode),
        sessionDir: getLocalSessionDir(row.id),
        isCoordinatorMode: Boolean(row.is_coordinator_mode || row.project_id),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        busy: false,
        busyStartedAt: null,
        messageCount,
        preview,
        underlyingSessionId: row.underlying_session_id || null,
        pendingPlanApproval: derivePendingPlanApproval(history),
        history,
        historyLoadedFromSource: false,
        workerSummariesJson: row.worker_summaries_json || null,
        runtime: null,
        pendingMcpRuntimeReload: false,
        resumeReadOnlyReason: null,
        workspaceWatcher: null,
        workspaceWatcherSyncTimer: null,
        subagentDirWatcher: null,
        subagentDirWatcherPath: null,
        persistTimer: null,
        isSubAgent: false,
        assistantName: row.assistant_name || null,
        assistantSystemPrompt: '',
        projectId: normalizeOptionalProjectId(row.project_id),
        connectorIds: parsePersistedStringList(row.connector_ids_json),
        sessionKind: normalizeSessionKind(row.session_kind),
        originChannel: normalizeOriginChannel(row.origin_channel, row.session_kind),
        sourceSessionId: row.source_session_id || null,
        cronTaskId: row.cron_task_id || null,
        parentSessionId: row.parent_session_id || null,
        sessionRole: row.session_role || 'chat',
        subagentStatus: row.subagent_status || null,
        projectTaskStatus: PROJECT_TASK_STATUSES.has(row.project_task_status)
          ? row.project_task_status
          : row.project_id && !row.parent_session_id ? 'working' : null,
        projectTaskPrompt: typeof row.project_task_prompt === 'string' ? row.project_task_prompt : '',
        projectTaskError: typeof row.project_task_error === 'string' ? row.project_task_error : '',
        projectTaskCompletedAt: Number.isFinite(row.project_task_completed_at)
          ? row.project_task_completed_at
          : null,
        toolDisplayMode: normalizeToolDisplayMode(
          row.tool_display_mode,
          row.auto_collapse_tool_calls == null ? null : Boolean(row.auto_collapse_tool_calls),
        ),
        rewindMessageId: row.rewind_message_id || null,
        rewindCreatedAt: Number.isFinite(row.rewind_created_at) ? row.rewind_created_at : null,
        channelAppId: row.channel_app_id || null,
        channelInstanceId: row.channel_instance_id || null,
        channelRuntimePolicy: parsePersistedObject(row.channel_runtime_policy_json),
      };
      if (agentMode === 'remote-direct') {
        applyRemoteSessionWorkspace(sessionRecord, sessionRecord.remoteWorkspace);
        applyRemoteSessionHistoryTitle(sessionRecord);
      }
      sessions.set(sessionRecord.id, sessionRecord);
      syncSessionSearchIndexBestEffort(sessionRecord);
    }

    // Load sub-agent sessions
    const subAgentRows = loadSubAgentSessionsStmt.all();
    for (const row of subAgentRows) {
      const agentMode = inferPersistedSessionAgentMode(row);
      const history = parsePersistedSessionHistory(row.history_json);
      const preview = row.preview || deriveSessionPreview(history) || '';
      const messageCount = Number(row.message_count) || 0;
      const sessionRecord = {
        id: row.id,
        title: row.title,
        workspace: row.workspace,
        remoteWorkspace: agentMode === 'remote-direct'
          ? (typeof row.remote_workspace === 'string' && row.remote_workspace.trim()
            ? row.remote_workspace.trim()
            : null)
          : null,
        agentMode,
        permissionMode: normalizePermissionMode(row.permission_mode, getSettings().permissionMode),
        sessionDir: getLocalSessionDir(row.id),
        isCoordinatorMode: false,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        busy: false,
        busyStartedAt: null,
        messageCount,
        preview,
        underlyingSessionId: row.underlying_session_id || null,
        pendingPlanApproval: derivePendingPlanApproval(history),
        history,
        historyLoadedFromSource: false,
        workerSummariesJson: row.worker_summaries_json || null,
        runtime: null,
        pendingMcpRuntimeReload: false,
        resumeReadOnlyReason: '子会话记录为只读，请返回主会话继续协调。',
        workspaceWatcher: null,
        workspaceWatcherSyncTimer: null,
        persistTimer: null,
        isSubAgent: true,
        assistantName: row.assistant_name || null,
        assistantSystemPrompt: '',
        projectId: normalizeOptionalProjectId(row.project_id),
        connectorIds: parsePersistedStringList(row.connector_ids_json),
        sessionKind: normalizeSessionKind(row.session_kind),
        originChannel: normalizeOriginChannel(row.origin_channel, row.session_kind),
        sourceSessionId: row.source_session_id || null,
        cronTaskId: row.cron_task_id || null,
        parentSessionId: row.parent_session_id || null,
        sessionRole: row.session_role || 'chat',
        subagentStatus: row.subagent_status || 'completed',
        projectTaskStatus: null,
        projectTaskPrompt: '',
        projectTaskError: '',
        projectTaskCompletedAt: null,
        toolDisplayMode: normalizeToolDisplayMode(
          row.tool_display_mode,
          row.auto_collapse_tool_calls == null ? null : Boolean(row.auto_collapse_tool_calls),
        ),
        rewindMessageId: null,
        rewindCreatedAt: null,
        channelAppId: row.channel_app_id || null,
        channelInstanceId: row.channel_instance_id || null,
        channelRuntimePolicy: parsePersistedObject(row.channel_runtime_policy_json),
      };
      if (agentMode === 'remote-direct') {
        applyRemoteSessionWorkspace(sessionRecord, sessionRecord.remoteWorkspace);
      }
      subAgentSessions.set(sessionRecord.id, sessionRecord);
      syncSessionSearchIndexBestEffort(sessionRecord);
    }
  }


  return {
    persistSessionRecord,
    schedulePersistSession,
    flushPendingSessionPersist,
    deletePersistedSession,
    hydratePersistedSessions,
  };
}
