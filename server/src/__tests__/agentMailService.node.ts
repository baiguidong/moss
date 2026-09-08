import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { AgentMailError, AgentMailService } from '../agentMail/agentMailService.js'
import type { AuthContext } from '../auth/token.js'

function auth(userId: string, orgId = 'org-1'): AuthContext {
  return {
    rawToken: `token-${userId}`,
    userId,
    orgId,
    role: 'user',
    scopes: ['agent-mail:send', 'agent-mail:receive'],
    keyId: `key-${userId}`,
  }
}

const db = new DatabaseSync(':memory:')
db.exec(`
  PRAGMA foreign_keys=ON;
  CREATE TABLE organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE departments (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL);
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id),
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    department_id TEXT,
    role TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  INSERT INTO organizations VALUES ('org-1', 'One'), ('org-2', 'Two');
  INSERT INTO users VALUES
    ('alice', 'org-1', 'alice@example.test', 'Alice', NULL, 'user', 'active', 1),
    ('bob', 'org-1', 'bob@example.test', 'Bob', NULL, 'user', 'active', 2),
    ('disabled', 'org-1', 'disabled@example.test', 'Disabled', NULL, 'user', 'disabled', 3),
    ('mallory', 'org-2', 'mallory@example.test', 'Mallory', NULL, 'user', 'active', 4);
`)
const service = new AgentMailService(db)

const first = service.send(auth('alice'), {
  toUserId: 'bob',
  subject: 'Build',
  content: 'Please inspect build 42.',
  clientMessageId: 'tool-call-1',
})
const duplicate = service.send(auth('alice'), {
  toUserId: 'bob',
  subject: 'Different ignored retry',
  content: 'This retry must not create a second message.',
  clientMessageId: 'tool-call-1',
})
assert.equal(first.duplicate, false)
assert.equal(first.message.fromUserId, 'alice')
assert.equal(first.message.toUserId, 'bob')
assert.equal(first.message.deliveryMode, 'manual')
assert.equal(duplicate.duplicate, true)
assert.equal(duplicate.message.messageId, first.message.messageId)
assert.equal(service.list(auth('alice'), 'outbox').length, 1)

const pulled = await service.pull(auth('bob'), {
  consumerId: 'desktop-b',
  waitMs: 0,
  limit: 10,
})
assert.deepEqual(pulled.messages.map(message => message.messageId), [first.message.messageId])
assert.ok(pulled.leaseToken)
assert.equal(service.accept(auth('bob'), first.message.messageId, 'desktop-b', pulled.leaseToken!).status, 'accepted')
assert.equal(service.heartbeat(auth('bob'), first.message.messageId, 'desktop-b', pulled.leaseToken!).status, 'running')
assert.equal(service.finish(auth('bob'), first.message.messageId, 'desktop-b', pulled.leaseToken!, { status: 'completed' }).status, 'completed')

await assert.rejects(
  service.pull(auth('bob'), { consumerId: 'desktop-b2', waitMs: 0 }),
  (error: unknown) => error instanceof AgentMailError && error.code === 'AGENT_MAIL_CONSUMER_ACTIVE',
)

service.setAcl(auth('bob'), 'alice', 'auto')
const threaded = service.send(auth('alice'), {
  toUserId: 'bob',
  content: 'Question',
  clientMessageId: 'thread-1',
}).message
assert.equal(threaded.deliveryMode, 'auto')
const reply = service.send(auth('bob'), {
  toUserId: 'alice',
  content: 'Answer',
  replyTo: threaded.messageId,
  clientMessageId: 'thread-2',
}).message
assert.equal(reply.threadId, threaded.threadId)
assert.equal(reply.replyTo, threaded.messageId)
assert.equal(reply.hopCount, 1)
assert.throws(() => service.send(auth('bob'), {
  toUserId: 'bob',
  content: 'Wrong recipient',
  replyTo: threaded.messageId,
  clientMessageId: 'thread-3',
}), AgentMailError)

for (let hop = 2; hop <= 8; hop += 1) {
  const next = service.send(auth('bob'), {
    content: `Repeated root reply ${hop}`,
    replyTo: threaded.messageId,
    clientMessageId: `thread-hop-${hop}`,
  }).message
  assert.equal(next.hopCount, hop)
}
assert.throws(() => service.send(auth('bob'), {
  content: 'Must exceed the thread hop limit',
  replyTo: threaded.messageId,
  clientMessageId: 'thread-hop-9',
}), (error: unknown) => error instanceof AgentMailError && error.code === 'AGENT_MAIL_HOP_LIMIT')

for (const toUserId of ['disabled', 'mallory']) {
  assert.throws(() => service.send(auth('alice'), {
    toUserId,
    content: 'No',
    clientMessageId: `invalid-${toUserId}`,
  }), AgentMailError)
}
assert.throws(
  () => service.searchRecipients(auth('disabled'), ''),
  (error: unknown) => error instanceof AgentMailError && error.code === 'AGENT_MAIL_ACCOUNT_DISABLED',
)

const longSubject = 'x'.repeat(198)
const longSubjectMessage = service.send(auth('alice'), {
  toUserId: 'bob',
  subject: longSubject,
  content: 'Subject boundary',
  clientMessageId: 'long-subject-parent',
}).message
assert.throws(() => service.send(auth('bob'), {
  content: 'The derived Re: subject is too long',
  replyTo: longSubjectMessage.messageId,
  clientMessageId: 'long-subject-reply',
}), (error: unknown) => error instanceof AgentMailError && error.code === 'AGENT_MAIL_SUBJECT_TOO_LONG')

const queuedBeforeBlock = service.send(auth('alice'), {
  toUserId: 'bob',
  content: 'Must be cancelled when blocked',
  clientMessageId: 'block-queued',
}).message
service.setAcl(auth('bob'), 'alice', 'blocked')
assert.equal(
  service.list(auth('bob'), 'inbox').find(message => message.messageId === queuedBeforeBlock.messageId)?.status,
  'failed',
)
assert.throws(() => service.send(auth('alice'), {
  toUserId: 'bob',
  content: 'Blocked',
  clientMessageId: 'blocked-new',
}), (error: unknown) => error instanceof AgentMailError && error.code === 'AGENT_MAIL_SENDER_BLOCKED')

service.dispose()
db.close()
