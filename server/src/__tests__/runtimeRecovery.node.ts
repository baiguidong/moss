import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackendHandle } from '../backendTypes.js'
import { DockerBackend } from '../backends/dockerBackend.js'
import { SessionRepository } from '../model/repositories/session.js'
import { RuntimeService } from '../runtimeService.js'
import { SessionRunnerDaemon } from '../sessionRunnerDaemon.js'
import type { AttemptRecord, RunnerManifest, ServerConfig } from '../types.js'
import { openTestDatabase, testDatabaseConfig } from './databaseTestUtils.js'

async function makeConfig(rootDir: string): Promise<ServerConfig> {
  return {
    host: '127.0.0.1',
    port: 43127,
    authMode: 'local',
    tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin' },
    idleTimeoutMs: 600000,
    maxSessions: 32,
    rootDir,
    database: await testDatabaseConfig(join(rootDir, 'moss-server.db')),
    dataDir: join(rootDir, 'var', 'lib'),
    runDir: join(rootDir, 'var', 'run'),
    logDir: join(rootDir, 'var', 'log'),
    dockerStopTimeoutSec: 10,
    dockerLabels: {},
    startupPolicy: 'reattach-or-resume',
    heartbeatTimeoutMs: 30000,
    reattachProbeTimeoutMs: 100,
    resumeOnMissingRuntime: true,
    logLevel: 'info',
  }
}

async function createRecoveryFixture(root: string, attachPath: string) {
  const config = await makeConfig(root)
  const store = new SessionRepository(
    await openTestDatabase(join(root, 'moss-server.db')),
  )
  const session = await store.createSession({
    sessionId: 'session-recovery',
    transcriptSessionId: 'transcript-recovery',
    transcriptPath: join(root, 'transcript.jsonl'),
    userId: 'user-1',
    orgId: 'org-1',
    role: 'member',
    scopes: ['sessions:attach'],
    cwd: join(root, 'workspace'),
    runtime: {
      backend: 'docker',
      dockerImage: 'moss-runtime:test',
      profileDir: join(root, 'profile'),
      transcriptDir: join(root, 'transcripts'),
      workspaceDir: join(root, 'workspace'),
    },
    status: 'active',
    desiredState: 'active',
  })
  const attempt = await store.createAttempt({
    attemptId: 'attempt-original',
    sessionId: session.sessionId,
    generation: 1,
    resumeTranscriptSessionId: session.transcriptSessionId,
    serverInstanceId: 'server-test',
    containerName: 'container-original',
    attemptDir: join(root, 'attempt-original'),
    manifestPath: join(root, 'attempt-original', 'manifest.json'),
    attachPath,
  })
  await store.setCurrentAttempt(session.sessionId, attempt.attemptId)
  const runtime = new RuntimeService({
    config,
    store,
    serverInstanceId: 'server-test',
  })
  return { runtime, store, attempt }
}

async function testLiveRunnerReattach(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'moss-runtime-reattach-'))
  const attachPath = join(root, 'runner.sock')
  const socketServer = net.createServer(socket => socket.end())
  await new Promise<void>((resolve, reject) => {
    socketServer.once('error', reject)
    socketServer.listen(attachPath, resolve)
  })

  const { runtime, store, attempt } = await createRecoveryFixture(
    root,
    attachPath,
  )
  let recoveryCount = 0
  ;(
    runtime as unknown as {
      spawnAttempt: () => Promise<AttemptRecord>
    }
  ).spawnAttempt = async () => {
    recoveryCount += 1
    throw new Error('healthy attempts must not be rebuilt')
  }

  try {
    const ready = await runtime.ensureSessionReady('session-recovery')
    assert.equal(ready.attempt.attemptId, attempt.attemptId)
    assert.equal(
      (await store.getCurrentAttempt('session-recovery'))?.attemptId,
      attempt.attemptId,
    )
    assert.equal(recoveryCount, 0)
  } finally {
    await new Promise<void>(resolve => socketServer.close(() => resolve()))
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function testMissingRunnerRecovery(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'moss-runtime-recover-'))
  const { runtime, store, attempt } = await createRecoveryFixture(
    root,
    join(root, 'missing-runner.sock'),
  )
  let recoveryCount = 0
  let recoveryOptions: Record<string, unknown> | undefined

  ;(
    runtime as unknown as {
      spawnAttempt: (
        session: { sessionId: string; transcriptSessionId: string },
        options: Record<string, unknown>,
      ) => Promise<AttemptRecord>
    }
  ).spawnAttempt = async (session, options) => {
    recoveryCount += 1
    recoveryOptions = options
    const recovered = await store.createAttempt({
      attemptId: 'attempt-recovered',
      sessionId: session.sessionId,
      generation: 2,
      resumeTranscriptSessionId: session.transcriptSessionId,
      serverInstanceId: 'server-test',
      containerName: 'container-recovered',
      attemptDir: join(root, 'attempt-recovered'),
      manifestPath: join(root, 'attempt-recovered', 'manifest.json'),
      attachPath: join(root, 'recovered-runner.sock'),
    })
    await store.setCurrentAttempt(session.sessionId, recovered.attemptId)
    return recovered
  }

  try {
    const [first, second] = await Promise.all([
      runtime.ensureSessionReady('session-recovery'),
      runtime.ensureSessionReady('session-recovery'),
    ])

    assert.equal(recoveryCount, 1)
    assert.equal(first.attempt.attemptId, 'attempt-recovered')
    assert.equal(second.attempt.attemptId, 'attempt-recovered')
    assert.deepEqual(recoveryOptions, {
      resumeTranscriptSessionId: 'transcript-recovery',
    })
    assert.deepEqual(
      {
        runtimeState: (await store.getAttempt(attempt.attemptId))?.runtimeState,
        stopReason: (await store.getAttempt(attempt.attemptId))?.stopReason,
      },
      { runtimeState: 'lost', stopReason: 'runner_unavailable' },
    )
    assert.deepEqual(
      {
        attemptId: (await store.latestEvent('session-recovery', 'attempt_lost'))
          ?.attemptId,
        payload: (await store.latestEvent('session-recovery', 'attempt_lost'))
          ?.payload,
      },
      {
        attemptId: attempt.attemptId,
        payload: { reason: 'attach_socket_unavailable' },
      },
    )
  } finally {
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
}

async function waitFor(
  predicate: () => boolean,
  message: string,
): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function connectRunner(path: string) {
  const messages: Array<Record<string, unknown>> = []
  let buffer = ''
  const socket = net.createConnection(path)
  socket.setEncoding('utf8')
  socket.on('data', chunk => {
    buffer += String(chunk)
    while (true) {
      const newline = buffer.indexOf('\n')
      if (newline < 0) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim())
        messages.push(JSON.parse(line) as Record<string, unknown>)
    }
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  return { socket, messages }
}

async function testRunnerTurnOwnership(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'moss-runner-turns-'))
  const config = await makeConfig(root)
  config.idleTimeoutMs = 0
  const store = new SessionRepository(
    await openTestDatabase(join(root, 'moss-server.db')),
  )
  const session = await store.createSession({
    sessionId: 'session-runner',
    transcriptSessionId: 'transcript-runner',
    transcriptPath: join(root, 'transcript.jsonl'),
    userId: 'user-1',
    orgId: 'org-1',
    role: 'member',
    scopes: ['sessions:attach'],
    cwd: join(root, 'workspace'),
    runtime: {
      backend: 'docker',
      dockerImage: 'moss-runtime:test',
      profileDir: join(root, 'profile'),
      transcriptDir: join(root, 'transcripts'),
      workspaceDir: join(root, 'workspace'),
      containerName: 'container-runner',
    },
    status: 'active',
    desiredState: 'active',
  })
  const attemptDir = join(root, 'attempt')
  const attachPath = join(root, 'runner.sock')
  const attempt = await store.createAttempt({
    attemptId: 'attempt-runner',
    sessionId: session.sessionId,
    generation: 1,
    resumeTranscriptSessionId: session.transcriptSessionId,
    serverInstanceId: 'server-test',
    containerName: 'container-runner',
    attemptDir,
    manifestPath: join(attemptDir, 'manifest.json'),
    attachPath,
  })
  await store.setCurrentAttempt(session.sessionId, attempt.attemptId)
  await store.close()

  const manifest: RunnerManifest = {
    config,
    session: {
      sessionId: session.sessionId,
      transcriptSessionId: session.transcriptSessionId,
      resumeFromTranscript: false,
      cwd: session.cwd,
      transcriptPath: session.transcriptPath,
      userId: session.userId,
      orgId: session.orgId,
      role: session.role,
      scopes: session.scopes,
      dangerouslySkipPermissions: false,
      runtime: session.runtime,
    },
    attempt: {
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      attemptDir,
      backendManifestPath: join(attemptDir, 'backend.json'),
      attachPath,
      stdoutLogPath: join(attemptDir, 'stdout.log'),
      stderrLogPath: join(attemptDir, 'stderr.log'),
      statusPath: join(attemptDir, 'status.json'),
    },
  }

  const writes: string[] = []
  let interrupts = 0
  const stdoutListeners = new Set<(line: string) => void>()
  const fakeHandle: BackendHandle = {
    workDir: session.cwd,
    runtime: session.runtime,
    writeStdin: data => writes.push(data),
    interrupt: () => {
      interrupts += 1
    },
    onStdoutLine: listener => {
      stdoutListeners.add(listener)
      return () => stdoutListeners.delete(listener)
    },
    onStderrLine: () => () => {},
    onExit: () => () => {},
    destroy: () => {},
  }
  const emitResult = (id: string) => {
    const line = `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'transcript-runner',
      id,
    })}\n`
    for (const listener of stdoutListeners) listener(line)
  }
  const userInput = (id: string) =>
    `${JSON.stringify({
      type: 'user',
      uuid: id,
      message: { role: 'user', content: id },
    })}\n`
  const runnerInput = (id: string) =>
    `${JSON.stringify({
      type: 'stdin',
      data: userInput(id),
    })}\n`
  const hasResult = (messages: Array<Record<string, unknown>>, id: string) =>
    messages.some(message => {
      if (message.type !== 'stdout' || typeof message.line !== 'string')
        return false
      return (JSON.parse(message.line) as { id?: string }).id === id
    })

  const originalSpawn = DockerBackend.prototype.spawn
  DockerBackend.prototype.spawn = async () => fakeHandle
  const daemon = new SessionRunnerDaemon(manifest)
  let first: Awaited<ReturnType<typeof connectRunner>> | undefined
  let second: Awaited<ReturnType<typeof connectRunner>> | undefined
  try {
    await daemon.start()
    first = await connectRunner(attachPath)
    second = await connectRunner(attachPath)

    first.socket.write(runnerInput('turn-1'))
    await waitFor(() => writes.length === 1, 'first turn did not start')
    second.socket.write(runnerInput('turn-2'))
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(writes.length, 1, 'second turn ran concurrently')

    second.socket.write(`${JSON.stringify({ type: 'interrupt' })}\n`)
    await waitFor(
      () =>
        hasResult(second!.messages, 'result-2') === false &&
        second!.messages.some(message => {
          if (message.type !== 'stdout' || typeof message.line !== 'string')
            return false
          const result = JSON.parse(message.line) as {
            type?: string
            errors?: string[]
          }
          return (
            result.type === 'result' &&
            result.errors?.includes(
              'Request interrupted by user before execution.',
            )
          )
        }),
      'queued turn was not canceled',
    )
    assert.equal(interrupts, 0, "one client interrupted another client's turn")

    emitResult('result-1')
    await waitFor(
      () => hasResult(first!.messages, 'result-1'),
      'first client did not receive its result',
    )
    assert.equal(hasResult(second.messages, 'result-1'), false)
    assert.equal(writes.length, 1, 'a canceled queued turn was still executed')

    second.socket.write(runnerInput('turn-2'))
    await waitFor(() => writes.length === 2, 'second turn did not start')
    emitResult('result-2')
    await waitFor(
      () => hasResult(second!.messages, 'result-2'),
      'second client did not receive its result',
    )

    first.socket.write(runnerInput('turn-3'))
    await waitFor(() => writes.length === 3, 'third turn did not start')
    first.socket.destroy()
    await waitFor(() => interrupts === 1, 'orphaned turn was not interrupted')
    emitResult('result-3')
  } finally {
    first?.socket.destroy()
    second?.socket.destroy()
    await daemon.shutdown()
    DockerBackend.prototype.spawn = originalSpawn
    await rm(root, { recursive: true, force: true })
  }
}

await testLiveRunnerReattach()
await testMissingRunnerRecovery()
await testRunnerTurnOwnership()
