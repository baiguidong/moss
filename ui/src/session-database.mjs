import { migrateCronSessionIndex } from './moss-cron-scheduler.mjs';

// Owns the session table migrations and SQL statements. Main owns the database
// connection and initializes the other stores in their existing order.
export function prepareSessionStatements(sessionDb) {
  const persistSessionStmt = (() => {
    try { sessionDb.exec('ALTER TABLE sessions ADD COLUMN effort TEXT'); } catch {}
    try { sessionDb.exec('ALTER TABLE sessions ADD COLUMN project_defaults_json TEXT'); } catch {}
    try { sessionDb.exec('ALTER TABLE sessions ADD COLUMN project_creation_mode INTEGER NOT NULL DEFAULT 0'); } catch {}
    try { sessionDb.exec("ALTER TABLE sessions ADD COLUMN app_service_ids_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
    try { sessionDb.exec("ALTER TABLE sessions ADD COLUMN app_ids_json TEXT NOT NULL DEFAULT '[]'"); } catch {}
    // Migration: add columns if table exists but columns are missing
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN is_sub_agent INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN worker_summaries_json TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN agent_mode TEXT NOT NULL DEFAULT 'local'`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN remote_workspace TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN assistant_name TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN is_coordinator_mode INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN history_json TEXT NOT NULL DEFAULT '[]'`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN connector_ids_json TEXT NOT NULL DEFAULT '[]'`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN session_kind TEXT NOT NULL DEFAULT 'chat'`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN origin_channel TEXT NOT NULL DEFAULT 'desktop'`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN channel_app_id TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN channel_instance_id TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN channel_runtime_policy_json TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN source_session_id TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN cron_task_id TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN parent_session_id TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN session_role TEXT NOT NULL DEFAULT 'chat'`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN subagent_status TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN project_task_status TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN project_task_prompt TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN project_task_error TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN project_task_completed_at INTEGER`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN auto_collapse_tool_calls INTEGER`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN tool_display_mode TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN rewind_message_id TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN rewind_created_at INTEGER`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    try {
      sessionDb.exec(`ALTER TABLE sessions ADD COLUMN model_override TEXT`);
    } catch {
      // Column may already exist or table doesn't exist yet
    }
    sessionDb.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        workspace TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        message_count INTEGER NOT NULL,
        preview TEXT NOT NULL,
        agent_mode TEXT NOT NULL DEFAULT 'local',
        permission_mode TEXT,
        effort TEXT,
        is_coordinator_mode INTEGER NOT NULL DEFAULT 0,
        remote_workspace TEXT,
        underlying_session_id TEXT,
        history_json TEXT NOT NULL DEFAULT '[]',
        is_sub_agent INTEGER NOT NULL DEFAULT 0,
        worker_summaries_json TEXT,
        assistant_name TEXT,
        project_id TEXT,
        origin_channel TEXT NOT NULL DEFAULT 'desktop',
        connector_ids_json TEXT NOT NULL DEFAULT '[]',
        session_kind TEXT NOT NULL DEFAULT 'chat',
        source_session_id TEXT,
        cron_task_id TEXT,
        parent_session_id TEXT,
        session_role TEXT NOT NULL DEFAULT 'chat',
        subagent_status TEXT,
        project_task_status TEXT,
        project_task_prompt TEXT,
        project_task_error TEXT,
        project_task_completed_at INTEGER,
        auto_collapse_tool_calls INTEGER,
        tool_display_mode TEXT,
        rewind_message_id TEXT,
        rewind_created_at INTEGER,
        channel_app_id TEXT,
        channel_instance_id TEXT,
        channel_runtime_policy_json TEXT,
        app_ids_json TEXT NOT NULL DEFAULT '[]',
        app_service_ids_json TEXT NOT NULL DEFAULT '[]',
        project_defaults_json TEXT,
        project_creation_mode INTEGER NOT NULL DEFAULT 0,
        model_override TEXT
      )
    `);
    migrateCronSessionIndex(sessionDb);
    return sessionDb.prepare(`
      INSERT INTO sessions (
        id, title, workspace, created_at, updated_at, message_count, preview, agent_mode, permission_mode, is_coordinator_mode, remote_workspace, underlying_session_id, history_json, is_sub_agent, worker_summaries_json, assistant_name, project_id, origin_channel, connector_ids_json, session_kind, source_session_id, cron_task_id, parent_session_id, session_role, subagent_status, project_task_status, project_task_prompt, project_task_error, project_task_completed_at, auto_collapse_tool_calls, tool_display_mode, rewind_message_id, rewind_created_at, channel_app_id, channel_instance_id, channel_runtime_policy_json, app_ids_json, effort, app_service_ids_json, project_defaults_json, project_creation_mode, model_override
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        workspace = excluded.workspace,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        message_count = excluded.message_count,
        preview = excluded.preview,
        agent_mode = excluded.agent_mode,
        permission_mode = excluded.permission_mode,
        is_coordinator_mode = excluded.is_coordinator_mode,
        remote_workspace = excluded.remote_workspace,
        underlying_session_id = excluded.underlying_session_id,
        history_json = CASE WHEN ? THEN excluded.history_json ELSE sessions.history_json END,
        is_sub_agent = excluded.is_sub_agent,
        worker_summaries_json = excluded.worker_summaries_json,
        assistant_name = excluded.assistant_name,
        project_id = excluded.project_id,
        origin_channel = excluded.origin_channel,
        connector_ids_json = excluded.connector_ids_json,
        session_kind = excluded.session_kind,
        source_session_id = excluded.source_session_id,
        cron_task_id = excluded.cron_task_id,
        parent_session_id = excluded.parent_session_id,
        session_role = excluded.session_role,
        subagent_status = excluded.subagent_status,
        project_task_status = excluded.project_task_status,
        project_task_prompt = excluded.project_task_prompt,
        project_task_error = excluded.project_task_error,
        project_task_completed_at = excluded.project_task_completed_at,
        auto_collapse_tool_calls = excluded.auto_collapse_tool_calls,
        tool_display_mode = excluded.tool_display_mode,
        rewind_message_id = excluded.rewind_message_id,
        rewind_created_at = excluded.rewind_created_at,
        channel_app_id = excluded.channel_app_id,
        channel_instance_id = excluded.channel_instance_id,
        channel_runtime_policy_json = excluded.channel_runtime_policy_json,
        app_ids_json = excluded.app_ids_json,
        app_service_ids_json = excluded.app_service_ids_json,
        project_defaults_json = excluded.project_defaults_json,
        effort = excluded.effort,
        project_creation_mode = excluded.project_creation_mode,
        model_override = excluded.model_override
    `);
  })();
  const deleteSessionStmt = sessionDb.prepare('DELETE FROM sessions WHERE id = ?');
  sessionDb.exec(`CREATE TABLE IF NOT EXISTS session_projections (session_id TEXT PRIMARY KEY, projection_json TEXT NOT NULL)`);
  sessionDb.exec(`
    CREATE TABLE IF NOT EXISTS session_history_chunks (
      session_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, events_json TEXT NOT NULL,
      PRIMARY KEY (session_id, chunk_index)
    ) WITHOUT ROWID;
    CREATE TRIGGER IF NOT EXISTS delete_session_history_chunks AFTER DELETE ON sessions BEGIN
      DELETE FROM session_history_chunks WHERE session_id = OLD.id;
    END
  `);
  // Chunks contain comma-separated JSON events. A single read sees one committed
  // snapshot, including legacy sessions whose history is still entirely inline.
  const loadSessionHistoryStmt = sessionDb.prepare(`
    SELECT coalesce((
      SELECT '[' || group_concat(events_json, ',') || ']' FROM (
        SELECT events_json FROM session_history_chunks WHERE session_id = sessions.id ORDER BY chunk_index
      )
    ), history_json) AS history_json FROM sessions WHERE id = ?
  `);
  const putChunk = sessionDb.prepare(`
    INSERT INTO session_history_chunks VALUES (?, ?, ?) ON CONFLICT(session_id, chunk_index)
    DO UPDATE SET events_json = excluded.events_json WHERE events_json != excluded.events_json
  `);
  const trimChunks = sessionDb.prepare('DELETE FROM session_history_chunks WHERE session_id = ? AND chunk_index >= ?');
  const loadSessionProjectionsStmt = sessionDb.prepare('SELECT session_id, projection_json FROM session_projections');
  const persistSessionProjectionStmt = sessionDb.prepare(`INSERT INTO session_projections VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET projection_json = excluded.projection_json WHERE projection_json != excluded.projection_json`);
  const deleteSessionProjectionStmt = sessionDb.prepare('DELETE FROM session_projections WHERE session_id = ?');
  const loadSessionsStmt = sessionDb.prepare(`
    SELECT
      effort,
      id,
      title,
      workspace,
      created_at,
      updated_at,
      message_count,
      preview,
      agent_mode,
      permission_mode,
      is_coordinator_mode,
      remote_workspace,
      underlying_session_id,
      is_sub_agent,
      worker_summaries_json,
      assistant_name,
      project_id,
      origin_channel,
      connector_ids_json,
      session_kind,
      source_session_id,
      cron_task_id,
      parent_session_id,
      session_role,
      subagent_status,
      project_task_status,
      project_task_prompt,
      project_task_error,
      project_task_completed_at,
      auto_collapse_tool_calls,
      tool_display_mode,
      rewind_message_id,
      rewind_created_at,
      channel_app_id,
      channel_instance_id,
      channel_runtime_policy_json,
      app_ids_json,
      app_service_ids_json,
      project_defaults_json,
      project_creation_mode,
      model_override
    FROM sessions
    WHERE is_sub_agent = 0
    ORDER BY updated_at DESC
  `);
  const loadSubAgentSessionsStmt = sessionDb.prepare(`
    SELECT
      effort,
      id,
      title,
      workspace,
      created_at,
      updated_at,
      message_count,
      preview,
      agent_mode,
      permission_mode,
      is_coordinator_mode,
      remote_workspace,
      underlying_session_id,
      is_sub_agent,
      worker_summaries_json,
      assistant_name,
      project_id,
      origin_channel,
      connector_ids_json,
      session_kind,
      source_session_id,
      cron_task_id,
      parent_session_id,
      session_role,
      subagent_status,
      project_task_status,
      project_task_prompt,
      project_task_error,
      project_task_completed_at,
      auto_collapse_tool_calls,
      tool_display_mode,
      rewind_message_id,
      rewind_created_at,
      channel_app_id,
      channel_instance_id,
      channel_runtime_policy_json,
      app_ids_json,
      app_service_ids_json,
      project_defaults_json,
      project_creation_mode,
      model_override
    FROM sessions
    WHERE is_sub_agent = 1
    ORDER BY created_at ASC
  `);

  const storedRevision = sessionDb.prepare("SELECT json_extract(projection_json, '$.historyRevision') AS revision FROM session_projections WHERE session_id = ?");
  function saveSession(row, projection, history, expectedRevision) {
    sessionDb.exec('SAVEPOINT save_session');
    try {
      persistSessionStmt.run(...row);
      // An older in-memory record can outlive a replacement record for the same
      // session. Reuse chunks only against the revision that supplied them.
      const currentRevision = (history || expectedRevision !== undefined)
        ? storedRevision.get(row[0])?.revision : undefined;
      if (expectedRevision !== undefined && currentRevision !== expectedRevision) {
        sessionDb.exec('ROLLBACK TO save_session');
        sessionDb.exec('RELEASE save_session');
        return false;
      }
      // A cold open has no in-memory chunk hashes. The committed revision still
      // identifies the complete history, including its inline/chunked representation.
      if (history && currentRevision !== history.revision) {
        for (const { index, events } of history.writes) putChunk.run(row[0], index, events);
        trimChunks.run(row[0], history.hashes.length);
      }
      persistSessionProjectionStmt.run(row[0], JSON.stringify(projection));
      sessionDb.exec('RELEASE save_session');
      return true;
    } catch (error) {
      sessionDb.exec('ROLLBACK TO save_session');
      sessionDb.exec('RELEASE save_session');
      throw error;
    }
  }

  return { saveSession, deleteSessionStmt, loadSessionsStmt, loadSubAgentSessionsStmt, loadSessionHistoryStmt, loadSessionProjectionsStmt, deleteSessionProjectionStmt };
}
