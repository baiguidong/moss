import {
  APP_ERROR_CODES,
  AppServiceError,
  BACKEND_MESSAGE_TYPES,
  createEnvelope,
  serializeError,
  validateEnvelope,
} from '../protocol/index.mjs'

export class AppBackendClient {
  constructor(options = {}) {
    this.actions = new Map()
    this.controllers = new Map()
    this.context = null
    this.started = false
    this.onInitialize = options.onInitialize || null
    this.onShutdown = options.onShutdown || null
    this.onFatalError = options.onFatalError || null
    this.send = options.send || ((message) => process.send?.(message))
    this.onMessage = options.onMessage || ((handler) => process.on('message', handler))
  }

  registerAction(name, handler) {
    if (!name || typeof handler !== 'function') throw new TypeError('registerAction requires a name and handler')
    this.actions.set(name, handler)
    return this
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

  start(actions = {}) {
    if (this.started) return this
    for (const [name, handler] of Object.entries(actions)) this.registerAction(name, handler)
    this.started = true
    this.onMessage((raw) => {
      void this.handleMessage(raw).catch((error) => this.handleFatalError(error))
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
      message = validateEnvelope(raw, { allowedTypes: ['service.init', 'action.invoke', 'action.cancel', 'service.ping', 'service.shutdown'] })
    } catch (error) {
      this.log('error', error.message)
      return
    }
    const payload = message.payload || {}
    if (message.type === 'service.init') {
      if (this.context) throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'App Backend was initialized more than once')
      this.context = Object.freeze({ ...payload })
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
      if (this.onShutdown) await this.onShutdown(this.context)
      setImmediate(() => process.exit(0))
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
