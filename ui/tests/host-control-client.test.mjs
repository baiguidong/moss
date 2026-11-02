import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createUsageLedger } from '../src/usage-ledger.mjs';
import { createHostControlClient } from '../src/host/control-plane-client.mjs';

test('Host retries acknowledgements and usage without executing commands twice or leaking another account usage', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-host-control-'));
  const db = new DatabaseSync(path.join(home, 'host.sqlite'));
  const ledger = createUsageLedger(db);
  let account = 'alice', runs = 0, ackAttempts = 0, issueCommand = true, failUpload = true;
  const uploads = [], errors = [];
  const client = createHostControlClient({ home, db, kind: 'desktop', version: 'test',
    getConnection: () => ({ serverUrl: 'https://enterprise.test', accountId: account, authToken: account }),
    getStatus: () => ({}), execute: () => { runs++; }, applyPolicy: () => {}, onError: error => errors.push(error),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      if (url.endsWith('/enroll') || url.endsWith('/heartbeat')) {
        const commands = issueCommand ? [{ id: 'pause-1', action: 'pause' }] : []; issueCommand = false;
        return Response.json({ token: url.endsWith('/enroll') ? `device-${account}` : undefined, commands, policy: { revision: 0, settings: {} } });
      }
      if (url.includes('/commands/')) {
        if (++ackAttempts === 1) throw new Error('lost acknowledgement response');
        return Response.json({ ok: true });
      }
      if (url.endsWith('/usage')) {
        uploads.push({ account, events: body.events });
        if (failUpload) { failUpload = false; throw new Error('lost upload response'); }
        return Response.json({ accepted: body.events.length });
      }
      throw new Error('Unexpected endpoint');
    },
  });
  ledger.setReporter(client.attributeUsage);
  t.after(async () => { await client.stop(); db.close(); await fs.rm(home, { recursive: true, force: true }); });
  const record = id => ledger.record({ eventId: id, model: 'test', inputTokens: 10 }, { sessionId: 'session-a' });
  record('unowned-history');
  await client.refresh();
  assert.equal(runs, 1); assert.equal(ackAttempts, 1);
  record('alice-event');
  await client.refresh();
  await client.refresh();
  assert.equal(runs, 1); assert.equal(ackAttempts, 2);
  assert.deepEqual(uploads.map(batch => batch.events.map(event => event.eventId)), [['alice-event'], ['alice-event']]);
  account = 'bob'; client.invalidate();
  record('during-account-change');
  await client.refresh(); record('bob-event'); await client.refresh();
  assert.deepEqual(uploads.at(-1).events.map(event => event.eventId), ['bob-event']);
  account = 'alice'; client.invalidate(); await client.refresh();
  assert.equal(uploads.length, 3);
  assert.equal(errors.length, 2);
});

test('an account switch discards an in-flight heartbeat policy and commands', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-host-switch-'));
  const db = new DatabaseSync(path.join(home, 'host.sqlite'));
  createUsageLedger(db);
  let release, arrived, runs = 0, policies = 0;
  const entered = new Promise(resolve => { arrived = resolve; });
  const client = createHostControlClient({ home, db, kind: 'desktop', version: 'test',
    getConnection: () => ({ serverUrl: 'https://enterprise.test', accountId: 'alice', authToken: 'alice' }),
    getStatus: () => ({}), execute: () => { runs++; }, applyPolicy: () => { policies++; },
    fetchImpl: async () => { arrived(); await new Promise(resolve => { release = resolve; });
      return Response.json({ token: 'device-alice', policy: { revision: 1, settings: { bypassPermissions: true } }, commands: [{ id: 'stale', action: 'pause' }] }); },
  });
  t.after(async () => { await client.stop(); db.close(); await fs.rm(home, { recursive: true, force: true }); });
  const request = client.refresh();
  await entered;
  client.invalidate();
  const stopping = client.stop();
  release(); await request; await stopping;
  assert.equal(runs, 0); assert.equal(policies, 0);
});
