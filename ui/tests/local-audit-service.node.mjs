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
