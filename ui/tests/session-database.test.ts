import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

it('prepares fresh and migrated session databases without losing existing history', () => {
  const moduleUrl = new URL('../src/session-database.mjs', import.meta.url).href;
  const result = spawnSync('node', ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { DatabaseSync } from 'node:sqlite';
    import { prepareSessionStatements } from ${JSON.stringify(moduleUrl)};

    for (const legacy of [false, true]) {
      const db = new DatabaseSync(':memory:');
      try {
        if (legacy) {
          db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, workspace TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, message_count INTEGER NOT NULL, preview TEXT NOT NULL, underlying_session_id TEXT)');
          db.exec("INSERT INTO sessions VALUES ('old', 'Keep me', '/workspace', 1, 2, 1, 'preview', 'engine-id')");
        }
        let statements = prepareSessionStatements(db);
        if (legacy) {
          const [row] = statements.loadSessionsStmt.all();
          assert.equal(row.title, 'Keep me');
          assert.equal(row.underlying_session_id, 'engine-id');
          assert.equal(row.is_sub_agent, 0);
          assert.equal(row.history_json, '[]');
        }
        db.exec("INSERT INTO sessions (id,title,workspace,created_at,updated_at,message_count,preview,is_sub_agent,history_json) VALUES ('child','Child','/workspace',3,4,1,'child preview',1,'[{\\\"type\\\":\\\"user\\\"}]')");
        statements = prepareSessionStatements(db);
        assert.equal(statements.loadSubAgentSessionsStmt.all().length, 1);
        assert.equal(statements.loadSubAgentSessionsStmt.all()[0].history_json, JSON.stringify([{ type: 'user' }]));
        assert.equal(statements.loadSessionsStmt.all().length, legacy ? 1 : 0);
        statements.deleteSessionStmt.run('child');
        assert.equal(statements.loadSubAgentSessionsStmt.all().length, 0);
        if (legacy) assert.equal(statements.loadSessionsStmt.all()[0].title, 'Keep me');
      } finally { db.close(); }
    }
  `], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
});
