import { describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { Duplex } from 'stream'
import type { DatabaseSync } from 'node:sqlite'
import { AdapterProcessManager } from '../adapterProcessManager.js'
import type { RuntimeService } from '../runtimeService.js'
import type { SessionRecord } from '../types.js'

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for condition')
    await Bun.sleep(10)
  }
}

function createDb(): Database {
  return new Database(':memory:')
}

function auth(config: Record<string, unknown>) {
  return {
    orgId: 'org-1',
    userId: 'user-1',
    role: 'user',
    scopes: ['sessions:create', 'sessions:list', 'sessions:attach'],
    config,
  }
}

describe('server Feishu adapter manager', () => {
  test('passes the deployment auto-memory settings into new sessions', async () => {
    const db = createDb()
    let createInput: Record<string, unknown> | undefined
    const session = {
      sessionId: 'feishu-session-1',
      transcriptSessionId: 'feishu-session-1',
      orgId: 'org-1',
      userId: 'user-1',
      role: 'user',
      scopes: ['sessions:create'],
      cwd: '/tmp/workspace',
      runtime: { backend: 'host', profileMode: 'user', profileDir: '', transcriptDir: '', workspaceDir: '' },
      status: 'creating',
      desiredState: 'active',
      currentAttemptId: null,
      transcriptPath: '',
      title: 'Feishu session',
      summary: null,
      assistantName: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      endedAt: null,
      deletedAt: null,
    } satisfies SessionRecord
    const runtime = {
      createSession: async (input: Record<string, unknown>) => {
        createInput = input
        return session
      },
    }
    const manager = new AdapterProcessManager(
      db as unknown as DatabaseSync,
      runtime as unknown as RuntimeService,
    )
    const autoMemory = {
      enabled: true,
      extractionEnabled: true,
      extractionIntervalTurns: 2,
      pastContextSearchEnabled: true,
      dreamEnabled: true,
      dreamMinHours: 12,
      dreamMinSessions: 3,
    }
    const sessionMemory = {
      enabled: true,
      compactEnabled: true,
      minimumMessageTokensToInit: 100,
      minimumTokensBetweenUpdate: 50,
      toolCallsBetweenUpdates: 2,
      compactMinTokens: 1000,
      compactMinTextBlockMessages: 3,
      compactMaxTokens: 4000,
    }

    try {
      await (manager as any).createSession({
        config: {
          appId: 'cli_test',
          appSecret: 'secret',
          autoMemory,
          sessionMemory,
        },
        auth: {
          orgId: 'org-1',
          userId: 'user-1',
          role: 'user',
          scopes: ['sessions:create'],
        },
      })
      expect(createInput?.autoMemory).toEqual(autoMemory)
      expect(createInput?.sessionMemory).toEqual(sessionMemory)
      expect(createInput?.profileMode).toBe('user')
    } finally {
      await manager.dispose()
      db.close()
    }
  })

  test('tracks the Server sessions created by Feishu separately', () => {
    const db = createDb()
    const manager = new AdapterProcessManager(db as unknown as DatabaseSync, {} as RuntimeService)
    db.prepare(`
      INSERT INTO feishu_adapter_sessions (org_id, user_id, session_id, created_at)
      VALUES (?, ?, ?, ?), (?, ?, ?, ?)
    `).run(
      'org-1', 'user-1', 'feishu-session-1', Date.now(),
      'org-1', 'user-2', 'other-user-session', Date.now(),
    )

    expect(manager.listFeishuSessionIds('org-1', 'user-1')).toEqual([
      'feishu-session-1',
    ])
  })

  test('keeps idle-ended Feishu sessions writable for transcript resume', () => {
    const db = createDb()
    const endedSession = {
      sessionId: 'ended-session',
      orgId: 'org-1',
      userId: 'user-1',
      desiredState: 'ended',
      deletedAt: null,
    }
    const runtime = {
      getSession: (sessionId: string) => sessionId === endedSession.sessionId
        ? endedSession
        : { ...endedSession, sessionId, desiredState: 'terminated' },
    }
    const manager = new AdapterProcessManager(
      db as unknown as DatabaseSync,
      runtime as unknown as RuntimeService,
    )
    const hosted = {
      auth: { orgId: 'org-1', userId: 'user-1' },
    }

    expect((manager as any).getWritableSession(hosted, 'ended-session')).toBe(endedSession)
    expect((manager as any).getWritableSession(hosted, 'terminated-session')).toBeNull()
  })

  test('preserves the origin of an existing Server session selected from Feishu', async () => {
    const db = createDb()
    const session = {
      sessionId: 'desktop-session',
      transcriptSessionId: 'desktop-session',
      orgId: 'org-1',
      userId: 'user-1',
      role: 'user',
      scopes: ['sessions:create'],
      cwd: '/tmp/workspace',
      runtime: { backend: 'host', profileMode: 'user', profileDir: '', transcriptDir: '', workspaceDir: '' },
      status: 'ended',
      desiredState: 'ended',
      currentAttemptId: null,
      transcriptPath: '',
      title: 'Desktop session',
      summary: null,
      assistantName: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      endedAt: Date.now(),
      deletedAt: null,
    } satisfies SessionRecord
    const runtime = {
      getSession: (sessionId: string) => sessionId === session.sessionId ? session : null,
    }
    const manager = new AdapterProcessManager(
      db as unknown as DatabaseSync,
      runtime as unknown as RuntimeService,
    )
    const hosted = {
      config: { appId: 'cli_test', allowedUsers: ['ou_user'] },
      auth: { orgId: 'org-1', userId: 'user-1' },
    }
    const now = Date.now()
    db.prepare(`
      INSERT INTO feishu_adapter_conversations (
        org_id, user_id, app_id, chat_id, open_id, active_session_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('org-1', 'user-1', 'cli_test', 'chat-1', 'ou_user', session.sessionId, now, now)

    const current = await (manager as any).handleConversationRequest(hosted, {
      type: 'conversation.current',
      payload: { openId: 'ou_user', chatId: 'chat-1' },
    })
    expect(current.session.id).toBe(session.sessionId)
    expect(current.session.originChannel).toBeUndefined()
  })

  test('starts stopped and rejects incomplete client snapshots', async () => {
    const db = createDb()
    const manager = new AdapterProcessManager(db as unknown as DatabaseSync, {} as RuntimeService)

    expect(manager.getStatus('feishu', 'org-1', 'user-1')).toMatchObject({
      status: 'stopped',
      location: 'server',
      bridgeReady: false,
      transportConnected: false,
      pairedUsers: [],
    })
    await expect(manager.start('feishu', auth({ appId: 'cli_test' }))).rejects.toThrow(
      'App ID and App Secret',
    )

    await manager.dispose()
    db.close()
  })

  test('serializes duplicate starts and removes the deployment on stop', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'moss-feishu-manager-'))
    const entryFile = path.join(root, 'adapter.mjs')
    const startsFile = path.join(root, 'starts.log')
    await writeFile(entryFile, `
      import { appendFileSync } from 'node:fs';
      appendFileSync(${JSON.stringify(startsFile)}, 'start\\n');
      process.on('message', () => {});
      process.send({ version: 1, id: 'hello', type: 'bridge.hello', timestamp: Date.now(), payload: {} });
      setInterval(() => {}, 1000);
    `)
    const db = createDb()
    const manager = new AdapterProcessManager(
      db as unknown as DatabaseSync,
      {} as RuntimeService,
      undefined,
      { entryFile, runtimesDir: path.join(root, 'runtimes') },
    )

    try {
      const snapshot = auth({ appId: 'cli_test', appSecret: ' secret ' })
      await Promise.all([
        manager.start('feishu', snapshot),
        manager.start('feishu', snapshot),
      ])
      await waitFor(() => manager.getStatus('feishu', 'org-1', 'user-1').bridgeReady)
      await manager.start('feishu', auth({
        appId: 'cli_test',
        appSecret: 'secret',
        allowedUsers: ['ou_updated'],
      }))
      expect((await readFile(startsFile, 'utf8')).trim().split('\n')).toHaveLength(1)

      const settingsPath = path.join(root, 'runtimes', 'org-1', 'user-1', 'feishu', 'config', 'settings.json')
      const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
      expect(settings.adapters.feishu.appSecret).toBe('secret')
      expect(settings.adapters.feishu.allowedUsers).toEqual(['ou_updated'])
      expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)

      await manager.stop('feishu', 'org-1', 'user-1')
      expect(manager.getStatus('feishu', 'org-1', 'user-1').status).toBe('stopped')
      const deployments = db.query('SELECT COUNT(*) AS count FROM feishu_adapter_deployments').get() as { count: number }
      expect(deployments.count).toBe(0)
    } finally {
      await manager.dispose()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('restores an enabled deployment after the server manager restarts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'moss-feishu-restore-'))
    const entryFile = path.join(root, 'adapter.mjs')
    const startsFile = path.join(root, 'starts.log')
    await writeFile(entryFile, `
      import { appendFileSync } from 'node:fs';
      appendFileSync(${JSON.stringify(startsFile)}, 'start\\n');
      process.on('message', () => {});
      process.send({ version: 1, id: 'hello', type: 'bridge.hello', timestamp: Date.now(), payload: {} });
      setInterval(() => {}, 1000);
    `)
    const db = createDb()
    const options = { entryFile, runtimesDir: path.join(root, 'runtimes') }
    const first = new AdapterProcessManager(
      db as unknown as DatabaseSync,
      {} as RuntimeService,
      undefined,
      options,
    )
    let second: AdapterProcessManager | null = null

    try {
      await first.start('feishu', auth({ appId: 'cli_restore', appSecret: 'secret' }))
      await waitFor(() => first.getStatus('feishu', 'org-1', 'user-1').bridgeReady)
      await first.dispose()

      second = new AdapterProcessManager(
        db as unknown as DatabaseSync,
        {} as RuntimeService,
        undefined,
        options,
      )
      await second.restoreEnabled()
      await waitFor(() => second?.getStatus('feishu', 'org-1', 'user-1').bridgeReady === true)
      expect((await readFile(startsFile, 'utf8')).trim().split('\n')).toHaveLength(2)
      await second.stop('feishu', 'org-1', 'user-1')
    } finally {
      await first.dispose()
      await second?.dispose()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rate limits failed pairing attempts in the server host', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'moss-feishu-pairing-'))
    const configDir = path.join(root, 'config')
    await mkdir(configDir, { recursive: true })
    const db = createDb()
    const manager = new AdapterProcessManager(db as unknown as DatabaseSync, {} as RuntimeService)
    const hosted = {
      child: { exitCode: null, signalCode: null },
      config: {
        appId: 'cli_test',
        appSecret: 'secret',
        pairedUsers: [],
        pairing: { code: 'ABC234', createdAt: Date.now(), expiresAt: Date.now() + 60_000 },
      },
      auth: { orgId: 'org-1', userId: 'user-1', role: 'user', scopes: ['sessions:create'] },
      configDir,
      handshakeTimer: null,
    }
    const processKey = 'org-1:user-1:feishu'
    ;(manager as any).processes.set(processKey, hosted)
    ;(manager as any).states.set(processKey, {
      status: 'running',
      pid: null,
      error: null,
      startedAt: Date.now(),
      bridgeReady: true,
      transportConnected: true,
      transportUpdatedAt: Date.now(),
    })

    try {
      for (let index = 0; index < 5; index += 1) {
        expect((manager as any).handlePairing(hosted, {
          openId: 'ou_limited', chatId: 'chat-1', code: 'WRONG1',
        }).paired).toBe(false)
      }
      expect((manager as any).handlePairing(hosted, {
        openId: 'ou_limited', chatId: 'chat-1', code: 'ABC234',
      }).paired).toBe(false)
      expect((manager as any).handlePairing(hosted, {
        openId: 'ou_other', chatId: 'chat-2', code: 'ABC234',
      }).paired).toBe(true)
    } finally {
      ;(manager as any).processes.delete(processKey)
      await manager.dispose()
      db.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('queues consecutive messages for the same server session', async () => {
    const db = createDb()
    const prompts: string[] = []
    const session: SessionRecord = {
      sessionId: 'session-1',
      transcriptSessionId: 'session-1',
      orgId: 'org-1',
      userId: 'user-1',
      role: 'user',
      scopes: ['sessions:create'],
      cwd: '/tmp/workspace',
      runtime: { backend: 'host', profileMode: 'user', profileDir: '', transcriptDir: '', workspaceDir: '' },
      status: 'active',
      desiredState: 'active',
      currentAttemptId: 'attempt-1',
      transcriptPath: '',
      title: 'Server session',
      summary: null,
      assistantName: null,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      endedAt: null,
      deletedAt: null,
    }
    const runtime = {
      createSession: async () => session,
      getSession: (sessionId: string) => sessionId === session.sessionId ? session : null,
      acquireSessionTurn: async () => () => {},
      ensureSessionReady: async () => {
        await Bun.sleep(20)
        return { session, attempt: { attemptId: 'attempt-1' } }
      },
      connectToAttempt: async () => new Duplex({
        read() {},
        write(chunk, _encoding, callback) {
          const envelope = JSON.parse(String(chunk).trim())
          if (envelope.type === 'stdin') {
            const message = JSON.parse(String(envelope.data).trim())
            if (message.type === 'user') {
              const prompt = message.message.content
              prompts.push(prompt)
              setTimeout(() => {
                this.push(`${JSON.stringify({
                  type: 'stdout',
                  line: JSON.stringify({ type: 'result', subtype: 'success', result: `reply:${prompt}` }),
                })}\n`)
              }, 20)
            }
          }
          callback()
        },
      }),
    } as unknown as RuntimeService
    const manager = new AdapterProcessManager(db as unknown as DatabaseSync, runtime)
    const hosted = {
      child: { exitCode: null, signalCode: null },
      config: {
        appId: 'cli_test', appSecret: 'secret', allowedUsers: ['ou_user'], pairedUsers: [],
      },
      auth: { orgId: 'org-1', userId: 'user-1', role: 'user', scopes: ['sessions:create'] },
      configDir: '/tmp',
      handshakeTimer: null,
    }
    const processKey = 'org-1:user-1:feishu'
    ;(manager as any).processes.set(processKey, hosted)
    ;(manager as any).states.set(processKey, {
      status: 'running',
      pid: null,
      error: null,
      startedAt: Date.now(),
      bridgeReady: true,
      transportConnected: true,
      transportUpdatedAt: Date.now(),
    })

    try {
      const first = await (manager as any).handleConversationRequest(hosted, {
        version: 1,
        id: 'request-1',
        type: 'chat.message.received',
        timestamp: Date.now(),
        payload: { openId: 'ou_user', chatId: 'chat-1', eventId: 'event-1', text: 'first' },
      })
      const second = await (manager as any).handleConversationRequest(hosted, {
        version: 1,
        id: 'request-2',
        type: 'chat.message.received',
        timestamp: Date.now(),
        payload: { openId: 'ou_user', chatId: 'chat-1', eventId: 'event-2', text: 'second' },
      })
      expect(first.queued).toBe(false)
      expect(second.queued).toBe(true)
      await waitFor(() => prompts.length === 2)
      expect(prompts).toEqual(['first', 'second'])
      await waitFor(() => {
        const row = db.query("SELECT COUNT(*) AS count FROM feishu_adapter_events WHERE status = 'completed'").get() as { count: number }
        return row.count === 2
      })
    } finally {
      ;(manager as any).processes.delete(processKey)
      await manager.dispose()
      db.close()
    }
  })
})
