import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createAgentMailPoller } from '../src/agent-mail-poller.mjs';
import { createAgentMailStore } from '../src/agent-mail-store.mjs';

function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) return reject(new Error('Timed out waiting for Agent Mail state.'));
      setTimeout(check, 5);
    };
    check();
  });
}

function waitForAbort(signal) {
  return new Promise((_, reject) => {
    const abort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

const db = new DatabaseSync(':memory:');
const store = createAgentMailStore(db);
const calls = [];
let pullCount = 0;
let manualMessage = null;
let manualContext = null;
const connection = {
  serverUrl: 'https://moss.test',
  authToken: 'secret',
  mailboxKey: 'mailbox:account-1',
};
const message = {
  messageId: 'mail-1',
  fromUserId: 'alice',
  fromName: 'Alice',
  subject: 'Build',
  content: 'Inspect build 42.',
  deliveryMode: 'manual',
  expiresAt: Date.now() + 60_000,
};

const poller = createAgentMailPoller({
  consumerId: 'desktop-1',
  store,
  getEnabled: () => true,
  getConnection: async () => connection,
  runMessage: async (received, context) => {
    calls.push(`run:${received.messageId}`);
    assert.equal(context.serverUrl, 'https://moss.test');
    assert.equal(context.mailboxKey, 'mailbox:account-1');
    assert.equal(context.mailConnection.authToken, 'secret');
    assert.equal(context.mailConnection.mailboxKey, 'mailbox:account-1');
    if (received.messageId === 'mail-1') {
      assert.equal(context.sessionId, 'session-mail-1');
    }
    if (received.messageId === 'mail-fail') throw new Error('model api failed');
  },
  onManualMessage: (received, context) => {
    manualMessage = received;
    manualContext = context;
  },
  api: {
    pullAgentMail: async (_connection, _input, options) => {
      pullCount += 1;
      if (pullCount === 1) {
        return {
          leaseToken: 'lease-1',
          leaseUntil: Date.now() + 60_000,
          messages: [message],
        };
      }
      return waitForAbort(options.signal);
    },
    updateAgentMailMessage: async (_connection, messageId, action) => {
      calls.push(`${action}:${messageId}`);
      return { message: { messageId, status: action } };
    },
    updateAgentMailAcl: async (_connection, senderUserId, mode) => {
      calls.push(`acl:${senderUserId}:${mode}`);
      return { entry: { userId: senderUserId, mode } };
    },
  },
});

poller.start();
await waitFor(() => manualMessage?.messageId === 'mail-1');
assert.deepEqual(manualContext, {
  serverUrl: 'https://moss.test',
  mailboxKey: 'mailbox:account-1',
  mailConnection: connection,
  sessionId: null,
});
assert.equal(store.get('mailbox:account-1', 'mail-1').state, 'manual');
store.assignSession('mailbox:account-1', 'mail-1', 'session-mail-1');
assert.equal(store.get('mailbox:account-1', 'mail-1').sessionId, 'session-mail-1');
await poller.approve('mail-1', { trustSender: true });
await waitFor(() => store.get('mailbox:account-1', 'mail-1').state === 'completed');
assert.deepEqual(calls.slice(0, 5), [
  'accept:mail-1',
  'acl:alice:auto',
  'heartbeat:mail-1',
  'run:mail-1',
  'complete:mail-1',
]);
store.putLeased('mailbox:account-1', 'desktop-1', 'lease-block', Date.now() + 60_000, {
  ...message,
  messageId: 'mail-block',
});
store.markAccepted('mailbox:account-1', 'mail-block', 'manual');
await poller.block('mail-block');
assert.deepEqual(calls.slice(-2), [
  'acl:alice:blocked',
  'fail:mail-block',
]);
assert.equal(store.get('mailbox:account-1', 'mail-block').state, 'failed');

store.putLeased('mailbox:account-1', 'desktop-1', 'lease-fail', Date.now() + 60_000, {
  ...message,
  messageId: 'mail-fail',
});
store.markAccepted('mailbox:account-1', 'mail-fail', 'manual');
await poller.approve('mail-fail');
await waitFor(() => store.get('mailbox:account-1', 'mail-fail').state === 'failed');
assert.equal(store.get('mailbox:account-1', 'mail-fail').error, 'model api failed');
assert.ok(calls.includes('fail:mail-fail'));
assert.ok(!calls.includes('complete:mail-fail'));

assert.deepEqual(store.getThreadContext('mailbox:account-1', 'thread-1'), {
  summaryText: '',
  updatedAt: 0,
});
store.saveThreadContext('mailbox:account-1', 'thread-1', '线程一结论');
assert.equal(
  store.getThreadContext('mailbox:account-1', 'thread-1').summaryText,
  '线程一结论',
);
assert.equal(store.getThreadContext('mailbox:account-1', 'thread-2').summaryText, '');
assert.equal(store.getThreadContext('mailbox:account-2', 'thread-1').summaryText, '');
assert.equal(store.findMailboxKeyForSession('session-mail-1'), 'mailbox:account-1');
store.putLeased('mailbox:account-2', 'desktop-1', 'lease-account-2', Date.now() + 60_000, message);
assert.equal(store.get('mailbox:account-1', 'mail-1').state, 'completed');
assert.equal(store.get('mailbox:account-2', 'mail-1').state, 'received');
await poller.stop();

store.putLeased('https://moss.test', 'desktop-1', 'lease-2', Date.now() - 1, {
  ...message,
  messageId: 'mail-2',
  deliveryMode: 'auto',
});
store.markAccepted('https://moss.test', 'mail-2', 'auto');
store.markRunning('https://moss.test', 'mail-2');
const recoveredStore = createAgentMailStore(db);
assert.equal(recoveredStore.get('https://moss.test', 'mail-2').state, 'queued');
assert.equal(recoveredStore.nextRunnable('https://moss.test').messageId, 'mail-2');

db.close();

const legacyDb = new DatabaseSync(':memory:');
legacyDb.exec(`
  CREATE TABLE agent_mail_local_queue (
    server_url TEXT NOT NULL,
    message_id TEXT NOT NULL,
    consumer_id TEXT NOT NULL,
    lease_token TEXT NOT NULL,
    lease_until INTEGER NOT NULL,
    message_json TEXT NOT NULL,
    state TEXT NOT NULL,
    error TEXT,
    received_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (server_url, message_id)
  )
`);
createAgentMailStore(legacyDb);
assert.ok(
  legacyDb.prepare(`PRAGMA table_info(agent_mail_local_queue)`).all()
    .some((column) => column.name === 'session_id'),
);
legacyDb.close();
