import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { createDesktopStateStore } from '../src/desktop-state-store.mjs';
import { createSessionTaskInbox } from '../src/session-task-inbox.mjs';

function fixture(db, options = {}) {
  const records = new Map(['a', 'b'].map(id => [id, { id, underlyingSessionId: 'engine-' + id }]));
  const deliveries = [];
  const service = createSessionTaskInbox({
    db, getSession: id => records.get(id), whenIdle: async () => {}, onError: (_, error) => assert.fail(error.message),
    deliver: async (record, inbox) => {
      const receipt = inbox.peek();
      deliveries.push([record.id, receipt.value]);
      inbox.acknowledge(receipt.uuid);
    },
    ...options,
  });
  return { service, records, deliveries, bind(id) { const r = records.get(id); return service.bind(r, r.underlyingSessionId); } };
}

test('new host delivers a persisted receipt once with the existing event ID', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'moss-inbox-'));
  const file = path.join(dir, 'state.sqlite');
  let db = new DatabaseSync(file);
  try {
    const external = createDesktopStateStore(db);
    const first = fixture(db, { canRun: () => false });
    first.bind('a').publish('event', 'failed');
    assert.deepEqual(external.listQueuedTurns(), []);
    db.close();
    db = new DatabaseSync(file);
    createDesktopStateStore(db);
    const restored = fixture(db);
    restored.service.recover();
    restored.bind('a').publish('event', 'failed');
    await tick();
    restored.service.recover();
    restored.bind('a').publish('event', 'failed');
    await tick();
    assert.deepEqual(restored.deliveries, [['a', 'failed']]);
    assert.deepEqual({ ...db.prepare('SELECT id, status FROM session_turn_queue').get() }, { id: 'event', status: 'completed' });
  } finally { db.close(); await rm(dir, { recursive: true, force: true }); }
});

test('a finishing user turn can consume the receipt before the queued wake executes', async () => {
  const db = new DatabaseSync(':memory:');
  createDesktopStateStore(db);
  const idle = Promise.withResolvers();
  const { bind, deliveries } = fixture(db, { whenIdle: () => idle.promise });
  const active = bind('a');
  active.publish('first', 'complete');
  await tick();
  const receipt = active.peek();
  active.acknowledge(receipt.uuid);
  // Another result arrives at the active-to-idle boundary.
  active.publish('second', 'failed');
  idle.resolve();
  await tick();
  assert.deepEqual(deliveries, [['a', 'failed']]);
  db.close();
});

test('stop, deletion and replaced engines suppress late completions and isolate sessions', async () => {
  const db = new DatabaseSync(':memory:');
  createDesktopStateStore(db);
  const idle = Promise.withResolvers();
  const { bind, service, records, deliveries } = fixture(db, { whenIdle: () => idle.promise });
  const stopped = bind('a');
  stopped.publish('old', 'cancelled work');
  assert.equal(bind('b').peek(), undefined);
  service.cancel(records.get('a'));
  assert.equal(stopped.publish('late', 'cancelled work'), false);
  bind('a').publish('new', 'new request');
  bind('b').publish('replaced', 'old engine');
  records.get('b').underlyingSessionId = 'replacement';
  idle.resolve();
  await tick();
  assert.deepEqual(deliveries, [['a', 'new request']]);
  const deleted = bind('b');
  deleted.publish('deleting', 'pending');
  records.get('b').deleted = true;
  service.cancel(records.get('b'));
  assert.equal(deleted.publish('deleted', 'late'), false);
  await tick();
  assert.equal(db.prepare("SELECT count(*) AS n FROM session_turn_queue WHERE session_id = 'b'").get().n, 0);
  db.close();
});

test('stopping one execution preserves sibling results and allows an explicitly resumed execution', async () => {
  const db = new DatabaseSync(':memory:');
  createDesktopStateStore(db);
  const { bind, service, records, deliveries } = fixture(db);
  const original = bind('a');
  original.publish('early', 'queued before stop', 'worker');
  service.cancelTask(records.get('a'), 'worker');
  assert.equal(original.publish('late', 'after stop', 'worker'), false);
  original.publish('sibling', 'another execution', 'sibling');
  bind('a').publish('resumed', 'new turn', 'worker');
  await tick(); await tick();
  assert.deepEqual(deliveries, [['a', 'another execution'], ['a', 'new turn']]);
  db.close();
});
