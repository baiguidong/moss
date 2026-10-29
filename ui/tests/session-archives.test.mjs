import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSessionArchives } from '../src/session-archives.mjs';

function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const records = [{ id: 'parent', title: 'Work', updatedAt: 123 }, { id: 'child', parentSessionId: 'parent', isSubAgent: true }, { id: 'grandchild', parentSessionId: 'child', isSubAgent: true }];
  const events = [], options = { db, getRecords: () => records, isBusy: record => record.busy, onChanged: value => events.push(value), now: () => 999 };
  return { db, records, events, options, store: createSessionArchives(options) };
}
test('archival survives store reload, hides descendants, preserves timestamps, and restores the tree', t => {
  const f = fixture(t);
  f.store.set({ sessionId: 'parent', archived: true });
  assert.deepEqual(f.records.map(item => f.store.archivedAt(item)), [999, 999, 999]);
  assert.equal(f.records[0].updatedAt, 123);
  const loaded = createSessionArchives(f.options);
  assert.deepEqual(loaded.list(), [{ id: 'parent', title: 'Work', updatedAt: 123, archivedAt: 999, subagents: 2 }]);
  loaded.set({ sessionId: 'parent', archived: false });
  assert.equal(loaded.list().length, 0);
  assert.equal(loaded.archivedAt(f.records[2]), null);
  assert.deepEqual(f.events, [{ ids: ['parent', 'child', 'grandchild'], archived: true }, { ids: ['parent', 'child', 'grandchild'], archived: false }]);
});
test('busy descendants and unsupported roots cannot be archived', t => {
  const f = fixture(t); f.records[2].busy = true;
  assert.throws(() => f.store.set({ sessionId: 'parent', archived: true }), /使用中/);
  assert.equal(f.store.list().length, 0); f.records[2].busy = false;
  for (const extra of [{ agentMode: 'remote-direct' }, { projectId: 'p' }, { appTestRunId: 'test' }, { sessionKind: 'agent-mail' }]) {
    f.records.push({ id: 'other', ...extra });
    assert.throws(() => f.store.set({ sessionId: 'other', archived: true }), /独立会话/);
    f.records.pop();
  }
  assert.throws(() => f.store.set({ sessionId: 'child', archived: true }), /独立会话/);
  assert.throws(() => f.store.set({ sessionId: 'parent', archived: 'true' }), /归档或恢复/);
});
test('delete removes archival metadata and cyclic parent data terminates', t => {
  const f = fixture(t); f.store.set({ sessionId: 'parent', archived: true }); f.store.forget('parent');
  assert.equal(createSessionArchives(f.options).list().length, 0);
  f.records.push({ id: 'a', parentSessionId: 'b' }, { id: 'b', parentSessionId: 'a' });
  assert.equal(f.store.archivedAt(f.records.at(-1)), null);
});
