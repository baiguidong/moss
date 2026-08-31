import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  APP_ERROR_CODES,
  AppServiceError,
  BACKEND_MESSAGE_TYPES,
  createEnvelope,
  validateEnvelope,
} from '../../../app-sdk/src/index.mjs'
import { redactAppValue } from '../logging/index.mjs'

const ALLOWED_ENV = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function isChildRunning(child) {
  return Boolean(child && child.exitCode === null && child.signalCode === null)
}

function minimalEnvironment(extra = {}) {
  const env = {}
  for (const key of ALLOWED_ENV) if (process.env[key] !== undefined) env[key] = process.env[key]
  return { ...env, NODE_ENV: 'production', ...extra }
}

function errorFromPayload(payload, secretValues) {
  const error = redactAppValue(payload?.error || {}, secretValues)
  return new AppServiceError(
    error.code || APP_ERROR_CODES.backendUnavailable,
    error.message || 'App Backend action failed',
    error.details,
  )
}

export class AppProcessSupervisor {
  constructor(options = {}) {
    this.nodeExecutable = options.nodeExecutable || process.env.MOSS_NODE_PATH || process.execPath
    this.handshakeTimeoutMs = options.handshakeTimeoutMs || 15_000
    this.shutdownTimeoutMs = options.shutdownTimeoutMs || 5_000
    this.killTimeoutMs = options.killTimeoutMs || 2_000
    this.actionTimeoutMs = options.actionTimeoutMs || 30_000
    this.maxActionTimeoutMs = options.maxActionTimeoutMs || 300_000
    this.idleTimeoutMs = options.idleTimeoutMs || 60_000
    this.healthCheckIntervalMs = options.healthCheckIntervalMs || 30_000
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs || 65_000
    this.maxProcesses = options.maxProcesses || 64
    this.maxProcessesPerApp = options.maxProcessesPerApp || 16
    this.restartBaseDelayMs = options.restartBaseDelayMs || 1_000
    this.maxRestartDelayMs = options.maxRestartDelayMs || 30_000
    this.crashLoopThreshold = options.crashLoopThreshold || 5
    this.crashLoopWindowMs = options.crashLoopWindowMs || 5 * 60_000
    this.onStatus = options.onStatus || (() => {})
    this.onEvent = options.onEvent || (() => {})
    this.onLog = options.onLog || (() => {})
    this.processes = new Map()
    this.definitions = new Map()
    this.transitions = new Map()
    this.failureHistory = new Map()
    this.shuttingDown = false
  }

  register(definition) {
    this.definitions.set(definition.key, structuredClone(definition))
    return this.status(definition.key)
  }

  unregister(key) {
    this.definitions.delete(key)
    this.failureHistory.delete(key)
  }

  status(key) {
    const hosted = this.processes.get(key)
    const definition = this.definitions.get(key)
    return {
      key,
      appId: definition?.appId,
      instanceId: definition?.instanceId,
      state: hosted?.state || 'stopped',
      pid: hosted?.child?.pid || null,
      generation: definition?.generation || null,
      startedAt: hosted?.startedAt || null,
      lastError: hosted?.lastError || null,
      pendingActions: hosted?.pending?.size || 0,
    }
  }

  listStatuses() {
    return [...this.definitions.keys()].map((key) => this.status(key))
  }

  transition(key, operation) {
    const run = (this.transitions.get(key) || Promise.resolve()).then(operation, operation)
    this.transitions.set(key, run.catch(() => {}))
    return run
  }

  async start(key, options = {}) {
    return this.transition(key, () => this.startNow(key, options))
  }

  async startNow(key, options = {}) {
    if (this.shuttingDown) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend supervisor is shutting down')
    }
    const definition = this.definitions.get(key)
    if (!definition) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, `Unknown App deployment: ${key}`)
    const current = this.processes.get(key)
    if (current?.state === 'running') return this.status(key)
    if (current?.state === 'crash-loop' && !options.clearCrashLoop) {
      throw new AppServiceError(APP_ERROR_CODES.crashLoop, `App deployment is in crash-loop: ${key}`)
    }
    const running = [...this.processes.values()].filter((item) => ['starting', 'running'].includes(item.state))
    if (running.length >= this.maxProcesses) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'Host App process limit reached')
    if (running.filter((item) => item.definition.appId === definition.appId).length >= this.maxProcessesPerApp) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, `App process limit reached: ${definition.appId}`)
    }

    const launchToken = randomUUID()
    const entryPath = path.resolve(definition.packageRoot, definition.entry)
    const relative = path.relative(path.resolve(definition.packageRoot), entryPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'Backend entry escapes the package root')
    }
    await fsp.mkdir(definition.dataDir, { recursive: true })
    await fsp.mkdir(definition.runtimeDir, { recursive: true })
    const hosted = {
      definition,
      launchToken,
      state: 'starting',
      child: null,
      pending: new Map(),
      seenReplies: new Set(),
      startedAt: Date.now(),
      ready: null,
      readyResolve: null,
      readyReject: null,
      stopping: false,
      failures: options.clearCrashLoop ? [] : current?.failures || this.failureHistory.get(key) || [],
      lastError: null,
      idleTimer: null,
      pingTimer: null,
      restartTimer: null,
      lastPongAt: Date.now(),
      handshakeState: 'waiting-hello',
    }
    hosted.ready = new Promise((resolve, reject) => {
      hosted.readyResolve = resolve
      hosted.readyReject = reject
    })
    const child = spawn(this.nodeExecutable, [entryPath], {
      cwd: definition.packageRoot,
      env: minimalEnvironment({
        ...(this.nodeExecutable === process.execPath && process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
        MOSS_APP_ID: definition.appId,
        MOSS_APP_VERSION: definition.version,
        MOSS_APP_INSTANCE_ID: definition.instanceId,
        MOSS_APP_GENERATION: String(definition.generation),
        MOSS_APP_LAUNCH_TOKEN: launchToken,
      }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    })
    hosted.child = child
    this.processes.set(key, hosted)
    this.emitStatus(key)
    child.stdout?.on('data', (chunk) => this.log(hosted, 'info', String(chunk).trim(), { stream: 'stdout' }))
    child.stderr?.on('data', (chunk) => this.log(hosted, 'error', String(chunk).trim(), { stream: 'stderr' }))
    child.on('message', (message) => this.handleMessage(key, hosted, message))
    child.once('error', (error) => this.handleSpawnError(key, hosted, error))
    child.once('exit', (code, signal) => this.handleExit(key, hosted, code, signal))

    const timeout = setTimeout(() => hosted.readyReject(
      new AppServiceError(APP_ERROR_CODES.handshakeFailed, `App Backend handshake timed out after ${this.handshakeTimeoutMs}ms`),
    ), this.handshakeTimeoutMs)
    try {
      await hosted.ready
      if (!isChildRunning(hosted.child) || this.processes.get(key) !== hosted || hosted.state === 'error' || hosted.state === 'crash-loop') {
        throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend exited during handshake')
      }
      hosted.state = 'running'
      hosted.pingTimer = setInterval(() => {
        if (Date.now() - hosted.lastPongAt > this.healthCheckTimeoutMs) {
          hosted.lastError = 'App Backend health check timed out'
          void this.terminate(hosted).catch((error) => {
            hosted.lastError = `App Backend health termination failed: ${error.message}`
          })
          return
        }
        this.send(hosted, createEnvelope('service.ping', { generation: definition.generation, launchToken }))
      }, this.healthCheckIntervalMs)
      hosted.pingTimer.unref?.()
      this.emitStatus(key)
      this.scheduleIdleStop(key, hosted)
      return this.status(key)
    } catch (error) {
      hosted.lastError = error.message
      if (hosted.state !== 'crash-loop') hosted.state = 'error'
      this.emitStatus(key)
      await this.terminate(hosted)
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }

  handleSpawnError(key, hosted, error) {
    if (this.processes.get(key) !== hosted) return
    hosted.lastError = error.message
    hosted.readyReject(error)
  }

  validateIdentity(hosted, payload = {}) {
    return payload.generation === hosted.definition.generation && payload.launchToken === hosted.launchToken
  }

  handleMessage(key, hosted, raw) {
    if (this.processes.get(key) !== hosted) return
    let message
    try {
      message = validateEnvelope(raw, { allowedTypes: BACKEND_MESSAGE_TYPES })
    } catch (error) {
      this.log(hosted, 'error', error.message)
      hosted.lastError = error.message
      hosted.child?.kill('SIGTERM')
      return
    }
    const payload = message.payload || {}
    if (!this.validateIdentity(hosted, payload)) {
      this.log(hosted, 'warn', 'Rejected stale App Backend message')
      return
    }
    if (message.type === 'service.hello') {
      if (hosted.handshakeState !== 'waiting-hello') {
        hosted.readyReject(new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend sent service.hello out of order'))
        hosted.child?.kill('SIGTERM')
        return
      }
      const expected = hosted.definition
      if (
        payload.appId !== expected.appId ||
        payload.version !== expected.version ||
        payload.instanceId !== expected.instanceId ||
        payload.apiVersion !== 1
      ) {
        hosted.readyReject(new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend identity mismatch'))
        return
      }
      this.send(hosted, createEnvelope('service.init', {
        appId: expected.appId,
        version: expected.version,
        instanceId: expected.instanceId,
        generation: expected.generation,
        launchToken: hosted.launchToken,
        config: expected.config || {},
        secrets: expected.secrets || {},
        dataDir: expected.dataDir,
        runtimeDir: expected.runtimeDir,
        target: expected.target,
      }, { id: message.id }), (error) => hosted.readyReject(
        new AppServiceError(APP_ERROR_CODES.handshakeFailed, `Cannot initialize App Backend: ${error.message}`),
      ))
      hosted.handshakeState = 'waiting-ready'
      return
    }
    if (message.type === 'service.ready') {
      if (hosted.handshakeState !== 'waiting-ready') {
        hosted.readyReject(new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend sent service.ready before initialization'))
        hosted.child?.kill('SIGTERM')
        return
      }
      hosted.handshakeState = 'ready'
      hosted.readyResolve()
      return
    }
    if (hosted.handshakeState !== 'ready') {
      hosted.readyReject(new AppServiceError(APP_ERROR_CODES.handshakeFailed, `App Backend sent ${message.type} before initialization`))
      hosted.child?.kill('SIGTERM')
      return
    }
    if (message.type === 'log.write') {
      this.log(hosted, payload.level || 'info', payload.message || '', payload.details)
      return
    }
    if (message.type === 'event.emit') {
      this.onEvent({
        appId: hosted.definition.appId,
        instanceId: hosted.definition.instanceId,
        name: payload.name,
        data: payload.data,
      })
      return
    }
    if (message.type === 'service.status') {
      this.onStatus({
        ...this.status(key),
        backendStatus: payload.state,
        details: redactAppValue(payload.details, Object.values(hosted.definition.secrets || {})),
      })
      return
    }
    if (message.type === 'service.pong') {
      hosted.lastPongAt = Date.now()
      return
    }
    if (!['action.result', 'action.error'].includes(message.type)) return
    const requestId = payload.requestId || message.id
    if (hosted.seenReplies.has(requestId)) return
    hosted.seenReplies.add(requestId)
    if (hosted.seenReplies.size > 1000) hosted.seenReplies.delete(hosted.seenReplies.values().next().value)
    const pending = hosted.pending.get(requestId)
    if (!pending) return
    hosted.pending.delete(requestId)
    clearTimeout(pending.timeout)
    pending.signal?.removeEventListener('abort', pending.abortHandler)
    if (message.type === 'action.result') pending.resolve(payload.result)
    else pending.reject(errorFromPayload(payload, Object.values(hosted.definition.secrets || {})))
    this.scheduleIdleStop(key, hosted)
  }

  log(hosted, level, message, details) {
    if (!message && details === undefined) return
    const redacted = redactAppValue({ message, details }, Object.values(hosted.definition.secrets || {}))
    this.onLog({
      appId: hosted.definition.appId,
      instanceId: hosted.definition.instanceId,
      level,
      message: redacted.message,
      details: redacted.details,
      redacted: true,
    })
  }

  emitStatus(key) { this.onStatus(this.status(key)) }

  send(hosted, message, onError) {
    const fail = (error) => {
      if (onError) onError(error)
      else this.log(hosted, 'warn', `App Backend IPC send failed: ${error.message}`)
    }
    if (!isChildRunning(hosted.child) || !hosted.child.connected) {
      fail(new Error('App Backend IPC channel is closed'))
      return false
    }
    try {
      hosted.child.send(message, (error) => {
        if (error) fail(error)
      })
      return true
    } catch (error) {
      fail(error)
      return false
    }
  }

  async invoke(key, actionName, input, options = {}) {
    if (options.signal?.aborted) throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'App action canceled')
    await this.start(key)
    if (options.signal?.aborted) throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'App action canceled')
    const hosted = this.processes.get(key)
    if (!hosted || hosted.state !== 'running') throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend is not running')
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    const requestId = String(options.requestId || randomUUID())
    if (hosted.pending.has(requestId)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Duplicate action request: ${requestId}`)
    const requestedTimeoutMs = Number(options.timeoutMs ?? this.actionTimeoutMs)
    const timeoutMs = Math.max(
      100,
      Math.min(Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : this.actionTimeoutMs, this.maxActionTimeoutMs),
    )
    let invocation
    try {
      invocation = createEnvelope('action.invoke', {
        name: actionName,
        input,
        generation: hosted.definition.generation,
        launchToken: hosted.launchToken,
      }, { id: requestId })
      validateEnvelope(invocation, { allowedTypes: ['action.invoke'] })
    } catch (error) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `App action input cannot be serialized: ${error.message}`)
    }
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        hosted.pending.delete(requestId)
        options.signal?.removeEventListener('abort', abortHandler)
        this.send(hosted, createEnvelope('action.cancel', { requestId, generation: hosted.definition.generation, launchToken: hosted.launchToken }))
        reject(new AppServiceError(APP_ERROR_CODES.actionTimeout, `App action timed out after ${timeoutMs}ms`))
        this.scheduleIdleStop(key, hosted)
      }, timeoutMs)
      const abortHandler = () => this.cancel(key, requestId)
      hosted.pending.set(requestId, { resolve, reject, timeout, signal: options.signal, abortHandler })
      options.signal?.addEventListener('abort', abortHandler, { once: true })
    })
    if (!hosted.pending.has(requestId)) return promise
    this.send(hosted, invocation, (error) => {
      const pending = hosted.pending.get(requestId)
      if (!pending) return
      hosted.pending.delete(requestId)
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener('abort', pending.abortHandler)
      pending.reject(new AppServiceError(APP_ERROR_CODES.backendUnavailable, `Cannot invoke App Backend: ${error.message}`))
    })
    return promise
  }

  cancel(key, requestId) {
    const hosted = this.processes.get(key)
    const pending = hosted?.pending.get(requestId)
    if (!hosted || !pending) return false
    hosted.pending.delete(requestId)
    clearTimeout(pending.timeout)
    pending.signal?.removeEventListener('abort', pending.abortHandler)
    pending.reject(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'App action canceled'))
    this.send(hosted, createEnvelope('action.cancel', { requestId, generation: hosted.definition.generation, launchToken: hosted.launchToken }))
    this.scheduleIdleStop(key, hosted)
    return true
  }

  scheduleIdleStop(key, hosted) {
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    if (hosted.definition.lifecycle !== 'on-demand' || hosted.pending.size > 0 || hosted.state !== 'running') return
    hosted.idleTimer = setTimeout(() => this.stop(key).catch(() => {}), hosted.definition.idleTimeoutMs || this.idleTimeoutMs)
    hosted.idleTimer.unref?.()
  }

  async stop(key) { return this.transition(key, () => this.stopNow(key)) }

  async stopNow(key) {
    const hosted = this.processes.get(key)
    if (!hosted) return this.status(key)
    hosted.stopping = true
    if (hosted.restartTimer) clearTimeout(hosted.restartTimer)
    hosted.state = 'stopping'
    this.emitStatus(key)
    if (hosted.child?.connected) {
      this.send(hosted, createEnvelope('service.shutdown', {
        generation: hosted.definition.generation,
        launchToken: hosted.launchToken,
      }))
    }
    if (isChildRunning(hosted.child)) {
      await Promise.race([
        new Promise((resolve) => hosted.child?.once('exit', resolve)),
        sleep(this.shutdownTimeoutMs),
      ])
    }
    await this.terminate(hosted)
    if (this.processes.get(key) === hosted) this.processes.delete(key)
    this.emitStatus(key)
    return this.status(key)
  }

  async terminate(hosted) {
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    if (hosted.pingTimer) clearInterval(hosted.pingTimer)
    for (const pending of hosted.pending.values()) {
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener('abort', pending.abortHandler)
      pending.reject(new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend stopped'))
    }
    hosted.pending.clear()
    if (!isChildRunning(hosted.child)) return
    hosted.child.kill('SIGTERM')
    await Promise.race([
      new Promise((resolve) => hosted.child.once('exit', resolve)),
      sleep(this.killTimeoutMs),
    ])
    if (isChildRunning(hosted.child)) {
      hosted.child.kill('SIGKILL')
      await Promise.race([
        new Promise((resolve) => hosted.child.once('exit', resolve)),
        sleep(250),
      ])
    }
  }

  handleExit(key, hosted, code, signal) {
    if (hosted.pingTimer) clearInterval(hosted.pingTimer)
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    if (this.processes.get(key) !== hosted) return
    if (hosted.stopping || this.shuttingDown) {
      this.processes.delete(key)
      this.emitStatus(key)
      return
    }
    if (hosted.state === 'starting') {
      hosted.readyReject(new AppServiceError(APP_ERROR_CODES.handshakeFailed, `App Backend exited before handshake: ${code ?? 'null'}`))
    }
    const now = Date.now()
    hosted.failures = [...hosted.failures.filter((timestamp) => now - timestamp < this.crashLoopWindowMs), now]
    this.failureHistory.set(key, hosted.failures)
    hosted.lastError = `Backend exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`
    hosted.state = hosted.failures.length >= this.crashLoopThreshold ? 'crash-loop' : 'error'
    for (const pending of hosted.pending.values()) {
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener('abort', pending.abortHandler)
      pending.reject(new AppServiceError(APP_ERROR_CODES.backendUnavailable, hosted.lastError))
    }
    hosted.pending.clear()
    this.emitStatus(key)
    if (hosted.state === 'crash-loop' || hosted.definition.lifecycle !== 'persistent') return
    const delay = Math.min(this.maxRestartDelayMs, this.restartBaseDelayMs * (2 ** Math.max(0, hosted.failures.length - 1)))
    hosted.restartTimer = setTimeout(() => {
      if (this.processes.get(key) === hosted && !hosted.stopping && !this.shuttingDown) {
        this.processes.delete(key)
        this.start(key).catch(() => {})
      }
    }, delay)
    hosted.restartTimer.unref?.()
  }

  async restart(key) {
    this.failureHistory.delete(key)
    await this.stop(key)
    return this.start(key, { clearCrashLoop: true })
  }

  async shutdown() {
    this.shuttingDown = true
    await Promise.allSettled([...this.processes.keys()].map((key) => this.stop(key)))
    this.processes.clear()
  }
}
