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
  getConnection: async () => ({ serverUrl: 'https://moss.test', authToken: 'secret' }),
  runMessage: async (received) => {
    calls.push(`run:${received.messageId}`);
  },
  onManualMessage: (received) => { manualMessage = received; },
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
assert.equal(store.get('https://moss.test', 'mail-1').state, 'manual');
await poller.approve('mail-1', { trustSender: true });
await waitFor(() => store.get('https://moss.test', 'mail-1').state === 'completed');
assert.deepEqual(calls.slice(0, 5), [
  'accept:mail-1',
  'acl:alice:auto',
  'heartbeat:mail-1',
  'run:mail-1',
  'complete:mail-1',
]);
store.putLeased('https://moss.test', 'desktop-1', 'lease-block', Date.now() + 60_000, {
  ...message,
  messageId: 'mail-block',
});
store.markAccepted('https://moss.test', 'mail-block', 'manual');
await poller.block('mail-block');
assert.deepEqual(calls.slice(-2), [
  'acl:alice:blocked',
  'fail:mail-block',
]);
assert.equal(store.get('https://moss.test', 'mail-block').state, 'failed');
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
