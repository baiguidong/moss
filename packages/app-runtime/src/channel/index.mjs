import {
  APP_ERROR_CODES,
  AppServiceError,
  MOSS_CHANNEL_PROTOCOL,
  getChannelHostMethodPermission,
  requireChannelPermission,
  validateChannelHostMethod,
  validateChannelHostInput,
  validateChannelProtocol,
} from '../../../app-sdk/src/index.mjs'

function channelKey(request) {
  return `${request.appId}:${request.instanceId}`
}

function cancellationError(signal) {
  return signal.reason || new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Channel Host request canceled')
}

function cancellation(signal) {
  if (!signal) return null
  let rejectCancellation
  const onAbort = () => rejectCancellation(cancellationError(signal))
  const promise = new Promise((_, reject) => { rejectCancellation = reject })
  signal.addEventListener('abort', onAbort, { once: true })
  return {
    promise,
    dispose: () => signal.removeEventListener('abort', onAbort),
  }
}

export class AppChannelHost {
  constructor(options = {}) {
    this.handlers = new Map()
    this.fallback = typeof options.handleRequest === 'function' ? options.handleRequest : null
    this.activeByInstance = new Map()
    this.activeTotal = 0
    this.maxConcurrentPerInstance = Math.max(1, Number(options.maxConcurrentPerInstance) || 32)
    this.maxConcurrentTotal = Math.max(1, Number(options.maxConcurrentTotal) || 512)
    for (const [method, handler] of Object.entries(options.handlers || {})) {
      this.register(method, handler)
    }
  }

  register(method, handler) {
    const normalized = validateChannelHostMethod(method)
    if (typeof handler !== 'function') throw new TypeError('Channel Host handler must be a function')
    if (this.handlers.has(normalized)) {
      throw new TypeError(`Channel Host handler is already registered: ${normalized}`)
    }
    this.handlers.set(normalized, handler)
    return () => {
      if (this.handlers.get(normalized) === handler) this.handlers.delete(normalized)
    }
  }

  listMethods() {
    return [...this.handlers.keys()]
  }

  async dispatch(request) {
    const protocol = validateChannelProtocol(request.protocol)
    const method = validateChannelHostMethod(request.method)
    const input = validateChannelHostInput(method, request.input)
    if (!Array.isArray(request.protocols) || !request.protocols.includes(MOSS_CHANNEL_PROTOCOL)) {
      throw new AppServiceError(
        APP_ERROR_CODES.channelUnavailable,
        `App Backend does not declare protocol: ${MOSS_CHANNEL_PROTOCOL}`,
      )
    }
    const permission = getChannelHostMethodPermission(method)
    requireChannelPermission(request.permissions, permission)

    const key = channelKey(request)
    const activeForInstance = this.activeByInstance.get(key) || 0
    if (
      activeForInstance >= this.maxConcurrentPerInstance
      || this.activeTotal >= this.maxConcurrentTotal
    ) {
      throw new AppServiceError(APP_ERROR_CODES.channelUnavailable, 'Channel Host concurrency limit reached')
    }
    const handler = this.handlers.get(method) || this.fallback
    if (!handler) {
      throw new AppServiceError(
        APP_ERROR_CODES.channelUnavailable,
        `Channel Host method is unavailable: ${method}`,
      )
    }
    if (request.signal?.aborted) throw cancellationError(request.signal)

    this.activeByInstance.set(key, activeForInstance + 1)
    this.activeTotal += 1
    let released = false
    const release = () => {
      if (released) return
      released = true
      const next = (this.activeByInstance.get(key) || 1) - 1
      if (next <= 0) this.activeByInstance.delete(key)
      else this.activeByInstance.set(key, next)
      this.activeTotal = Math.max(0, this.activeTotal - 1)
    }
    const context = Object.freeze({
      appId: request.appId,
      version: request.version,
      instanceId: request.instanceId,
      generation: request.generation,
      target: request.target,
      requestId: request.requestId,
      protocol,
      method,
      permission,
      signal: request.signal,
    })
    const operation = Promise.resolve().then(() => {
      if (request.signal?.aborted) throw cancellationError(request.signal)
      return handler(input, context)
    }).finally(release)
    const canceled = cancellation(request.signal)
    try {
      return await (canceled ? Promise.race([operation, canceled.promise]) : operation)
    } finally {
      canceled?.dispose()
    }
  }
}
