import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  AUDIT_SEVERITIES,
  DEFAULT_LOCAL_AUDIT_RULES,
  evaluateLocalAuditSession,
  normalizeLocalAuditSession,
  validateAuditRuleConfig,
} from './local-audit-engine.mjs';

const MAX_INPUT_JSON_LENGTH = 32_000;
const MAX_RESULT_LENGTH = 16_000;
const FINDING_STATUSES = new Set(['open', 'acknowledged', 'resolved', 'false_positive']);

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function redactText(value, maxLength = MAX_RESULT_LENGTH) {
  return String(value || '')
    .replace(/([?&](?:access_token|refresh_token|token|code|client_secret|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:authorization|cookie)\b\s*[:=]\s*)[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .slice(0, maxLength);
}

function redactValue(value, key = '', depth = 0) {
  if (depth > 8) return '[TRUNCATED]';
  if (/token|secret|password|authorization|cookie|api[_-]?key/i.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return redactText(value, MAX_INPUT_JSON_LENGTH);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => redactValue(entry, '', depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 200).map(([entryKey, entryValue]) => [
        entryKey,
        redactValue(entryValue, entryKey, depth + 1),
      ]),
    );
  }
  return value;
}

function safeJson(value, maxLength = MAX_INPUT_JSON_LENGTH) {
  try {
    return JSON.stringify(redactValue(value)).slice(0, maxLength);
  } catch {
    return '{}';
  }
}

function mapRule(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    severity: row.severity,
    enabled: Boolean(row.enabled),
    config: parseJson(row.config_json, {}),
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function mapSession(row) {
  return {
    id: row.session_id,
    title: row.title,
    workspace: row.workspace,
    projectId: row.project_id,
    assistantName: row.assistant_name,
    sessionKind: row.session_kind,
    isSubAgent: Boolean(row.is_sub_agent),
    sourceCreatedAt: row.source_created_at,
    sourceUpdatedAt: row.source_updated_at,
    auditedAt: row.audited_at,
    latestRunId: row.latest_run_id,
    eventCount: row.event_count,
    toolCallCount: row.tool_call_count,
    findingCount: row.finding_count,
    completeness: row.completeness,
    sourcePresent: Boolean(row.source_present),
  };
}

function mapTool(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    toolUseId: row.tool_use_id,
    parentToolUseId: row.parent_tool_use_id,
    toolName: row.tool_name,
    input: parseJson(row.input_json, {}),
    result: row.result_text,
    status: row.status,
    isError: Boolean(row.is_error),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    orderIndex: row.order_index,
  };
}

function mapFinding(row) {
  return {
    id: row.id,
    runId: row.run_id,
    sessionId: row.session_id,
    sessionTitle: row.session_title,
    toolCallId: row.tool_call_id,
    toolName: row.tool_name,
    toolUseId: row.tool_use_id,
    toolInput: parseJson(row.tool_input_json, {}),
    toolResult: row.tool_result_text || '',
    toolStatus: row.tool_status,
    ruleId: row.rule_id,
    ruleName: row.rule_name,
    ruleVersion: row.rule_version,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    evidence: parseJson(row.evidence_json, {}),
    status: row.status,
    fingerprint: row.fingerprint,
    createdAt: row.created_at,
  };
}

function mapRun(row) {
  return {
    id: row.id,
    status: row.status,
    scope: parseJson(row.scope_json, {}),
    ruleSnapshot: parseJson(row.rule_snapshot_json, []),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    sessionCount: row.session_count,
    toolCallCount: row.tool_call_count,
    findingCount: row.finding_count,
    error: row.error,
  };
}

export function createLocalAuditService({ dbPath, getLocalSessions, onChanged = () => {} }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try { db.exec('PRAGMA journal_mode=WAL'); } catch {}
  try { db.exec('PRAGMA synchronous=NORMAL'); } catch {}
  try { db.exec('PRAGMA busy_timeout=5000'); } catch {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_rules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      severity TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      config_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_runs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      scope_json TEXT NOT NULL DEFAULT '{}',
      rule_snapshot_json TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      session_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      finding_count INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_sessions (
      session_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace TEXT NOT NULL,
      project_id TEXT,
      assistant_name TEXT,
      session_kind TEXT NOT NULL DEFAULT 'chat',
      is_sub_agent INTEGER NOT NULL DEFAULT 0,
      source_created_at INTEGER NOT NULL,
      source_updated_at INTEGER NOT NULL,
      audited_at INTEGER NOT NULL,
      latest_run_id TEXT NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      finding_count INTEGER NOT NULL DEFAULT 0,
      completeness TEXT NOT NULL DEFAULT 'complete',
      source_present INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS audit_tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_use_id TEXT NOT NULL,
      parent_tool_use_id TEXT,
      tool_name TEXT NOT NULL,
      input_json TEXT NOT NULL DEFAULT '{}',
      result_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      is_error INTEGER NOT NULL DEFAULT 0,
      started_at INTEGER,
      completed_at INTEGER,
      order_index INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_audit_tool_calls_session ON audit_tool_calls(session_id, order_index);
    CREATE INDEX IF NOT EXISTS idx_audit_tool_calls_name ON audit_tool_calls(tool_name);
    CREATE TABLE IF NOT EXISTS audit_findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      tool_call_id TEXT,
      rule_id TEXT NOT NULL,
      rule_version INTEGER NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      evidence_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'open',
      fingerprint TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_findings_run ON audit_findings(run_id);
    CREATE INDEX IF NOT EXISTS idx_audit_findings_session ON audit_findings(session_id);
    CREATE INDEX IF NOT EXISTS idx_audit_findings_fingerprint ON audit_findings(fingerprint, created_at DESC);
  `);
  db.prepare(`
    UPDATE audit_runs
    SET status = 'failed', completed_at = ?, error = '应用退出导致审计中断'
    WHERE status = 'running'
  `).run(Date.now());

  const insertRule = db.prepare(`
    INSERT OR IGNORE INTO audit_rules (
      id, name, description, severity, enabled, config_json, version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const initializedAt = Date.now();
  for (const rule of DEFAULT_LOCAL_AUDIT_RULES) {
    insertRule.run(
      rule.id,
      rule.name,
      rule.description,
      rule.severity,
      rule.enabled ? 1 : 0,
      JSON.stringify(rule.config || {}),
      initializedAt,
    );
  }
  const outsideWriteRule = DEFAULT_LOCAL_AUDIT_RULES.find((rule) => rule.id === 'outside-workspace-write');
  const persistedOutsideWriteRule = db.prepare('SELECT config_json FROM audit_rules WHERE id = ?').get('outside-workspace-write');
  const persistedOutsideWriteConfig = parseJson(persistedOutsideWriteRule?.config_json, {});
  if (
    outsideWriteRule
    && !Object.prototype.hasOwnProperty.call(persistedOutsideWriteConfig, 'allowedPaths')
  ) {
    db.prepare(`
      UPDATE audit_rules
      SET description = ?, config_json = ?, version = version + 1, updated_at = ?
      WHERE id = 'outside-workspace-write'
    `).run(
      outsideWriteRule.description,
      JSON.stringify({
        ...persistedOutsideWriteConfig,
        allowedPaths: outsideWriteRule.config.allowedPaths,
      }),
      initializedAt,
    );
  }

  let activeRunPromise = null;

  function listRules({ enabledOnly = false } = {}) {
    const rows = db.prepare(`
      SELECT id, name, description, severity, enabled, config_json, version, updated_at
      FROM audit_rules
      ${enabledOnly ? 'WHERE enabled = 1' : ''}
      ORDER BY name COLLATE NOCASE
    `).all();
    return rows.map(mapRule);
  }

  function getDashboard() {
    const sessions = db.prepare(`
      SELECT * FROM audit_sessions ORDER BY source_updated_at DESC LIMIT 2000
    `).all().map(mapSession);
    const tools = db.prepare(`
      SELECT t.*, s.title AS session_title
      FROM audit_tool_calls t
      JOIN audit_sessions s ON s.session_id = t.session_id AND s.source_present = 1
      ORDER BY COALESCE(t.started_at, 0) DESC, t.order_index DESC
      LIMIT 2000
    `).all().map(mapTool);
    const findings = db.prepare(`
      SELECT
        f.*,
        s.title AS session_title,
        t.tool_name,
        t.tool_use_id,
        t.input_json AS tool_input_json,
        t.result_text AS tool_result_text,
        t.status AS tool_status,
        r.name AS rule_name
      FROM audit_findings f
      JOIN audit_sessions s ON s.session_id = f.session_id AND s.latest_run_id = f.run_id
      LEFT JOIN audit_tool_calls t ON t.id = f.tool_call_id
      LEFT JOIN audit_rules r ON r.id = f.rule_id
      ORDER BY
        CASE f.severity WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
        f.created_at DESC
      LIMIT 2000
    `).all().map(mapFinding);
    const runs = db.prepare(`
      SELECT * FROM audit_runs ORDER BY started_at DESC LIMIT 100
    `).all().map(mapRun);
    const rules = listRules();
    const latestCompletedRun = runs.find((run) => run.status === 'completed');
    const latestCompletedAt = latestCompletedRun?.completedAt || 0;
    const auditedRuleVersions = new Map(
      (latestCompletedRun?.ruleSnapshot || []).map((rule) => [rule.id, rule.version]),
    );
    const rulesStale = Boolean(latestCompletedRun) && rules.some((rule) => {
      const auditedVersion = auditedRuleVersions.get(rule.id);
      return rule.enabled ? auditedVersion !== rule.version : auditedVersion != null;
    });
    return {
      summary: {
        sessionCount: sessions.filter((session) => session.sourcePresent).length,
        toolCallCount: tools.length,
        findingCount: findings.length,
        openFindingCount: findings.filter((finding) => finding.status === 'open').length,
        criticalFindingCount: findings.filter((finding) => finding.severity === 'critical').length,
        incompleteSessionCount: sessions.filter((session) => session.sourcePresent && session.completeness !== 'complete').length,
        latestCompletedAt,
        rulesStale,
        running: runs.some((run) => run.status === 'running'),
      },
      sessions,
      tools,
      findings,
      rules,
      runs,
    };
  }

  function updateRule(payload = {}) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const currentRow = db.prepare('SELECT * FROM audit_rules WHERE id = ?').get(id);
    if (!currentRow) throw new Error(`Unknown audit rule: ${id}`);
    const severity = payload.severity == null ? currentRow.severity : String(payload.severity);
    if (!AUDIT_SEVERITIES.includes(severity)) throw new Error(`Invalid audit severity: ${severity}`);
    const config = payload.config == null
      ? parseJson(currentRow.config_json, {})
      : validateAuditRuleConfig(id, payload.config);
    const enabled = payload.enabled == null ? Boolean(currentRow.enabled) : Boolean(payload.enabled);
    const now = Date.now();
    db.prepare(`
      UPDATE audit_rules
      SET severity = ?, enabled = ?, config_json = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `).run(severity, enabled ? 1 : 0, JSON.stringify(config), now, id);
    onChanged({ reason: 'rule-updated', ruleId: id });
    return listRules().find((rule) => rule.id === id);
  }

  function updateFinding(payload = {}) {
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const status = String(payload.status || '');
    if (!id) throw new Error('Finding id is required.');
    if (!FINDING_STATUSES.has(status)) throw new Error(`Invalid finding status: ${status}`);
    const result = db.prepare('UPDATE audit_findings SET status = ? WHERE id = ?').run(status, id);
    if (!result.changes) throw new Error(`Unknown audit finding: ${id}`);
    onChanged({ reason: 'finding-updated', findingId: id });
    return { ok: true };
  }

  function updateFindings(payload = {}) {
    const ids = Array.isArray(payload.ids)
      ? [...new Set(payload.ids.map((entry) => String(entry).trim()).filter(Boolean))].slice(0, 5000)
      : [];
    const status = String(payload.status || '');
    if (ids.length === 0) throw new Error('At least one finding id is required.');
    if (!FINDING_STATUSES.has(status)) throw new Error(`Invalid finding status: ${status}`);
    const update = db.prepare('UPDATE audit_findings SET status = ? WHERE id = ?');
    let updatedCount = 0;
    db.exec('BEGIN');
    try {
      for (const id of ids) updatedCount += Number(update.run(status, id).changes) || 0;
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    if (updatedCount === 0) throw new Error('No audit findings were updated.');
    onChanged({ reason: 'findings-updated', findingIds: ids, updatedCount });
    return { ok: true, updatedCount };
  }

  async function executeAudit(payload = {}) {
    const requestedIds = Array.isArray(payload.sessionIds)
      ? new Set(payload.sessionIds.map((entry) => String(entry)).filter(Boolean))
      : null;
    const snapshots = (await Promise.resolve(getLocalSessions()))
      .filter((session) => session && session.agentMode !== 'remote-direct')
      .filter((session) => !requestedIds || requestedIds.has(session.id));
    const rules = listRules({ enabledOnly: true });
    const runId = randomUUID();
    const startedAt = Date.now();
    const scope = requestedIds ? { kind: 'sessions', sessionIds: [...requestedIds] } : { kind: 'all-local' };
    db.prepare(`
      INSERT INTO audit_runs (id, status, scope_json, rule_snapshot_json, started_at)
      VALUES (?, 'running', ?, ?, ?)
    `).run(runId, JSON.stringify(scope), JSON.stringify(rules), startedAt);
    if (!requestedIds) db.exec('UPDATE audit_sessions SET source_present = 0');
    onChanged({ reason: 'run-started', runId, scope, total: snapshots.length });

    let toolCallCount = 0;
    let findingCount = 0;
    try {
      for (let index = 0; index < snapshots.length; index += 1) {
        const session = snapshots[index];
        const normalized = normalizeLocalAuditSession(session);
        const findings = evaluateLocalAuditSession(session, normalized, rules);
        const auditedAt = Date.now();
        db.exec('BEGIN');
        try {
          db.prepare('DELETE FROM audit_tool_calls WHERE session_id = ?').run(session.id);
          const insertTool = db.prepare(`
            INSERT INTO audit_tool_calls (
              id, session_id, tool_use_id, parent_tool_use_id, tool_name, input_json,
              result_text, status, is_error, started_at, completed_at, order_index
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const tool of normalized.tools) {
            insertTool.run(
              tool.id,
              session.id,
              tool.toolUseId,
              tool.parentToolUseId,
              tool.toolName,
              safeJson(tool.input),
              redactText(tool.result),
              tool.status,
              tool.isError ? 1 : 0,
              tool.startedAt,
              tool.completedAt,
              tool.orderIndex,
            );
          }
          const insertFinding = db.prepare(`
            INSERT INTO audit_findings (
              id, run_id, session_id, tool_call_id, rule_id, rule_version, severity,
              title, detail, evidence_json, status, fingerprint, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          for (const finding of findings) {
            const previous = db.prepare(`
              SELECT status FROM audit_findings
              WHERE fingerprint = ? AND status <> 'open'
              ORDER BY created_at DESC LIMIT 1
            `).get(finding.fingerprint);
            insertFinding.run(
              randomUUID(),
              runId,
              session.id,
              finding.toolCallId,
              finding.ruleId,
              finding.ruleVersion,
              finding.severity,
              finding.title,
              redactText(finding.detail, 4_000),
              safeJson(finding.evidence),
              previous?.status || 'open',
              finding.fingerprint,
              auditedAt,
            );
          }
          db.prepare(`
            INSERT INTO audit_sessions (
              session_id, title, workspace, project_id, assistant_name, session_kind,
              is_sub_agent, source_created_at, source_updated_at, audited_at, latest_run_id,
              event_count, tool_call_count, finding_count, completeness, source_present
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(session_id) DO UPDATE SET
              title = excluded.title,
              workspace = excluded.workspace,
              project_id = excluded.project_id,
              assistant_name = excluded.assistant_name,
              session_kind = excluded.session_kind,
              is_sub_agent = excluded.is_sub_agent,
              source_created_at = excluded.source_created_at,
              source_updated_at = excluded.source_updated_at,
              audited_at = excluded.audited_at,
              latest_run_id = excluded.latest_run_id,
              event_count = excluded.event_count,
              tool_call_count = excluded.tool_call_count,
              finding_count = excluded.finding_count,
              completeness = excluded.completeness,
              source_present = 1
          `).run(
            session.id,
            String(session.title || '未命名会话'),
            String(session.workspace || ''),
            session.projectId || null,
            session.assistantName || null,
            session.sessionKind === 'cron' ? 'cron' : 'chat',
            session.isSubAgent ? 1 : 0,
            Number(session.createdAt) || auditedAt,
            Number(session.updatedAt) || auditedAt,
            auditedAt,
            runId,
            normalized.eventCount,
            normalized.tools.length,
            findings.length,
            normalized.completeness,
          );
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        toolCallCount += normalized.tools.length;
        findingCount += findings.length;
        if (index % 10 === 9) {
          onChanged({ reason: 'run-progress', runId, scope, completed: index + 1, total: snapshots.length });
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
      const completedAt = Date.now();
      db.prepare(`
        UPDATE audit_runs
        SET status = 'completed', completed_at = ?, session_count = ?, tool_call_count = ?, finding_count = ?
        WHERE id = ?
      `).run(completedAt, snapshots.length, toolCallCount, findingCount, runId);
      onChanged({ reason: 'run-completed', runId, scope });
      return { ok: true, runId, sessionCount: snapshots.length, toolCallCount, findingCount };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(`
        UPDATE audit_runs SET status = 'failed', completed_at = ?, error = ? WHERE id = ?
      `).run(Date.now(), redactText(message, 4_000), runId);
      onChanged({ reason: 'run-failed', runId, scope, error: message });
      throw error;
    }
  }

  function runAudit(payload = {}) {
    if (activeRunPromise) return activeRunPromise;
    activeRunPromise = executeAudit(payload).finally(() => {
      activeRunPromise = null;
    });
    return activeRunPromise;
  }

  return {
    dbPath,
    getDashboard,
    listRules,
    updateRule,
    updateFinding,
    updateFindings,
    runAudit,
    close: () => db.close(),
  };
}

export function registerLocalAuditIpcHandlers({ ipcMain, service }) {
  ipcMain.handle('audit:get-dashboard', () => service.getDashboard());
  ipcMain.handle('audit:run', (_event, payload = {}) => service.runAudit(payload));
  ipcMain.handle('audit:update-rule', (_event, payload = {}) => service.updateRule(payload));
  ipcMain.handle('audit:update-finding', (_event, payload = {}) => service.updateFinding(payload));
  ipcMain.handle('audit:update-findings', (_event, payload = {}) => service.updateFindings(payload));
}
