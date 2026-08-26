import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createLocalAuditService } from '../src/local-audit-service.mjs';

test('local audit service persists redacted current results and preserves finding decisions', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sessions = [
    {
      id: 'local-1',
      title: 'Local session',
      workspace: '/work/project',
      agentMode: 'local',
      createdAt: 1,
      updatedAt: 2,
      history: [
        { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: { command: 'echo ok', api_key: 'secret-value' } }] } },
        { type: 'user', tool_use_result: 'Authorization: Bearer abc.def', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'ignored' }] } },
      ],
    },
    {
      id: 'cloud-1',
      title: 'Cloud session',
      workspace: '/cloud',
      agentMode: 'remote-direct',
      createdAt: 1,
      updatedAt: 2,
      history: [],
    },
  ];
  const events = [];
  const service = createLocalAuditService({
    dbPath: path.join(directory, 'audit.db'),
    getLocalSessions: () => sessions,
    onChanged: (event) => events.push(event),
  });
  t.after(() => service.close());

  const firstRun = await service.runAudit();
  assert.equal(firstRun.sessionCount, 1);
  let dashboard = service.getDashboard();
  assert.equal(dashboard.sessions.length, 1);
  assert.equal(dashboard.sessions[0].id, 'local-1');
  assert.equal(dashboard.tools[0].input.api_key, '[REDACTED]');
  assert.match(dashboard.tools[0].result, /\[REDACTED\]/);
  assert.doesNotMatch(dashboard.tools[0].result, /abc\.def/);
  assert.equal(dashboard.findings.length, 1);
  assert.equal(dashboard.findings[0].toolUseId, 'tool-1');
  assert.equal(dashboard.findings[0].toolInput.api_key, '[REDACTED]');
  assert.doesNotMatch(dashboard.findings[0].toolResult, /abc\.def/);

  service.updateFinding({ id: dashboard.findings[0].id, status: 'resolved' });
  await service.runAudit({ sessionIds: ['local-1'] });
  dashboard = service.getDashboard();
  assert.equal(dashboard.findings[0].status, 'resolved');
  assert.equal(dashboard.runs.length, 2);
  assert.equal(
    events.some((event) => event.reason === 'run-started' && event.scope?.kind === 'sessions' && event.scope.sessionIds?.[0] === 'local-1'),
    true,
  );

  const batchUpdate = service.updateFindings({ ids: [dashboard.findings[0].id], status: 'acknowledged' });
  assert.equal(batchUpdate.updatedCount, 1);
  dashboard = service.getDashboard();
  assert.equal(dashboard.findings[0].status, 'acknowledged');

  service.updateRule({ id: 'network-access', enabled: true });
  dashboard = service.getDashboard();
  assert.equal(dashboard.summary.rulesStale, true);

  sessions[0].updatedAt = 3;
  sessions[0].history.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'changed' }] } });
  const incremental = await service.runIncrementalAudit();
  assert.equal(incremental.sessionCount, 1);
  dashboard = service.getDashboard();
  assert.equal(dashboard.summary.rulesStale, true);
  assert.equal(
    events.some((event) => event.reason === 'run-started' && event.scope?.kind === 'incremental'),
    true,
  );
});

test('incremental audit skips busy and unchanged sessions', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-audit-incremental-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sessions = [{
    id: 'incremental-1',
    title: 'Incremental session',
    workspace: '/work/project',
    agentMode: 'local',
    busy: false,
    createdAt: 1,
    updatedAt: 2,
    history: [{ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }],
  }];
  const service = createLocalAuditService({
    dbPath: path.join(directory, 'audit.db'),
    getLocalSessions: () => sessions,
  });
  t.after(() => service.close());

  const first = await service.runIncrementalAudit();
  assert.equal(first.sessionCount, 1);
  const unchanged = await service.runIncrementalAudit();
  assert.deepEqual(
    { skipped: unchanged.skipped, reason: unchanged.reason, sessionCount: unchanged.sessionCount },
    { skipped: true, reason: 'unchanged', sessionCount: 0 },
  );

  sessions[0].busy = true;
  sessions[0].updatedAt = 3;
  sessions[0].history.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'while busy' }] } });
  const busy = await service.runIncrementalAudit();
  assert.equal(busy.sessionCount, 0);

  sessions[0].busy = false;
  const settled = await service.runIncrementalAudit();
  assert.equal(settled.sessionCount, 1);
  assert.equal(service.getDashboard().runs.length, 2);
});

test('serious findings are pending only until reported or processed', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-audit-alerts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sessions = [{
    id: 'alert-session',
    title: 'Alert session',
    workspace: '/work/project',
    agentMode: 'local',
    busy: false,
    createdAt: 1,
    updatedAt: 2,
    history: [{
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'danger-1', name: 'Bash', input: { command: 'rm -rf ./build' } },
          { type: 'tool_use', id: 'secret-1', name: 'Read', input: { file_path: '/work/project/.env' } },
        ],
      },
    }],
  }];
  const events = [];
  const service = createLocalAuditService({
    dbPath: path.join(directory, 'audit.db'),
    getLocalSessions: () => sessions,
    onChanged: (event) => events.push(event),
  });
  t.after(() => service.close());

  await service.runAudit();
  const pending = service.listPendingAlerts();
  assert.equal(pending.length, 2);
  assert.equal(events.findLast((event) => event.reason === 'run-completed')?.alerts.length, 2);

  service.markFindingsReported({ fingerprints: [pending[0].fingerprint] });
  service.updateFinding({ id: pending[1].findingId, status: 'resolved' });
  assert.equal(service.listPendingAlerts().length, 0);

  sessions[0].updatedAt = 3;
  sessions[0].history.push({ type: 'assistant', message: { content: [{ type: 'text', text: 'later message' }] } });
  await service.runIncrementalAudit();
  assert.equal(service.listPendingAlerts().length, 0);
  const latestFindings = service.getDashboard().findings;
  assert.equal(latestFindings.find((finding) => finding.fingerprint === pending[0].fingerprint)?.reportedAt > 0, true);
  assert.equal(latestFindings.find((finding) => finding.fingerprint === pending[1].fingerprint)?.status, 'resolved');
});

test('local audit service recovers interrupted runs on startup', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-audit-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, 'audit.db');
  const first = createLocalAuditService({ dbPath, getLocalSessions: () => [] });
  first.close();

  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE audit_rules SET config_json = '{}' WHERE id = 'outside-workspace-write'").run();
  db.prepare(`
    INSERT INTO audit_runs (id, status, scope_json, rule_snapshot_json, started_at)
    VALUES ('interrupted', 'running', '{}', '[]', 1)
  `).run();
  db.close();

  const recovered = createLocalAuditService({ dbPath, getLocalSessions: () => [] });
  t.after(() => recovered.close());
  const dashboard = recovered.getDashboard();
  assert.equal(dashboard.summary.running, false);
  assert.equal(dashboard.summary.rulesStale, false);
  assert.deepEqual(
    dashboard.rules.find((rule) => rule.id === 'outside-workspace-write').config.allowedPaths,
    ['${MOSS_HOME}/memory'],
  );
  assert.equal(dashboard.runs[0].status, 'failed');
  assert.match(dashboard.runs[0].error, /中断/);
});
