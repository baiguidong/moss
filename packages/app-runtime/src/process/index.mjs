import { abortError, requestTimeout } from '../../../app-sdk/src/errors.mjs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  APP_ERROR_CODES,
  AppServiceError,
  BACKEND_MESSAGE_TYPES,
  createEnvelope,
  serializeError,
  validateEnvelope,
  validateHostData,
  validateHostMember,
  validateHostProtocol,
} from '../../../app-sdk/src/index.mjs'
import { redactAppValue } from '../logging/index.mjs'
import { AppProcessLeases } from './lease.mjs'
import { createAppWatchdog } from './watchdog.mjs'

const ALLOWED_ENV = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']
const MAX_HOST_REPLY_CACHE_ENTRIES = 128
const bootstrapUrl = new URL('./bootstrap.mjs', import.meta.url).href

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

function isChildRunning(child) {
  return Boolean(child?.pid && child.exitCode === null && child.signalCode === null)
}

function minimalEnvironment(extra = {}) {
  const env = {}
  for (const key of ALLOWED_ENV) if (process.env[key] !== undefined) env[key] = process.env[key]
  return { ...env, NODE_ENV: 'production', ...extra }
}

function errorFromPayload(payload, secretValues) {
  const error = redactAppValue(serializeError(payload?.error), secretValues)
  return new AppServiceError(
    error.code || APP_ERROR_CODES.backendUnavailable,
    error.message || 'App Backend action failed',
    error.details,
  )
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map(
      (key) => `${JSON.stringify(key)}:${stableJson(value[key])}`,
    ).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function hostFingerprint(...parts) {
  return createHash('sha256').update(stableJson(parts)).digest('hex')
}

function hostTransportCodes() {
  return {
    unavailable: APP_ERROR_CODES.hostUnavailable,
    timeout: APP_ERROR_CODES.hostTimeout,
    protocol: APP_ERROR_CODES.hostProtocol,
    label: 'Host protocol',
  }
}

export class AppProcessSupervisor {
  constructor(options = {}) {
    this.nodeArgs = options.nodeArgs || []
    this.nodeExecutable = options.nodeExecutable || process.env.MOSS_NODE_PATH || process.execPath
    this.handshakeTimeoutMs = options.handshakeTimeoutMs || 15_000
    this.shutdownTimeoutMs = options.shutdownTimeoutMs || 5_000
    this.killTimeoutMs = options.killTimeoutMs || 2_000
    this.actionTimeoutMs = options.actionTimeoutMs || 30_000
    this.maxActionTimeoutMs = options.maxActionTimeoutMs || 300_000
    this.hostRequestTimeoutMs = Math.max(100, Number(options.hostRequestTimeoutMs) || 30_000)
    this.hostEventTimeoutMs = Math.max(100, Number(options.hostEventTimeoutMs) || 30_000)
    this.maxHostTimeoutMs = Math.max(100, Number(options.maxHostTimeoutMs) || 300_000)
    this.maxPendingHostRequests = Math.max(1, Number(options.maxPendingHostRequests) || 32)
    this.maxPendingHostEvents = Math.max(1, Number(options.maxPendingHostEvents) || 32)
    this.idleTimeoutMs = options.idleTimeoutMs || 60_000
    this.healthCheckIntervalMs = options.healthCheckIntervalMs || 30_000
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs || 65_000
    this.maxProcesses = options.maxProcesses || 64
    this.restartBaseDelayMs = options.restartBaseDelayMs || 1_000
    this.maxRestartDelayMs = options.maxRestartDelayMs || 30_000
    this.crashLoopThreshold = options.crashLoopThreshold || 5
    this.crashLoopWindowMs = options.crashLoopWindowMs || 5 * 60_000
    this.onStatus = options.onStatus || (() => {})
    this.onEvent = options.onEvent || (() => {})
    this.onLog = options.onLog || (() => {})
    this.leases = new AppProcessLeases({
      directory: options.processesDir,
      killTimeoutMs: this.killTimeoutMs,
      onRecover: ({ appId, instanceId, owner, pid }) => this.onLog({ appId, instanceId, owner, level: 'warn', message: 'Recovered orphaned App Backend', details: { pid } }),
    })
    this.onHostRequest = options.onHostRequest || (() => {
      throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host capability broker is not configured')
    })
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
      pid: isChildRunning(hosted?.child) ? hosted.child.pid : null,
      generation: definition?.generation || null,
      owner: definition?.owner || null,
      startedAt: hosted?.startedAt || null,
      lastError: hosted?.lastError || null,
      lifecycle: definition?.lifecycle || null,
      lastHeartbeatAt: hosted?.lastPongAt || null,
      healthCheckTimeoutMs: this.healthCheckTimeoutMs,
      healthCheckDeadlineAt: hosted?.healthWatchdog?.deadlineAt || null,
      recentCrashCount: (this.failureHistory.get(key) || []).filter(time => Date.now() - time < this.crashLoopWindowMs).length,
      pendingActions: hosted?.pending?.size || 0,
      pendingHostEvents: hosted?.pendingHostEvents?.size || 0,
      pendingHostRequests: hosted?.hostRequests?.size || 0,
    }
  }

  listStatuses() {
    return [...this.definitions.keys()].map((key) => this.status(key))
  }

  recoverOrphans() { return this.leases.recoverAll() }

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
    if (!definition) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, `Unknown App runtime: ${key}`)
    const current = this.processes.get(key)
    if (current?.state === 'running') return this.status(key)
    if (current?.state === 'crash-loop' && !options.clearCrashLoop) {
      throw new AppServiceError(APP_ERROR_CODES.crashLoop, `App runtime is in crash-loop: ${key}`)
    }
    // A caller can retry immediately after an exit, before asynchronous lease
    // cleanup has finished. Wait before trying to acquire our own old lease.
    if (current && !isChildRunning(current.child)) await this.releaseLease(current)
    const launchToken = randomUUID()
    const entryPath = path.resolve(definition.packageRoot, definition.entry)
    const relative = path.relative(path.resolve(definition.packageRoot), entryPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'Backend entry escapes the package root')
    }
    await fsp.mkdir(definition.dataDir, { recursive: true })
    await fsp.mkdir(definition.runtimeDir, { recursive: true })
    // Check immediately before reserving the process, after all asynchronous preparation.
    if (this.shuttingDown) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend supervisor is shutting down')
    const running = [...this.processes.values()].filter((item) =>
      item.state === 'starting' || isChildRunning(item.child))
    if (running.length >= this.maxProcesses) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'Host App process limit reached')
    if (running.some((item) => item.definition.appId === definition.appId)) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, `App Backend is already running: ${definition.appId}`)
    }
    const hosted = {
      definition,
      launchToken,
      state: 'starting',
      child: null,
      pending: new Map(),
      seenReplies: new Set(),
      pendingHostEvents: new Map(),
      seenHostEventReplies: new Set(),
      hostRequests: new Map(),
      hostRequestReplies: new Map(),
      startedAt: Date.now(),
      ready: null,
      readyResolve: null,
      readyReject: null,
      stopping: false,
      failures: options.clearCrashLoop ? [] : current?.failures || this.failureHistory.get(key) || [],
      lastError: null,
      stderrTail: '',
      failureReason: null,
      healthWatchdog: null,
      idleTimer: null,
      pingTimer: null,
      restartTimer: null,
      lastPongAt: Date.now(),
      handshakeState: 'bootstrapping',
      lease: null,
      leaseRelease: null,
      bootstrap: null,
    }
    hosted.ready = new Promise((resolve, reject) => {
      hosted.readyResolve = resolve
      hosted.readyReject = reject
    })
    // Reserve in memory before awaiting the cross-Host ownership lock.
    this.processes.set(key, hosted)
    let child
    try {
      hosted.lease = await this.leases.acquire(definition)
      if (this.shuttingDown) throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend supervisor is shutting down')
      child = spawn(this.nodeExecutable, [...this.nodeArgs, '--import', bootstrapUrl, entryPath, hosted.lease.marker], {
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
    } catch (error) {
      await this.releaseLease(hosted)
      if (this.processes.get(key) === hosted) this.processes.delete(key)
      throw error
    }
    hosted.child = child
    this.emitStatus(key)
    child.stdout?.on('data', (chunk) => this.log(hosted, 'info', String(chunk).trim(), { stream: 'stdout' }))
    child.stderr?.on('data', (chunk) => {
      hosted.stderrTail = (hosted.stderrTail + String(chunk)).slice(-8192)
      this.log(hosted, 'error', String(chunk).trim(), { stream: 'stderr' })
    })
    child.on('message', (message) => {
      if (hosted.handshakeState === 'bootstrapping' && message?.type === 'moss.app.bootstrap' && message.marker === hosted.lease.marker) {
        hosted.handshakeState = 'recording-process'
        hosted.bootstrap = hosted.lease.recordChild(child.pid).then(() => {
          if (!isChildRunning(child)) return
          hosted.handshakeState = 'waiting-hello'
          this.send(hosted, { type: 'moss.app.launch', marker: hosted.lease.marker }, error => hosted.readyReject(error))
        })
        void hosted.bootstrap.catch(error => hosted.readyReject(error))
        return
      }
      this.handleMessage(key, hosted, message)
    })
    child.once('error', (error) => this.handleSpawnError(key, hosted, error))
    child.once('exit', (code, signal) => this.handleExit(key, hosted, code, signal))

    const handshakeIntervalMs = Math.min(1_000, this.handshakeTimeoutMs)
    const handshakeWatchdog = createAppWatchdog({ timeoutMs: this.handshakeTimeoutMs, intervalMs: handshakeIntervalMs })
    const timeout = setInterval(() => {
      if (handshakeWatchdog.expired()) hosted.readyReject(
        new AppServiceError(APP_ERROR_CODES.handshakeFailed, `App Backend handshake timed out after ${this.handshakeTimeoutMs}ms`),
      )
    }, handshakeIntervalMs)
    try {
      await hosted.ready
      if (!isChildRunning(hosted.child) || this.processes.get(key) !== hosted || hosted.state === 'error' || hosted.state === 'crash-loop') {
        throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend exited during handshake')
      }
      hosted.state = 'running'
      hosted.lastPongAt = Date.now()
      hosted.healthWatchdog = createAppWatchdog({ timeoutMs: this.healthCheckTimeoutMs, intervalMs: this.healthCheckIntervalMs })
      hosted.pingTimer = setInterval(() => {
        if (hosted.stopping) return
        if (hosted.healthWatchdog.expired()) {
          hosted.failureReason = hosted.lastError = 'App Backend health check timed out'
          this.log(hosted, 'error', hosted.lastError, { pid: hosted.child.pid })
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
      if (isChildRunning(hosted.child)) {
        hosted.failureReason = error.message
        hosted.lastError = error.message
        this.log(hosted, 'error', hosted.lastError, { pid: hosted.child.pid })
      } else hosted.lastError ||= error.message
      if (hosted.state !== 'crash-loop') hosted.state = 'error'
      this.emitStatus(key)
      await this.terminate(hosted)
      throw error
    } finally {
      clearInterval(timeout)
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
      hosted.failureReason = hosted.lastError = error.message
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
        owner: expected.owner || null,
        protocols: expected.protocols || [],
        permissions: expected.permissions || [],
        grants: expected.grants ?? [],
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
    const messageAllowedDuringInitialization = hosted.handshakeState === 'waiting-ready'
      && ['host.request', 'host.cancel', 'host.event.response', 'service.status', 'log.write'].includes(message.type)
    if (hosted.handshakeState !== 'ready' && !messageAllowedDuringInitialization) {
      hosted.readyReject(new AppServiceError(APP_ERROR_CODES.handshakeFailed, `App Backend sent ${message.type} before initialization`))
      hosted.child?.kill('SIGTERM')
      return
    }
    if (message.type === 'host.request') {
      this.handleHostRequest(key, hosted, message)
      return
    }
    if (message.type === 'host.cancel') {
      try {
        validateHostProtocol(payload.protocol)
      } catch (error) {
        this.log(hosted, 'error', error.message)
        return
      }
      this.cancelHostRequest(hosted, payload.requestId, payload.protocol, payload.reason)
      return
    }
    if (message.type === 'host.event.response') {
      this.handleHostEventResponse(key, hosted, message)
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
        owner: hosted.definition.owner || null,
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
      hosted.healthWatchdog?.refresh()
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

  handleHostRequest(key, hosted, message) {
    const payload = message.payload || {}
    const codes = hostTransportCodes()
    const requestId = String(message.id || '')
    const fingerprint = hostFingerprint(payload.protocol, payload.method, payload.input)
    const cached = hosted.hostRequestReplies.get(requestId)
    if (cached) {
      if (cached.fingerprint === fingerprint) this.send(hosted, cached.response)
      else this.sendHostResponse(hosted, message, false, undefined, new AppServiceError(
        codes.protocol,
        `Host request id was reused with a different payload: ${requestId}`,
      ), { cache: false, fingerprint })
      return
    }
    const existing = hosted.hostRequests.get(requestId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.sendHostResponse(hosted, message, false, undefined, new AppServiceError(
          codes.protocol,
          `Host request id was reused with a different payload: ${requestId}`,
        ), { cache: false, fingerprint })
      }
      return
    }
    if (hosted.hostRequests.size >= this.maxPendingHostRequests) {
      this.sendHostResponse(hosted, message, false, undefined, new AppServiceError(
        APP_ERROR_CODES.resourceExhausted,
        `${codes.label} request limit reached`,
      ), { cache: false, fingerprint })
      return
    }
    let protocol
    let method
    let input, timeoutMs
    try {
      timeoutMs = requestTimeout(payload.timeoutMs, this.hostRequestTimeoutMs, this.maxHostTimeoutMs)
      protocol = validateHostProtocol(payload.protocol)
      method = validateHostMember(payload.method, `${protocol} method`)
      input = validateHostData(payload.input, `${protocol} ${method} input`)
    } catch (error) {
      this.sendHostResponse(hosted, message, false, undefined, error, { fingerprint })
      return
    }
    const actionRequestId = String(payload.actionRequestId || '')
    const actionRequest = actionRequestId ? hosted.pending.get(actionRequestId) : null
    const controller = new AbortController()
    const active = { controller, fingerprint, protocol, timer: null, finish: null }
    const finish = (ok, result, error) => {
      if (hosted.hostRequests.get(requestId) !== active) return
      clearTimeout(active.timer)
      hosted.hostRequests.delete(requestId)
      const response = this.createHostResponse(hosted, message, ok, result, error)
      hosted.hostRequestReplies.set(requestId, { fingerprint, response })
      if (hosted.hostRequestReplies.size > MAX_HOST_REPLY_CACHE_ENTRIES) {
        hosted.hostRequestReplies.delete(hosted.hostRequestReplies.keys().next().value)
      }
      if (this.processes.get(key) === hosted && !hosted.stopping) this.send(hosted, response)
    }
    active.finish = finish
    active.timer = setTimeout(() => {
      controller.abort(new AppServiceError(codes.timeout, `${codes.label} request timed out`))
      finish(false, undefined, new AppServiceError(
        codes.timeout,
        `${codes.label} request timed out after ${timeoutMs}ms`,
      ))
    }, timeoutMs)
    active.timer.unref?.()
    hosted.hostRequests.set(requestId, active)
    Promise.resolve().then(() => {
      if (controller.signal.aborted) {
        throw controller.signal.reason || new AppServiceError(APP_ERROR_CODES.actionCanceled, `${codes.label} request canceled`)
      }
      return this.onHostRequest({
        key,
        appId: hosted.definition.appId,
        version: hosted.definition.version,
        instanceId: hosted.definition.instanceId,
        generation: hosted.definition.generation,
        owner: hosted.definition.owner || null,
        principal: actionRequest?.principal || hosted.definition.owner || null,
        invocation: actionRequest?.invocation || null,
        requestId,
        protocol,
        method,
        input,
        signal: controller.signal,
        timeoutMs,
      })
    }).then(
      (result) => finish(true, result),
      (error) => finish(false, undefined, error),
    )
  }

  createHostResponse(hosted, message, ok, result, error) {
    const requestId = String(message.id || '')
    const protocol = String(message.payload?.protocol || '')
    const codes = hostTransportCodes()
    const secretValues = Object.values(hosted.definition.secrets || {})
    let response = createEnvelope('host.response', {
      protocol,
      requestId,
      ok,
      ...(ok
        ? { result }
        : { error: redactAppValue(serializeError(error, codes.unavailable), secretValues) }),
      generation: hosted.definition.generation,
      launchToken: hosted.launchToken,
    }, { id: requestId })
    try {
      validateEnvelope(response, { allowedTypes: ['host.response'] })
    } catch (serializationError) {
      response = createEnvelope('host.response', {
        protocol,
        requestId,
        ok: false,
        error: serializeError(serializationError, codes.protocol),
        generation: hosted.definition.generation,
        launchToken: hosted.launchToken,
      }, { id: requestId })
    }
    return response
  }

  sendHostResponse(hosted, message, ok, result, error, options = {}) {
    const payload = message.payload || {}
    const requestId = String(message.id || '')
    const fingerprint = options.fingerprint || hostFingerprint(payload.protocol, payload.method, payload.input)
    const response = this.createHostResponse(hosted, message, ok, result, error)
    if (options.cache !== false) {
      hosted.hostRequestReplies.set(requestId, { fingerprint, response })
      if (hosted.hostRequestReplies.size > MAX_HOST_REPLY_CACHE_ENTRIES) {
        hosted.hostRequestReplies.delete(hosted.hostRequestReplies.keys().next().value)
      }
    }
    this.send(hosted, response)
  }

  cancelHostRequest(hosted, requestId, protocol, reason) {
    const active = hosted.hostRequests.get(String(requestId || ''))
    if (!active || active.protocol !== protocol) return false
    const error = new AppServiceError(reason === APP_ERROR_CODES.hostTimeout ? APP_ERROR_CODES.hostTimeout : APP_ERROR_CODES.actionCanceled, reason === APP_ERROR_CODES.hostTimeout ? 'Host request timed out' : 'Host request canceled')
    active.controller.abort(error)
    active.finish(false, undefined, error)
    return true
  }

  handleHostEventResponse(key, hosted, message) {
    const payload = message.payload || {}
    let protocol
    try {
      protocol = validateHostProtocol(payload.protocol)
    } catch (error) {
      this.log(hosted, 'error', error.message)
      return
    }
    const eventId = String(payload.eventId || message.id || '')
    if (hosted.seenHostEventReplies.has(eventId)) return
    const pending = hosted.pendingHostEvents.get(eventId)
    if (!pending || pending.protocol !== protocol) return
    hosted.seenHostEventReplies.add(eventId)
    if (hosted.seenHostEventReplies.size > 1000) {
      hosted.seenHostEventReplies.delete(hosted.seenHostEventReplies.values().next().value)
    }
    pending.finish(
      payload.ok === true ? null : errorFromPayload(payload, Object.values(hosted.definition.secrets || {})),
      payload.result,
    )
    this.scheduleIdleStop(key, hosted)
  }

  log(hosted, level, message, details) {
    if (!message && details === undefined) return
    const redacted = redactAppValue({ message, details }, Object.values(hosted.definition.secrets || {}))
    this.onLog({
      appId: hosted.definition.appId,
      instanceId: hosted.definition.instanceId,
      owner: hosted.definition.owner || null,
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
    if (options.signal?.aborted) throw abortError(options.signal)
    await this.start(key)
    if (options.signal?.aborted) throw abortError(options.signal)
    const hosted = this.processes.get(key)
    if (!hosted || hosted.state !== 'running') throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend is not running')
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    const requestId = randomUUID() // Transport attempts are distinct from caller submission identity.
    if (hosted.pending.has(requestId)) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Duplicate action request: ${requestId}`)
    const timeoutMs = options.deadlineAt
      ? Math.max(1, options.deadlineAt - Date.now())
      : requestTimeout(options.timeoutMs, Math.min(this.actionTimeoutMs, this.maxActionTimeoutMs), this.maxActionTimeoutMs)
    let invocation
    try {
      invocation = createEnvelope('action.invoke', {
        name: actionName,
        input,
        submissionId: String(options.requestId || requestId),
        source: { surface: options.invocation?.surface, workspace: options.invocation?.workspace },
        principal: options.principal || hosted.definition.owner || null,
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
      const abortHandler = () => this.cancel(key, requestId, abortError(options.signal))
      hosted.pending.set(requestId, {
        resolve,
        reject,
        timeout,
        signal: options.signal,
        abortHandler,
        invocation: options.invocation || null,
        principal: options.principal || hosted.definition.owner || null,
      })
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

  cancel(key, requestId, reason) {
    const hosted = this.processes.get(key)
    const pending = hosted?.pending.get(requestId)
    if (!hosted || !pending) return false
    hosted.pending.delete(requestId)
    clearTimeout(pending.timeout)
    pending.signal?.removeEventListener('abort', pending.abortHandler)
    pending.reject(reason || new AppServiceError(APP_ERROR_CODES.actionCanceled, 'App action canceled'))
    this.send(hosted, createEnvelope('action.cancel', { requestId, generation: hosted.definition.generation, launchToken: hosted.launchToken }))
    this.scheduleIdleStop(key, hosted)
    return true
  }

  async publishHostEvent(key, protocol, name, data = {}, options = {}) {
    const codes = hostTransportCodes()
    if (options.signal?.aborted) {
      throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host event canceled')
    }
    const normalizedProtocol = validateHostProtocol(protocol)
    const normalizedName = validateHostMember(name, `${normalizedProtocol} event`)
    const normalizedData = validateHostData(data, `${normalizedProtocol} ${normalizedName} data`)
    const existing = this.processes.get(key)
    if (options.onlyIfRunning) {
      if (existing?.state !== 'running' || existing.stopping) {
        throw new AppServiceError(codes.unavailable, 'App Backend is not running')
      }
    } else if (!(existing?.state === 'starting' && existing.handshakeState === 'waiting-ready')) await this.start(key)
    if (options.signal?.aborted) {
      throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host event canceled')
    }
    const hosted = this.processes.get(key)
    if (!hosted || !['starting', 'running'].includes(hosted.state)) {
      throw new AppServiceError(codes.unavailable, 'App Backend is not running')
    }
    if (hosted.pendingHostEvents.size >= this.maxPendingHostEvents) {
      throw new AppServiceError(codes.unavailable, 'Host event limit reached')
    }
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    const eventId = String(options.eventId || randomUUID())
    if (!eventId || eventId.length > 128 || hosted.pendingHostEvents.has(eventId)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Host event id is invalid or duplicated')
    }
    // A durable Host retry intentionally reuses the event id. Accept the
    // Backend's cached ACK instead of treating it as a duplicate reply.
    hosted.seenHostEventReplies.delete(eventId)
    const requestedTimeoutMs = Number(options.timeoutMs ?? this.hostEventTimeoutMs)
    const timeoutMs = Math.max(
      100,
      Math.min(Number.isFinite(requestedTimeoutMs) ? requestedTimeoutMs : this.hostEventTimeoutMs, this.maxHostTimeoutMs),
    )
    let event
    try {
      event = createEnvelope('host.event', {
        protocol: normalizedProtocol,
        eventId,
        name: normalizedName,
        data: normalizedData,
        generation: hosted.definition.generation,
        launchToken: hosted.launchToken,
      }, { id: eventId })
      validateEnvelope(event, { allowedTypes: ['host.event'] })
    } catch (error) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Host event cannot be serialized: ${error.message}`)
    }
    const promise = new Promise((resolve, reject) => {
      const finish = (error, result) => {
        const pending = hosted.pendingHostEvents.get(eventId)
        if (!pending) return
        clearTimeout(pending.timer)
        pending.signal?.removeEventListener('abort', pending.abortHandler)
        hosted.pendingHostEvents.delete(eventId)
        if (error) reject(error)
        else resolve(result)
      }
      const timer = setTimeout(() => {
        this.send(hosted, createEnvelope('host.event.cancel', {
          protocol: normalizedProtocol,
          eventId,
          generation: hosted.definition.generation,
          launchToken: hosted.launchToken,
        }))
        finish(new AppServiceError(codes.timeout, `Host event timed out after ${timeoutMs}ms`))
        this.scheduleIdleStop(key, hosted)
      }, timeoutMs)
      timer.unref?.()
      const abortHandler = () => {
        this.send(hosted, createEnvelope('host.event.cancel', {
          protocol: normalizedProtocol,
          eventId,
          generation: hosted.definition.generation,
          launchToken: hosted.launchToken,
        }))
        finish(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host event canceled'))
        this.scheduleIdleStop(key, hosted)
      }
      hosted.pendingHostEvents.set(eventId, {
        resolve,
        reject,
        timer,
        signal: options.signal,
        abortHandler,
        finish,
        protocol: normalizedProtocol,
      })
      options.signal?.addEventListener('abort', abortHandler, { once: true })
    })
    this.send(hosted, event, (error) => {
      const pending = hosted.pendingHostEvents.get(eventId)
      if (!pending) return
      pending.finish(new AppServiceError(codes.unavailable, `Cannot publish Host event: ${error.message}`))
    })
    return promise
  }

  cancelHostEvent(key, protocol, eventId) {
    const hosted = this.processes.get(key)
    const pending = hosted?.pendingHostEvents.get(String(eventId || ''))
    if (!hosted || !pending || pending.protocol !== protocol) return false
    this.send(hosted, createEnvelope('host.event.cancel', {
      protocol,
      eventId,
      generation: hosted.definition.generation,
      launchToken: hosted.launchToken,
    }))
    pending.finish(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host event canceled'))
    this.scheduleIdleStop(key, hosted)
    return true
  }

  scheduleIdleStop(key, hosted) {
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    if (
      hosted.definition.lifecycle !== 'on-demand'
      || hosted.pending.size > 0
      || hosted.pendingHostEvents.size > 0
      || hosted.hostRequests.size > 0
      || hosted.state !== 'running'
    ) return
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
    this.clearActionWork(hosted, new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend stopped'))
    this.clearHostWork(hosted)
    if (!isChildRunning(hosted.child)) {
      await this.releaseLease(hosted)
      return
    }
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
    if (isChildRunning(hosted.child)) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, `App Backend did not exit: ${hosted.definition.appId}`)
    }
    await this.releaseLease(hosted)
  }

  releaseLease(hosted) {
    if (!hosted.lease) return Promise.resolve()
    if (!hosted.leaseRelease) {
      hosted.leaseRelease = Promise.resolve(hosted.bootstrap).catch(() => {}).then(() => hosted.lease.release())
    }
    return hosted.leaseRelease
  }

  handleExit(key, hosted, code, signal) {
    if (hosted.pingTimer) clearInterval(hosted.pingTimer)
    if (hosted.idleTimer) clearTimeout(hosted.idleTimer)
    void this.releaseLease(hosted).catch(error => {
      hosted.lastError = `App Backend ownership cleanup failed: ${error.message}`
      this.log(hosted, 'error', hosted.lastError)
    })
    if (this.processes.get(key) !== hosted) return
    if (hosted.state === 'starting') {
      const detail = redactAppValue(hosted.stderrTail.trim(), Object.values(hosted.definition.secrets || {}))
      hosted.readyReject(new AppServiceError(APP_ERROR_CODES.handshakeFailed, `App Backend exited before handshake: ${code ?? 'null'}${detail ? `\n${detail}` : ''}`))
    }
    if (hosted.stopping || this.shuttingDown) {
      this.clearActionWork(hosted, new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App Backend stopped'))
      this.clearHostWork(hosted)
      this.processes.delete(key)
      this.emitStatus(key)
      return
    }
    const now = Date.now()
    hosted.failures = [...hosted.failures.filter((timestamp) => now - timestamp < this.crashLoopWindowMs), now]
    this.failureHistory.set(key, hosted.failures)
    const exitMessage = `Backend exited with code ${code ?? 'null'}${signal ? ` (${signal})` : ''}`
    hosted.lastError = hosted.failureReason ? `${hosted.failureReason}; ${exitMessage}` : exitMessage
    this.log(hosted, 'error', hosted.lastError, { pid: hosted.child?.pid, code, signal })
    hosted.state = hosted.failures.length >= this.crashLoopThreshold ? 'crash-loop' : 'error'
    this.clearActionWork(hosted, new AppServiceError(APP_ERROR_CODES.backendUnavailable, hosted.lastError))
    this.clearHostWork(hosted, hosted.lastError)
    this.emitStatus(key)
    if (hosted.state === 'crash-loop' || hosted.definition.lifecycle !== 'persistent') return
    const delay = Math.min(this.maxRestartDelayMs, this.restartBaseDelayMs * (2 ** Math.max(0, hosted.failures.length - 1)))
    hosted.restartTimer = setTimeout(() => {
      void this.releaseLease(hosted).then(() => {
        if (this.processes.get(key) === hosted && !hosted.stopping && !this.shuttingDown) {
          this.processes.delete(key)
          this.start(key).catch(() => {})
        }
      }).catch(() => {})
    }, delay)
    hosted.restartTimer.unref?.()
  }

  clearHostWork(hosted, message = 'App Backend stopped') {
    for (const pending of [...hosted.pendingHostEvents.values()]) {
      const codes = hostTransportCodes()
      pending.finish(new AppServiceError(codes.unavailable, message))
    }
    hosted.pendingHostEvents.clear()
    for (const active of hosted.hostRequests.values()) {
      clearTimeout(active.timer)
      const codes = hostTransportCodes()
      active.controller.abort(new AppServiceError(codes.unavailable, message))
    }
    hosted.hostRequests.clear()
  }

  clearActionWork(hosted, error) {
    for (const pending of hosted.pending.values()) {
      clearTimeout(pending.timeout)
      pending.signal?.removeEventListener('abort', pending.abortHandler)
      pending.reject(error)
    }
    hosted.pending.clear()
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
