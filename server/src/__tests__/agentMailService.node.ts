import assert from 'node:assert/strict'
import {
  AgentMailError,
  AgentMailService,
} from '../agentMail/agentMailService.js'
import type { AuthContext } from '../auth/token.js'
import { AgentMailRepository } from '../model/repositories/agentMail.js'
import { openTestDatabase } from './databaseTestUtils.js'

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

const db = await openTestDatabase(':memory:')
await db
  .prepare(
    "INSERT INTO organizations (id,name,created_at) VALUES ('org-1','One',1),('org-2','Two',1)",
  )
  .run()
await db
  .prepare(
    `INSERT INTO users (id,org_id,email,name,department_id,role,status,created_at) VALUES
    ('alice', 'org-1', 'alice@example.test', 'Alice', NULL, 'user', 'active', 1),
    ('bob', 'org-1', 'bob@example.test', 'Bob', NULL, 'user', 'active', 2),
    ('disabled', 'org-1', 'disabled@example.test', 'Disabled', NULL, 'user', 'disabled', 3),
    ('mallory', 'org-2', 'mallory@example.test', 'Mallory', NULL, 'user', 'active', 4)`,
  )
  .run()
const service = new AgentMailService(new AgentMailRepository(db))

const first = await service.send(auth('alice'), {
  toUserId: 'bob',
  subject: 'Build',
  content: 'Please inspect build 42.',
  clientMessageId: 'tool-call-1',
})
const duplicate = await service.send(auth('alice'), {
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
assert.equal((await service.list(auth('alice'), 'outbox')).length, 1)

const pulled = await service.pull(auth('bob'), {
  consumerId: 'desktop-b',
  waitMs: 0,
  limit: 10,
})
assert.deepEqual(
  pulled.messages.map(message => message.messageId),
  [first.message.messageId],
)
assert.ok(pulled.leaseToken)
assert.equal(
  (
    await service.accept(
      auth('bob'),
      first.message.messageId,
      'desktop-b',
      pulled.leaseToken!,
    )
  ).status,
  'accepted',
)
assert.equal(
  (
    await service.heartbeat(
      auth('bob'),
      first.message.messageId,
      'desktop-b',
      pulled.leaseToken!,
    )
  ).status,
  'running',
)
assert.equal(
  (
    await service.finish(
      auth('bob'),
      first.message.messageId,
      'desktop-b',
      pulled.leaseToken!,
      { status: 'completed' },
    )
  ).status,
  'completed',
)

await assert.rejects(
  service.pull(auth('bob'), { consumerId: 'desktop-b2', waitMs: 0 }),
  (error: unknown) =>
    error instanceof AgentMailError &&
    error.code === 'AGENT_MAIL_CONSUMER_ACTIVE',
)

await service.setAcl(auth('bob'), 'alice', 'auto')
const threaded = (
  await service.send(auth('alice'), {
    toUserId: 'bob',
    content: 'Question',
    clientMessageId: 'thread-1',
  })
).message
assert.equal(threaded.deliveryMode, 'auto')
const reply = (
  await service.send(auth('bob'), {
    toUserId: 'alice',
    content: 'Answer',
    replyTo: threaded.messageId,
    clientMessageId: 'thread-2',
  })
).message
assert.equal(reply.threadId, threaded.threadId)
assert.equal(reply.replyTo, threaded.messageId)
assert.equal(reply.hopCount, 1)
await assert.rejects(
  async () =>
    await service.send(auth('bob'), {
      toUserId: 'bob',
      content: 'Wrong recipient',
      replyTo: threaded.messageId,
      clientMessageId: 'thread-3',
    }),
  AgentMailError,
)

for (let hop = 2; hop <= 8; hop += 1) {
  const next = (
    await service.send(auth('bob'), {
      content: `Repeated root reply ${hop}`,
      replyTo: threaded.messageId,
      clientMessageId: `thread-hop-${hop}`,
    })
  ).message
  assert.equal(next.hopCount, hop)
}
await assert.rejects(
  async () =>
    await service.send(auth('bob'), {
      content: 'Must exceed the thread hop limit',
      replyTo: threaded.messageId,
      clientMessageId: 'thread-hop-9',
    }),
  (error: unknown) =>
    error instanceof AgentMailError && error.code === 'AGENT_MAIL_HOP_LIMIT',
)

for (const toUserId of ['disabled', 'mallory']) {
  await assert.rejects(
    async () =>
      await service.send(auth('alice'), {
        toUserId,
        content: 'No',
        clientMessageId: `invalid-${toUserId}`,
      }),
    AgentMailError,
  )
}
await assert.rejects(
  async () => await service.searchRecipients(auth('disabled'), ''),
  (error: unknown) =>
    error instanceof AgentMailError &&
    error.code === 'AGENT_MAIL_ACCOUNT_DISABLED',
)

const longSubject = 'x'.repeat(198)
const longSubjectMessage = (
  await service.send(auth('alice'), {
    toUserId: 'bob',
    subject: longSubject,
    content: 'Subject boundary',
    clientMessageId: 'long-subject-parent',
  })
).message
await assert.rejects(
  async () =>
    await service.send(auth('bob'), {
      content: 'The derived Re: subject is too long',
      replyTo: longSubjectMessage.messageId,
      clientMessageId: 'long-subject-reply',
    }),
  (error: unknown) =>
    error instanceof AgentMailError &&
    error.code === 'AGENT_MAIL_SUBJECT_TOO_LONG',
)

const deleteTarget = (
  await service.send(auth('alice'), {
    toUserId: 'bob',
    subject: 'Delete independently',
    content: 'Each mailbox owner controls only their own view.',
    clientMessageId: 'delete-target',
  })
).message
assert.deepEqual(
  await service.deleteForUser(auth('alice'), deleteTarget.messageId),
  {
    messageId: deleteTarget.messageId,
    deleted: true,
  },
)
assert.deepEqual(
  await service.deleteForUser(auth('alice'), deleteTarget.messageId),
  {
    messageId: deleteTarget.messageId,
    deleted: false,
  },
)
assert.equal(
  (await service.list(auth('alice'), 'outbox')).some(
    message => message.messageId === deleteTarget.messageId,
  ),
  false,
)
assert.equal(
  (await service.list(auth('bob'), 'inbox')).some(
    message => message.messageId === deleteTarget.messageId,
  ),
  true,
)
await service.deleteForUser(auth('bob'), deleteTarget.messageId)
assert.equal(
  (await service.list(auth('bob'), 'inbox')).some(
    message => message.messageId === deleteTarget.messageId,
  ),
  false,
)
await assert.rejects(
  async () =>
    await service.deleteForUser(
      auth('mallory', 'org-2'),
      deleteTarget.messageId,
    ),
  (error: unknown) =>
    error instanceof AgentMailError && error.code === 'AGENT_MAIL_NOT_FOUND',
)

const queuedBeforeBlock = (
  await service.send(auth('alice'), {
    toUserId: 'bob',
    content: 'Must be cancelled when blocked',
    clientMessageId: 'block-queued',
  })
).message
await service.setAcl(auth('bob'), 'alice', 'blocked')
assert.equal(
  (await service.list(auth('bob'), 'inbox')).find(
    message => message.messageId === queuedBeforeBlock.messageId,
  )?.status,
  'failed',
)
await assert.rejects(
  async () =>
    await service.send(auth('alice'), {
      toUserId: 'bob',
      content: 'Blocked',
      clientMessageId: 'blocked-new',
    }),
  (error: unknown) =>
    error instanceof AgentMailError &&
    error.code === 'AGENT_MAIL_SENDER_BLOCKED',
)

service.dispose()
await db.close()
