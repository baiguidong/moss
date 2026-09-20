import { createHash, randomUUID } from 'node:crypto'
import {
  APP_ERROR_CODES,
  AppServiceError,
  BACKEND_MESSAGE_TYPES,
  HOST_MESSAGE_TYPES,
  createEnvelope,
  serializeError,
  validateEnvelope,
} from '../protocol/index.mjs'
import {
  MOSS_CHANNEL_PROTOCOL,
  getChannelBackendEventPermission,
  getChannelHostMethodPermission,
  requireChannelPermission,
  validateChannelBackendEvent,
  validateChannelBackendEventData,
  validateChannelHostMethod,
  validateChannelHostInput,
  validateChannelProtocol,
} from '../channel/index.mjs'

const DEFAULT_CHANNEL_TIMEOUT_MS = 30_000
const MAX_CHANNEL_TIMEOUT_MS = 300_000
const MAX_CHANNEL_REPLY_CACHE_ENTRIES = 128

function boundedTimeout(value, fallback = DEFAULT_CHANNEL_TIMEOUT_MS) {
  const parsed = Number(value ?? fallback)
  return Math.max(100, Math.min(Number.isFinite(parsed) ? parsed : fallback, MAX_CHANNEL_TIMEOUT_MS))
}

function channelError(payload, fallbackMessage) {
  const error = payload?.error || {}
  return new AppServiceError(
    error.code || APP_ERROR_CODES.channelUnavailable,
    error.message || fallbackMessage,
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

function channelFingerprint(...parts) {
  return createHash('sha256').update(stableJson(parts)).digest('hex')
}

export class AppBackendClient {
  constructor(options = {}) {
    this.actions = new Map()
    this.controllers = new Map()
    this.channelHandlers = new Map()
    this.channelRequests = new Map()
    this.channelEvents = new Map()
    this.channelEventReplies = new Map()
    this.context = null
    this.channelClosed = true
    this.started = false
    this.onInitialize = options.onInitialize || null
    this.onShutdown = options.onShutdown || null
    this.onFatalError = options.onFatalError || null
    this.channelRequestTimeoutMs = boundedTimeout(options.channelRequestTimeoutMs)
    this.maxPendingChannelRequests = Math.max(1, Number(options.maxPendingChannelRequests) || 32)
    this.maxActiveChannelEvents = Math.max(1, Number(options.maxActiveChannelEvents) || 32)
    this.send = options.send || ((message) => process.send?.(message))
    this.onMessage = options.onMessage || ((handler) => process.on('message', handler))
    this.onDisconnect = options.onDisconnect || ((handler) => {
      if (typeof process.send === 'function') process.once('disconnect', handler)
    })
    this.channel = Object.freeze({
      request: (method, input, requestOptions) => this.requestChannelHost(method, input, requestOptions),
      on: (name, handler) => this.onChannelEvent(name, handler),
    })
  }

  registerAction(name, handler) {
    if (!name || typeof handler !== 'function') throw new TypeError('registerAction requires a name and handler')
    this.actions.set(name, handler)
    return this
  }

  onChannelEvent(name, handler) {
    const normalized = validateChannelBackendEvent(name)
    if (typeof handler !== 'function') throw new TypeError('Channel event handler must be a function')
    if (this.channelHandlers.has(normalized)) {
      throw new TypeError(`Channel event handler is already registered: ${normalized}`)
    }
    this.channelHandlers.set(normalized, handler)
    return () => {
      if (this.channelHandlers.get(normalized) === handler) this.channelHandlers.delete(normalized)
    }
  }

  async requestChannelHost(method, input = {}, options = {}) {
    if (!this.context || this.channelClosed) {
      return Promise.reject(new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'Channel Host is not initialized'))
    }
    if (this.channelRequests.size >= this.maxPendingChannelRequests) {
      return Promise.reject(new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'Channel Host request limit reached'))
    }
    const normalizedMethod = validateChannelHostMethod(method)
    if (!this.context.protocols?.includes(MOSS_CHANNEL_PROTOCOL)) {
      throw new AppServiceError(
        APP_ERROR_CODES.channelUnavailable,
        `App Backend was not initialized with protocol: ${MOSS_CHANNEL_PROTOCOL}`,
      )
    }
    requireChannelPermission(this.context.permissions, getChannelHostMethodPermission(normalizedMethod))
    const normalizedInput = validateChannelHostInput(normalizedMethod, input)
    const requestId = String(options.requestId || randomUUID())
    if (!requestId || requestId.length > 128 || this.channelRequests.has(requestId)) {
      return Promise.reject(new AppServiceError(APP_ERROR_CODES.invalidInput, 'Channel Host request id is invalid or duplicated'))
    }
    const timeoutMs = boundedTimeout(options.timeoutMs, this.channelRequestTimeoutMs)
    let message
    try {
      message = createEnvelope('channel.request', {
        protocol: MOSS_CHANNEL_PROTOCOL,
        method: normalizedMethod,
        input: normalizedInput,
        ...this.identity(),
      }, { id: requestId })
      validateEnvelope(message, { allowedTypes: ['channel.request'] })
    } catch (error) {
      return Promise.reject(new AppServiceError(
        APP_ERROR_CODES.invalidInput,
        `Channel Host request cannot be serialized: ${error.message}`,
      ))
    }
    return new Promise((resolve, reject) => {
      const finish = (error, result) => {
        const pending = this.channelRequests.get(requestId)
        if (!pending) return
        clearTimeout(pending.timer)
        pending.signal?.removeEventListener('abort', pending.abortHandler)
        this.channelRequests.delete(requestId)
        if (error) reject(error)
        else resolve(result)
      }
      const timer = setTimeout(() => {
        try {
          this.send(createEnvelope('channel.cancel', {
            protocol: MOSS_CHANNEL_PROTOCOL,
            requestId,
            ...this.identity(),
          }))
        } catch {} finally {
          finish(new AppServiceError(APP_ERROR_CODES.channelTimeout, `Channel Host request timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)
      timer.unref?.()
      const abortHandler = () => {
        try {
          this.send(createEnvelope('channel.cancel', {
            protocol: MOSS_CHANNEL_PROTOCOL,
            requestId,
            ...this.identity(),
          }))
        } catch {} finally {
          finish(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Channel Host request canceled'))
        }
      }
      this.channelRequests.set(requestId, { resolve, reject, timer, signal: options.signal, abortHandler, finish })
      if (options.signal?.aborted) {
        abortHandler()
        return
      }
      options.signal?.addEventListener('abort', abortHandler, { once: true })
      try {
        this.send(message)
      } catch (error) {
        finish(new AppServiceError(APP_ERROR_CODES.channelUnavailable, `Cannot call Channel Host: ${error.message}`))
      }
    })
  }

  emit(name, data) {
    this.send(createEnvelope('event.emit', { name, data, ...this.identity() }))
  }

  log(level, message, details) {
    this.send(createEnvelope('log.write', { level, message, details, ...this.identity() }))
  }

  status(state, details) {
    this.send(createEnvelope('service.status', { state, details, ...this.identity() }))
  }

  identity() {
    return {
      generation: this.context?.generation,
      launchToken: this.context?.launchToken,
    }
  }

  hasCurrentIdentity(payload = {}) {
    return Boolean(
      this.context
      && payload.generation === this.context.generation
      && payload.launchToken === this.context.launchToken
    )
  }

  closeChannel(error = new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'Channel Host disconnected')) {
    this.channelClosed = true
    for (const pending of [...this.channelRequests.values()]) pending.finish(error)
    for (const active of this.channelEvents.values()) {
      active.canceled = true
      active.retryMessage = null
      active.controller.abort(error)
    }
    this.channelEvents.clear()
    this.channelEventReplies.clear()
  }

  handleChannelResponse(message) {
    const payload = message.payload || {}
    try { validateChannelProtocol(payload.protocol) } catch (error) {
      this.log('error', error.message)
      return
    }
    const requestId = String(payload.requestId || message.id || '')
    const pending = this.channelRequests.get(requestId)
    if (!pending) return
    if (payload.ok === true) pending.finish(null, payload.result)
    else pending.finish(channelError(payload, 'Channel Host request failed'))
  }

  async handleChannelEvent(message) {
    const payload = message.payload || {}
    if (this.channelClosed) return
    const eventId = String(payload.eventId || message.id || '')
    const fingerprint = channelFingerprint(payload.protocol, payload.name, payload.data)
    const cached = this.channelEventReplies.get(eventId)
    if (cached) {
      if (cached.fingerprint === fingerprint) this.send(cached.response)
      else this.sendChannelEventResponse(message, false, undefined, new AppServiceError(
        APP_ERROR_CODES.channelProtocol,
        `Channel event id was reused with a different payload: ${eventId}`,
      ), { cache: false, fingerprint })
      return
    }
    const existing = this.channelEvents.get(eventId)
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        this.sendChannelEventResponse(message, false, undefined, new AppServiceError(
          APP_ERROR_CODES.channelProtocol,
          `Channel event id was reused with a different payload: ${eventId}`,
        ), { cache: false, fingerprint })
      } else if (existing.canceled) {
        existing.retryMessage = message
      }
      return
    }
    let name
    try {
      validateChannelProtocol(payload.protocol)
      name = validateChannelBackendEvent(payload.name)
      if (!this.context?.protocols?.includes(MOSS_CHANNEL_PROTOCOL)) {
        throw new AppServiceError(
          APP_ERROR_CODES.channelUnavailable,
          `App Backend was not initialized with protocol: ${MOSS_CHANNEL_PROTOCOL}`,
        )
      }
      requireChannelPermission(this.context.permissions, getChannelBackendEventPermission(name))
      validateChannelBackendEventData(name, payload.data)
    } catch (error) {
      this.sendChannelEventResponse(message, false, undefined, error, { fingerprint })
      return
    }
    const handler = this.channelHandlers.get(name)
    if (!handler) {
      this.sendChannelEventResponse(message, false, undefined, new AppServiceError(
        APP_ERROR_CODES.channelUnavailable,
        `No Channel event handler is registered for ${name}`,
      ), { fingerprint })
      return
    }
    if (this.channelEvents.size >= this.maxActiveChannelEvents) {
      this.sendChannelEventResponse(message, false, undefined, new AppServiceError(
        APP_ERROR_CODES.channelUnavailable,
        'Channel event concurrency limit reached',
      ), { cache: false, fingerprint })
      return
    }
    const controller = new AbortController()
    const active = {
      controller,
      fingerprint,
      canceled: false,
      responded: false,
      retryMessage: null,
    }
    this.channelEvents.set(eventId, active)
    try {
      const result = await handler(payload.data, {
        ...this.context,
        channel: this.channel,
        signal: controller.signal,
        eventId,
        name,
        protocol: MOSS_CHANNEL_PROTOCOL,
      })
      if (this.channelEvents.get(eventId) === active) {
        this.sendChannelEventResponse(message, true, result, undefined, { fingerprint })
        active.responded = true
      }
    } catch (error) {
      if (this.channelEvents.get(eventId) === active && !active.canceled) {
        this.sendChannelEventResponse(message, false, undefined, error, { fingerprint })
        active.responded = true
      }
    } finally {
      if (this.channelEvents.get(eventId) === active) {
        this.channelEvents.delete(eventId)
        if (active.retryMessage && !active.responded && !this.channelClosed) {
          queueMicrotask(() => {
            void this.handleChannelEvent(active.retryMessage).catch((error) => this.handleFatalError(error))
          })
        }
      }
    }
  }

  sendChannelEventResponse(message, ok, result, error, options = {}) {
    const eventId = String(message.payload?.eventId || message.id || '')
    const fingerprint = options.fingerprint || channelFingerprint(
      message.payload?.protocol,
      message.payload?.name,
      message.payload?.data,
    )
    let response = createEnvelope('channel.event.response', {
      protocol: MOSS_CHANNEL_PROTOCOL,
      eventId,
      ok,
      ...(ok ? { result } : { error: serializeError(error, APP_ERROR_CODES.channelUnavailable) }),
      ...this.identity(),
    }, { id: eventId })
    try {
      validateEnvelope(response, { allowedTypes: ['channel.event.response'] })
    } catch (serializationError) {
      response = createEnvelope('channel.event.response', {
        protocol: MOSS_CHANNEL_PROTOCOL,
        eventId,
        ok: false,
        error: serializeError(serializationError, APP_ERROR_CODES.channelProtocol),
        ...this.identity(),
      }, { id: eventId })
    }
    if (options.cache !== false) {
      this.channelEventReplies.set(eventId, { fingerprint, response })
      if (this.channelEventReplies.size > MAX_CHANNEL_REPLY_CACHE_ENTRIES) {
        this.channelEventReplies.delete(this.channelEventReplies.keys().next().value)
      }
    }
    this.send(response)
  }

  start(actions = {}) {
    if (this.started) return this
    for (const [name, handler] of Object.entries(actions)) this.registerAction(name, handler)
    this.started = true
    this.onMessage((raw) => {
      void this.handleMessage(raw).catch((error) => this.handleFatalError(error))
    })
    this.onDisconnect(() => {
      this.closeChannel(new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'Channel Host disconnected'))
      setImmediate(() => process.exit(0))
    })
    this.send(createEnvelope('service.hello', {
      appId: process.env.MOSS_APP_ID,
      version: process.env.MOSS_APP_VERSION,
      apiVersion: 1,
      instanceId: process.env.MOSS_APP_INSTANCE_ID,
      generation: Number(process.env.MOSS_APP_GENERATION),
      launchToken: process.env.MOSS_APP_LAUNCH_TOKEN,
    }))
    return this
  }

  handleFatalError(error) {
    try {
      this.send(createEnvelope('service.status', {
        state: 'error',
        details: serializeError(error),
        ...this.identity(),
      }))
    } catch {}
    if (this.onFatalError) {
      try {
        Promise.resolve(this.onFatalError(error)).catch(() => {
          if (typeof process.send === 'function') setImmediate(() => process.exit(1))
        })
      } catch {
        if (typeof process.send === 'function') setImmediate(() => process.exit(1))
      }
    } else if (typeof process.send === 'function') {
      setImmediate(() => process.exit(1))
    }
  }

  async handleMessage(raw) {
    let message
    try {
      message = validateEnvelope(raw, { allowedTypes: HOST_MESSAGE_TYPES })
    } catch (error) {
      this.log('error', error.message)
      return
    }
    const payload = message.payload || {}
    if (message.type === 'service.init') {
      if (this.context) throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend was initialized more than once')
      this.context = Object.freeze({ ...payload, channel: this.channel })
      this.channelClosed = false
      if (this.onInitialize) await this.onInitialize(this.context)
      this.send(createEnvelope('service.ready', { ...this.identity() }, { id: message.id }))
      return
    }
    if (message.type === 'service.ping') {
      this.send(createEnvelope('service.pong', { ...this.identity() }, { id: message.id }))
      return
    }
    if (message.type === 'service.shutdown') {
      this.send(createEnvelope('service.status', { state: 'stopping', ...this.identity() }, { id: message.id }))
      this.closeChannel(new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'App Backend is shutting down'))
      if (this.onShutdown) await this.onShutdown(this.context)
      setImmediate(() => process.exit(0))
      return
    }
    if (message.type === 'channel.response') {
      if (!this.hasCurrentIdentity(payload)) {
        this.log('warn', 'Rejected stale Channel Host response')
        return
      }
      this.handleChannelResponse(message)
      return
    }
    if (message.type === 'channel.event.cancel') {
      if (!this.hasCurrentIdentity(payload)) {
        this.log('warn', 'Rejected stale Channel event cancellation')
        return
      }
      try { validateChannelProtocol(payload.protocol) } catch (error) {
        this.log('error', error.message)
        return
      }
      const eventId = String(payload.eventId || '')
      const active = this.channelEvents.get(eventId)
      if (active) {
        active.canceled = true
        active.controller.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Channel event canceled by Host'))
      }
      return
    }
    if (message.type === 'channel.event') {
      if (!this.hasCurrentIdentity(payload)) {
        this.log('warn', 'Rejected stale Channel event')
        return
      }
      await this.handleChannelEvent(message)
      return
    }
    if (message.type === 'action.cancel') {
      this.controllers.get(payload.requestId)?.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Action canceled'))
      return
    }
    if (message.type !== 'action.invoke') return

    const handler = this.actions.get(payload.name)
    if (!handler) {
      this.send(createEnvelope('action.error', {
        requestId: message.id,
        error: serializeError(new AppServiceError(APP_ERROR_CODES.actionNotFound, `Unknown action: ${payload.name}`)),
        ...this.identity(),
      }, { id: message.id }))
      return
    }
    const controller = new AbortController()
    this.controllers.set(message.id, controller)
    try {
      const result = await handler(payload.input, {
        ...this.context,
        channel: this.channel,
        signal: controller.signal,
        requestId: message.id,
        emit: (name, data) => this.emit(name, data),
        log: (level, text, details) => this.log(level, text, details),
      })
      this.send(createEnvelope('action.result', { requestId: message.id, result, ...this.identity() }, { id: message.id }))
    } catch (error) {
      this.send(createEnvelope('action.error', {
        requestId: message.id,
        error: serializeError(error),
        ...this.identity(),
      }, { id: message.id }))
    } finally {
      this.controllers.delete(message.id)
    }
  }
}

export function defineAppBackend(actions, options = {}) {
  return new AppBackendClient(options).start(actions)
}

export { BACKEND_MESSAGE_TYPES }
