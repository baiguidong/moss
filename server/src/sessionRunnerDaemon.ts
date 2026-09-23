import { randomUUID } from 'crypto'
import { appendFile, mkdir, unlink, writeFile } from 'fs/promises'
import net from 'net'
import { dirname } from 'path'
import type { BackendHandle } from './backendTypes.js'
import { DockerBackend } from './backends/dockerBackend.js'
import { jsonParse, jsonStringify } from './lib/json.js'
import { openDatabase, requireSchema } from './model/index.js'
import { SessionRepository } from './model/repositories/session.js'
import type {
  RunnerClientMessage,
  RunnerServerMessage,
} from './runnerProtocol.js'
import { getTranscriptPath } from './runtimePaths.js'
import type { RunnerManifest } from './types.js'

type SocketWithBuffer = net.Socket & {
  __buffer?: string
}

type QueuedTurn = {
  socket: SocketWithBuffer
  data: string
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {}
}

async function writeStatus(
  path: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isUserInput(data: string): boolean {
  for (const line of data.split('\n')) {
    if (!line.trim()) continue
    try {
      const message = jsonParse(line) as { type?: unknown }
      if (message.type === 'user') return true
    } catch {}
  }
  return false
}

function getBackendMessageType(line: string): string | null {
  try {
    const message = jsonParse(line) as { type?: unknown }
    return typeof message.type === 'string' ? message.type : null
  } catch {
    return null
  }
}

function extractTranscriptSessionCandidate(value: unknown): {
  sessionId: string
  sourceType: string
  sourceSubtype: string | null
} | null {
  if (!isJsonObject(value)) {
    return null
  }
  const sessionId =
    typeof value.session_id === 'string' ? value.session_id.trim() : ''
  if (!sessionId) {
    return null
  }
  if (value.type === 'result') {
    return {
      sessionId,
      sourceType: 'result',
      sourceSubtype: null,
    }
  }
  if (value.type === 'system' && value.subtype === 'init') {
    return {
      sessionId,
      sourceType: 'system',
      sourceSubtype: 'init',
    }
  }
  return null
}

export class SessionRunnerDaemon {
  #store!: SessionRepository
  readonly #backend: DockerBackend
  readonly #clients = new Set<SocketWithBuffer>()
  #heartbeatTimer: NodeJS.Timeout | undefined
  #heartbeat: Promise<void> | undefined
  #outputQueue: Promise<void> = Promise.resolve()
  #server: net.Server | null = null
  #handle: BackendHandle | null = null
  #state: 'starting' | 'ready' | 'running' | 'stopped' | 'failed' = 'starting'
  #stopping = false
  #stopReason: 'terminated' | 'idle_timeout' | 'runtime_exit' = 'runtime_exit'
  #idleTimer: NodeJS.Timeout | null = null
  #idleTimerGeneration = 0
  #shutdownPromise: Promise<void> | undefined
  #finalized = false
  #recentStderr: string[] = []
  #backendStartPromise: Promise<void> | null = null
  #activeTurn: { socket: SocketWithBuffer; interrupted: boolean } | null = null
  #queuedTurns: QueuedTurn[] = []

  constructor(private readonly manifest: RunnerManifest) {
    this.#backend = new DockerBackend({
      network: manifest.config.dockerNetwork,
      labels: manifest.config.dockerLabels,
    })
  }

  async start(): Promise<void> {
    try {
      const database = this.manifest.config.database
      const db = await openDatabase(
        database.driver === 'mysql'
          ? { ...database, connectionLimit: 1 }
          : database,
      )
      try {
        await requireSchema(db)
      } catch (error) {
        await db.close()
        throw error
      }
      this.#store = new SessionRepository(db)
      this.#heartbeatTimer = setInterval(
        () => {
          if (this.#heartbeat || this.#finalized) return
          this.#heartbeat = this.#store
            .touchAttemptHeartbeat(this.manifest.attempt.attemptId)
            .catch(error => this.#reportBackgroundError(error))
            .finally(() => {
              this.#heartbeat = undefined
            })
        },
        Math.max(
          5_000,
          Math.floor(this.manifest.config.heartbeatTimeoutMs / 3),
        ),
      )
      this.#heartbeatTimer.unref?.()

      await mkdir(this.manifest.attempt.attemptDir, { recursive: true })
      await mkdir(dirname(this.manifest.attempt.attachPath), {
        recursive: true,
      })
      await safeUnlink(this.manifest.attempt.attachPath)
      await writeStatus(this.manifest.attempt.statusPath, {
        state: 'starting',
        pid: process.pid,
        attemptId: this.manifest.attempt.attemptId,
      })
      this.#server = net.createServer(socket => {
        socket.pause()
        void this.#onClient(socket as SocketWithBuffer).catch(error => {
          this.#reportBackgroundError(error)
          socket.destroy()
        })
      })
      await new Promise<void>((resolve, reject) => {
        this.#server!.once('error', reject)
        this.#server!.listen(this.manifest.attempt.attachPath, () => {
          this.#server!.off('error', reject)
          resolve()
        })
      })
      await this.#store.updateAttemptRunner(
        this.manifest.attempt.attemptId,
        process.pid,
      )
      this.#state = 'ready'
      await this.#store.setSessionLifecycle(
        this.manifest.session.sessionId,
        'active',
        'active',
      )
      await this.#store.addEvent(
        this.manifest.session.sessionId,
        this.manifest.attempt.attemptId,
        'runner_ready',
        {
          pid: process.pid,
          attachPath: this.manifest.attempt.attachPath,
        },
      )
      await writeStatus(this.manifest.attempt.statusPath, {
        state: 'ready',
        pid: process.pid,
        attemptId: this.manifest.attempt.attemptId,
      })
      await this.#armIdleTimer()

      process.once('SIGTERM', () => {
        this.#stopping = true
        this.#stopReason = 'terminated'
        if (this.#handle) {
          this.#handle.destroy(true)
        } else {
          void this.#finalizeWithoutBackend('terminated').catch(error =>
            this.#reportBackgroundError(error),
          )
        }
      })
      process.once('SIGINT', () => {
        this.#stopping = true
        this.#stopReason = 'terminated'
        if (this.#handle) {
          this.#handle.destroy(true)
        } else {
          void this.#finalizeWithoutBackend('terminated').catch(error =>
            this.#reportBackgroundError(error),
          )
        }
      })
    } catch (error) {
      await this.#fail(error, 'startup_failed').catch(() => {})
      throw error
    }
  }

  shutdown(): Promise<void> {
    return (this.#shutdownPromise ??= this.#shutdown())
  }

  async #shutdown(): Promise<void> {
    clearInterval(this.#heartbeatTimer)
    await this.#heartbeat
    this.#clearIdleTimer()
    for (const client of this.#clients) {
      try {
        client.destroy()
      } catch {}
    }
    this.#clients.clear()
    if (this.#server) {
      await new Promise<void>(resolve => this.#server!.close(() => resolve()))
      this.#server = null
    }
    await safeUnlink(this.manifest.attempt.attachPath)
    await this.#store?.close()
  }

  async #onClient(socket: SocketWithBuffer): Promise<void> {
    if (this.#finalized || this.#shutdownPromise) {
      socket.destroy()
      return
    }
    let messageQueue: Promise<void> = Promise.resolve()
    this.#clients.add(socket)
    this.#clearIdleTimer()
    const detach = () => {
      void this.#detachClient(socket).catch(error =>
        this.#reportBackgroundError(error),
      )
    }
    socket.on('close', detach)
    socket.on('error', detach)
    await this.#store.setSessionLifecycle(
      this.manifest.session.sessionId,
      'active',
      'active',
    )
    this.#send(socket, {
      type: 'hello',
      attemptId: this.manifest.attempt.attemptId,
      sessionId: this.manifest.session.sessionId,
      runtimeType: this.manifest.session.runtime.backend,
      state: this.#state,
    })
    socket.on('data', chunk => {
      const text = Buffer.from(chunk).toString('utf8')
      socket.__buffer = (socket.__buffer ?? '') + text
      while (true) {
        const idx = socket.__buffer.indexOf('\n')
        if (idx < 0) break
        const line = socket.__buffer.slice(0, idx)
        socket.__buffer = socket.__buffer.slice(idx + 1)
        messageQueue = messageQueue
          .then(async () => await this.#handleClientLine(socket, line))
          .catch(error => {
            this.#send(socket, {
              type: 'error',
              message: error instanceof Error ? error.message : String(error),
            })
          })
      }
    })
    if (socket.destroyed) detach()
    else socket.resume()
  }

  async #handleClientLine(
    socket: SocketWithBuffer,
    line: string,
  ): Promise<void> {
    if (!line.trim()) return
    let parsed: RunnerClientMessage
    try {
      parsed = jsonParse(line) as RunnerClientMessage
    } catch {
      this.#send(socket, { type: 'error', message: 'invalid_json' })
      return
    }
    if (parsed.type === 'ping') {
      this.#send(socket, { type: 'pong', ts: Date.now() })
      return
    }
    if (parsed.type === 'shutdown') {
      this.#stopping = true
      this.#stopReason = 'terminated'
      await this.#store.addEvent(
        this.manifest.session.sessionId,
        this.manifest.attempt.attemptId,
        'attempt_shutdown_requested',
        { force: parsed.force === true },
      )
      process.kill(process.pid, 'SIGTERM')
      return
    }
    if (parsed.type === 'stdin') {
      await this.#ensureBackendStarted()
      if (isUserInput(parsed.data)) {
        this.#queuedTurns.push({ socket, data: parsed.data })
        this.#startNextTurn()
      } else {
        this.#handle?.writeStdin(parsed.data)
      }
      return
    }
    if (parsed.type === 'interrupt') {
      const queuedForClient = this.#queuedTurns.filter(
        turn => turn.socket === socket,
      )
      if (queuedForClient.length > 0) {
        this.#queuedTurns = this.#queuedTurns.filter(
          turn => turn.socket !== socket,
        )
        for (const _turn of queuedForClient) {
          this.#sendInterruptedResult(socket)
        }
      }
      if (
        this.#activeTurn?.socket === socket &&
        !this.#activeTurn.interrupted &&
        this.#handle
      ) {
        this.#activeTurn.interrupted = true
        this.#handle.interrupt()
      }
      return
    }
  }

  async #detachClient(socket: SocketWithBuffer): Promise<void> {
    if (!this.#clients.delete(socket)) return
    this.#queuedTurns = this.#queuedTurns.filter(turn => turn.socket !== socket)
    if (this.#activeTurn?.socket === socket && !this.#activeTurn.interrupted) {
      this.#activeTurn.interrupted = true
      this.#handle?.interrupt()
    }
    await this.#armIdleTimer()
  }

  #startNextTurn(): void {
    if (this.#activeTurn || !this.#handle) return
    while (this.#queuedTurns.length > 0) {
      const next = this.#queuedTurns.shift()!
      if (next.socket.destroyed) continue
      this.#activeTurn = { socket: next.socket, interrupted: false }
      this.#handle.writeStdin(next.data)
      return
    }
  }

  #sendInterruptedResult(socket: SocketWithBuffer): void {
    this.#send(socket, {
      type: 'stdout',
      line: `${jsonStringify({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 0,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        modelUsage: {},
        permission_denials: [],
        errors: ['Request interrupted by user before execution.'],
        uuid: randomUUID(),
        session_id: this.manifest.session.transcriptSessionId,
      })}\n`,
    })
  }

  async #ensureBackendStarted(): Promise<void> {
    if (this.#handle) {
      return
    }
    if (this.#backendStartPromise) {
      return this.#backendStartPromise
    }

    this.#backendStartPromise = (async () => {
      const handle = await this.#backend.spawn({
        sessionId: this.manifest.session.sessionId,
        resumeSessionId: this.manifest.session.resumeFromTranscript
          ? this.manifest.session.transcriptSessionId
          : undefined,
        transcriptPath: this.manifest.session.transcriptPath,
        backendManifestPath: this.manifest.attempt.backendManifestPath,
        cwd: this.manifest.session.cwd,
        dangerouslySkipPermissions:
          this.manifest.session.dangerouslySkipPermissions,
        userId: this.manifest.session.userId,
        orgId: this.manifest.session.orgId,
        role: this.manifest.session.role,
        scopes: this.manifest.session.scopes,
        mountDirs: this.manifest.session.mountDirs,
        runtime: this.manifest.session.runtime,
        assistantName: this.manifest.session.assistantName,
        advancedSettings: this.manifest.session.advancedSettings,
        autoMemory: this.manifest.session.autoMemory,
        sessionMemory: this.manifest.session.sessionMemory,
        runtimeOptions: this.manifest.session.runtimeOptions,
      })

      this.#handle = handle
      this.manifest.session.runtime.containerName = handle.runtime.containerName
      this.#state = 'running'
      // Attach listeners synchronously; DB writes may yield while the runtime exits.
      const started = this.#outputQueue.then(async () => {
        await this.#store.db.transaction(async () => {
          await this.#store.touchAttemptHeartbeat(
            this.manifest.attempt.attemptId,
            'running',
          )
          await this.#store.setSessionLifecycle(
            this.manifest.session.sessionId,
            'active',
            'active',
          )
          await this.#store.addEvent(
            this.manifest.session.sessionId,
            this.manifest.attempt.attemptId,
            'attempt_started',
            {
              pid: process.pid,
              runtime: handle.runtime,
            },
          )
        })
        await writeStatus(this.manifest.attempt.statusPath, {
          state: 'running',
          pid: process.pid,
          attemptId: this.manifest.attempt.attemptId,
          runtime: handle.runtime,
        })
      })
      this.#outputQueue = started.catch(error =>
        this.#reportBackgroundError(error),
      )

      handle.onStdoutLine(line =>
        this.#enqueueOutput(async () => {
          await this.#maybeUpdateTranscriptSession(line)
          await this.#store.touchAttemptHeartbeat(
            this.manifest.attempt.attemptId,
          )
          await this.#store.touchSessionActivity(
            this.manifest.session.sessionId,
          )
          void appendFile(
            this.manifest.attempt.stdoutLogPath,
            line,
            'utf8',
          ).catch(() => {})
          const messageType = getBackendMessageType(line)
          const activeTurn = this.#activeTurn
          if (activeTurn && messageType !== 'control_response') {
            this.#send(activeTurn.socket, { type: 'stdout', line })
          } else {
            this.#broadcast({ type: 'stdout', line })
          }
          if (activeTurn && messageType === 'result') {
            this.#activeTurn = null
            this.#startNextTurn()
          }
        }),
      )

      handle.onStderrLine(line => {
        this.#rememberStderr(line)
        void appendFile(
          this.manifest.attempt.stderrLogPath,
          line,
          'utf8',
        ).catch(() => {})
        this.#broadcast({ type: 'stderr', line })
      })

      handle.onExit((code, signal) => {
        this.#enqueueOutput(() => this.#finalizeBackendExit(code, signal))
      })
      await started
    })().catch(async error => {
      this.#backendStartPromise = null
      await this.#fail(error, 'startup_failed')
      throw error
    })

    return this.#backendStartPromise
  }

  async #finalizeBackendExit(
    code: number | null,
    signal: NodeJS.Signals | null,
  ): Promise<void> {
    if (this.#finalized) {
      return
    }
    this.#finalized = true
    const runtimeState = code === 0 ? 'stopped' : 'failed'
    const errorText =
      code === 0
        ? null
        : this.#recentStderrText() ||
          `Runtime exited before attach became stable (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
    this.#state = code === 0 ? 'stopped' : 'failed'
    try {
      await this.#store.db.transaction(async () => {
        await this.#store.markAttemptStopped(this.manifest.attempt.attemptId, {
          runtimeState,
          exitCode: code,
          exitSignal: signal,
          stopReason: this.#stopping ? this.#stopReason : 'runtime_exit',
          errorText,
        })
        await this.#store.markSessionEnded(
          this.manifest.session.sessionId,
          this.#stopping
            ? this.#stopReason === 'idle_timeout'
              ? 'ended'
              : 'terminated'
            : code === 0
              ? 'ended'
              : 'failed',
          this.#stopping
            ? this.#stopReason === 'idle_timeout'
              ? 'ended'
              : 'terminated'
            : code === 0
              ? 'ended'
              : 'active',
        )
        await this.#store.addEvent(
          this.manifest.session.sessionId,
          this.manifest.attempt.attemptId,
          'attempt_exited',
          { code, signal, stopping: this.#stopping, errorText },
        )
      })
      this.#broadcast({ type: 'exit', code, signal: signal ?? null })
      await writeStatus(this.manifest.attempt.statusPath, {
        state: this.#state,
        code,
        signal,
        error: errorText,
      }).catch(() => {})
    } finally {
      await this.shutdown()
    }
  }

  async #finalizeWithoutBackend(
    reason: 'terminated' | 'idle_timeout',
  ): Promise<void> {
    if (this.#finalized) {
      return
    }
    this.#finalized = true
    this.#state = 'stopped'
    const sessionState = reason === 'idle_timeout' ? 'ended' : 'terminated'
    try {
      await this.#store.db.transaction(async () => {
        await this.#store.markAttemptStopped(this.manifest.attempt.attemptId, {
          runtimeState: 'stopped',
          exitCode: 0,
          exitSignal: null,
          stopReason: reason,
          errorText: null,
        })
        await this.#store.markSessionEnded(
          this.manifest.session.sessionId,
          sessionState,
          sessionState,
        )
        await this.#store.addEvent(
          this.manifest.session.sessionId,
          this.manifest.attempt.attemptId,
          reason === 'idle_timeout'
            ? 'attempt_idle_timeout'
            : 'attempt_terminated',
          {},
        )
      })
      this.#broadcast({ type: 'exit', code: 0, signal: null })
      await writeStatus(this.manifest.attempt.statusPath, {
        state: 'stopped',
        code: 0,
        signal: null,
        error: null,
      }).catch(() => {})
    } finally {
      await this.shutdown()
    }
  }

  #broadcast(message: RunnerServerMessage): void {
    const line = `${jsonStringify(message)}\n`
    for (const client of this.#clients) {
      if (!client.destroyed) {
        client.write(line)
      }
    }
  }

  #send(socket: SocketWithBuffer, message: RunnerServerMessage): void {
    if (!socket.destroyed) {
      socket.write(`${jsonStringify(message)}\n`)
    }
  }

  #clearIdleTimer(): void {
    this.#idleTimerGeneration += 1
    if (this.#idleTimer) {
      clearTimeout(this.#idleTimer)
      this.#idleTimer = null
    }
  }

  async #armIdleTimer(): Promise<void> {
    this.#clearIdleTimer()
    const generation = this.#idleTimerGeneration
    if (
      this.#finalized ||
      this.#shutdownPromise ||
      this.#clients.size > 0 ||
      this.manifest.config.idleTimeoutMs <= 0
    ) {
      return
    }
    await this.#store.setSessionLifecycle(
      this.manifest.session.sessionId,
      'detached',
      'active',
    )
    if (
      generation !== this.#idleTimerGeneration ||
      this.#finalized ||
      this.#shutdownPromise ||
      this.#clients.size > 0
    )
      return
    this.#idleTimer = setTimeout(() => {
      void (async () => {
        this.#stopping = true
        this.#stopReason = 'idle_timeout'
        if (this.#handle) {
          await this.#store.addEvent(
            this.manifest.session.sessionId,
            this.manifest.attempt.attemptId,
            'attempt_idle_timeout',
            { idleTimeoutMs: this.manifest.config.idleTimeoutMs },
          )
          this.#handle.destroy(true)
        } else {
          await this.#finalizeWithoutBackend('idle_timeout')
        }
      })().catch(error => this.#reportBackgroundError(error))
    }, this.manifest.config.idleTimeoutMs)
    this.#idleTimer.unref?.()
  }

  #reportBackgroundError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.#rememberStderr(message)
    this.#broadcast({ type: 'error', message })
    void appendFile(
      this.manifest.attempt.stderrLogPath,
      `${message}\n`,
      'utf8',
    ).catch(() => {})
  }

  #enqueueOutput(operation: () => Promise<void>): void {
    this.#outputQueue = this.#outputQueue
      .then(() => {
        if (!this.#finalized && !this.#shutdownPromise) return operation()
      })
      .catch(error => this.#reportBackgroundError(error))
  }

  #rememberStderr(line: string): void {
    this.#recentStderr.push(line.trimEnd())
    if (this.#recentStderr.length > 50) {
      this.#recentStderr.splice(0, this.#recentStderr.length - 50)
    }
  }

  #recentStderrText(): string | null {
    const text = this.#recentStderr
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    return text || null
  }

  async #maybeUpdateTranscriptSession(line: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = jsonParse(line)
    } catch {
      return
    }
    const candidate = extractTranscriptSessionCandidate(parsed)
    if (!candidate) {
      return
    }
    const nextTranscriptSessionId = candidate.sessionId
    const currentTranscriptSessionId = this.manifest.session.transcriptSessionId
    if (nextTranscriptSessionId === currentTranscriptSessionId) {
      return
    }
    const currentTranscriptPath = this.manifest.session.transcriptPath
    const nextTranscriptPath = getTranscriptPath(
      this.manifest.config,
      this.manifest.session.sessionId,
      nextTranscriptSessionId,
    )
    await this.#store.updateSessionTranscript(this.manifest.session.sessionId, {
      transcriptSessionId: nextTranscriptSessionId,
      transcriptPath: nextTranscriptPath,
    })
    this.manifest.session.transcriptSessionId = nextTranscriptSessionId
    this.manifest.session.transcriptPath = nextTranscriptPath
    await this.#store.addEvent(
      this.manifest.session.sessionId,
      this.manifest.attempt.attemptId,
      'transcript_session_updated',
      {
        previousTranscriptSessionId: currentTranscriptSessionId,
        transcriptSessionId: nextTranscriptSessionId,
        previousTranscriptPath: currentTranscriptPath,
        transcriptPath: nextTranscriptPath,
        sourceType: candidate.sourceType,
        sourceSubtype: candidate.sourceSubtype,
      },
    )
  }

  async #fail(error: unknown, stopReason: string): Promise<void> {
    if (this.#finalized) {
      return
    }
    this.#finalized = true
    this.#state = 'failed'
    this.#handle?.destroy(true)
    const message =
      error instanceof Error ? error.stack || error.message : String(error)
    this.#rememberStderr(message)
    await appendFile(
      this.manifest.attempt.stderrLogPath,
      `${message}\n`,
      'utf8',
    ).catch(() => {})
    if (this.#store) {
      await this.#store.db
        .transaction(async () => {
          await this.#store.markAttemptStopped(
            this.manifest.attempt.attemptId,
            {
              runtimeState: 'failed',
              stopReason,
              errorText: message,
            },
          )
          await this.#store.markSessionEnded(
            this.manifest.session.sessionId,
            'failed',
            'active',
          )
          await this.#store.addEvent(
            this.manifest.session.sessionId,
            this.manifest.attempt.attemptId,
            'attempt_failed',
            { stopReason, error: message },
          )
        })
        .catch(() => {})
    }
    await writeStatus(this.manifest.attempt.statusPath, {
      state: 'failed',
      pid: process.pid,
      attemptId: this.manifest.attempt.attemptId,
      error: message,
    }).catch(() => {})
    await this.shutdown().catch(() => {})
  }
}
