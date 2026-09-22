import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ServerAgentChannelHost } from '../apps/serverAgentChannelHost.js'

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'moss-server-agent-channel-'))
  const db = new DatabaseSync(':memory:')
  const sessions = new Map<string, Record<string, unknown>>()
  const createdInputs: Array<Record<string, unknown>> = []
  let sequence = 0
  const runtime = {
    createSession: async (input: Record<string, unknown>) => {
      createdInputs.push(input)
      const sessionId = `session-${++sequence}`
      const session = {
        sessionId,
        orgId: input.orgId,
        userId: input.userId,
        title: input.title,
        summary: null,
        lastActiveAt: Date.now(),
        desiredState: 'active',
        deletedAt: null,
      }
      sessions.set(sessionId, session)
      return session
    },
    getSession: (sessionId: string) => sessions.get(sessionId) || null,
  }
  const authService = {
    getAccountIdentity: (_orgId: string, userId: string) => ({
      user: { id: userId, status: 'active', role: 'member' },
      scopes: ['sessions:create'],
    }),
  }
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }
  const host = new ServerAgentChannelHost(
    { dataDir: join(root, 'data'), workspace: join(root, 'workspace') } as any,
    db,
    runtime as any,
    authService as any,
    logger,
  )
  return {
    host,
    db,
    createdInputs,
    cleanup: () => {
      host.dispose()
      db.close()
      rmSync(root, { recursive: true, force: true })
    },
  }
}

function userContext(appId: string, instanceId = `${appId}--default`, userId = 'user-1') {
  return {
    appId,
    instanceId,
    principal: {
      scope: 'user',
      key: `user:org-1:${userId}`,
      orgId: 'org-1',
      userId,
    },
  }
}

const fixture = createFixture()
try {
  const alpha = userContext('chat.alpha')
  const created = await fixture.host.handleAgentRequest('session.create', {
    externalConversationId: 'external-1',
    title: 'Alpha conversation',
  }, alpha) as { session: { id: string; originChannel: string } }

  assert.equal(created.session.originChannel, 'app:chat.alpha')
  assert.equal(
    fixture.host.originForSession(created.session.id, 'org-1', 'user-1'),
    'app:chat.alpha',
  )
  assert.deepEqual(
    Object.fromEntries(Object.entries(fixture.createdInputs[0]!).filter(([key]) => [
      'orgId',
      'userId',
      'title',
      'dangerouslySkipPermissions',
    ].includes(key))),
    {
      orgId: 'org-1',
      userId: 'user-1',
      title: 'Alpha conversation',
      dangerouslySkipPermissions: false,
    },
  )

  const sameApp = await fixture.host.handleAgentRequest('session.list', {
    externalConversationId: 'external-1',
  }, alpha) as { sessions: Array<{ id: string }> }
  assert.deepEqual(sameApp.sessions.map(session => session.id), [created.session.id])

  const otherInstance = await fixture.host.handleAgentRequest('session.list', {
    externalConversationId: 'external-1',
  }, userContext('chat.alpha', 'chat.alpha--secondary')) as { sessions: unknown[] }
  const otherApp = await fixture.host.handleAgentRequest('session.list', {
    externalConversationId: 'external-1',
  }, userContext('chat.beta')) as { sessions: unknown[] }
  assert.deepEqual(otherInstance.sessions, [])
  assert.deepEqual(otherApp.sessions, [])
  assert.equal(fixture.host.originForSession(created.session.id, 'org-1', 'user-2'), 'desktop')

  assert.throws(() => fixture.host.handleAgentRequest('session.list', {}, {
    appId: 'chat.alpha',
    instanceId: 'chat.alpha--default',
    principal: { scope: 'org', key: 'org:org-1', orgId: 'org-1' },
  }), /user-scoped/)
} finally {
  fixture.cleanup()
}
