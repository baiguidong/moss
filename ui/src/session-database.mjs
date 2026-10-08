import { migrateCronSessionIndex } from './moss-cron-scheduler.mjs';

// Owns the session table migrations and SQL statements. Main owns the database
// connection and initializes the other stores in their existing order.
export function prepareSessionStatements(sessionDb) {
  const persistSessionStmt = (() => {
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
        channel_runtime_policy_json TEXT
      )
    `);
    migrateCronSessionIndex(sessionDb);
    return sessionDb.prepare(`
      INSERT INTO sessions (
        id, title, workspace, created_at, updated_at, message_count, preview, agent_mode, permission_mode, is_coordinator_mode, remote_workspace, underlying_session_id, history_json, is_sub_agent, worker_summaries_json, assistant_name, project_id, origin_channel, connector_ids_json, session_kind, source_session_id, cron_task_id, parent_session_id, session_role, subagent_status, project_task_status, project_task_prompt, project_task_error, project_task_completed_at, auto_collapse_tool_calls, tool_display_mode, rewind_message_id, rewind_created_at, channel_app_id, channel_instance_id, channel_runtime_policy_json
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
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
        history_json = excluded.history_json,
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
        channel_runtime_policy_json = excluded.channel_runtime_policy_json
    `);
  })();
  const deleteSessionStmt = sessionDb.prepare('DELETE FROM sessions WHERE id = ?');
  const loadSessionsStmt = sessionDb.prepare(`
    SELECT
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
      history_json,
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
      channel_runtime_policy_json
    FROM sessions
    WHERE is_sub_agent = 0
    ORDER BY updated_at DESC
  `);
  const loadSubAgentSessionsStmt = sessionDb.prepare(`
    SELECT
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
      history_json,
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
      channel_runtime_policy_json
    FROM sessions
    WHERE is_sub_agent = 1
    ORDER BY created_at ASC
  `);

  return { persistSessionStmt, deleteSessionStmt, loadSessionsStmt, loadSubAgentSessionsStmt };
}
