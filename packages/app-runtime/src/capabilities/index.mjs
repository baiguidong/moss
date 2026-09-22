import {
  APP_ERROR_CODES,
  AppServiceError,
  requireHostPermission,
  requireHostProtocol,
  validateHostData,
  validateHostMember,
  validateHostProtocol,
} from '../../../app-sdk/src/index.mjs'

function cancellationError(signal) {
  return signal.reason || new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Host request canceled')
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

function normalizePermission(value, label) {
  if (value === undefined || value === null || value === '') return null
  const permission = typeof value === 'string' ? value.trim() : ''
  if (!permission || permission.length > 160 || !/^[a-z][a-z0-9:._-]*$/.test(permission)) {
    throw new TypeError(`${label} permission is invalid`)
  }
  return permission
}

function normalizeMemberDefinitions(value, kind, protocol) {
  if (value === undefined) return new Map()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${protocol} ${kind} definitions must be an object`)
  }
  const definitions = new Map()
  for (const [rawName, rawDefinition] of Object.entries(value)) {
    const name = validateHostMember(rawName, `${protocol} ${kind}`)
    const definition = rawDefinition === undefined || rawDefinition === null ? {} : rawDefinition
    if (typeof definition !== 'object' || Array.isArray(definition)) {
      throw new TypeError(`${protocol} ${kind} definition must be an object: ${name}`)
    }
    if (definition.validateInput !== undefined && typeof definition.validateInput !== 'function') {
      throw new TypeError(`${protocol} ${kind} validateInput must be a function: ${name}`)
    }
    if (definition.validateOutput !== undefined && typeof definition.validateOutput !== 'function') {
      throw new TypeError(`${protocol} ${kind} validateOutput must be a function: ${name}`)
    }
    definitions.set(name, Object.freeze({
      permission: normalizePermission(definition.permission, `${protocol} ${kind} ${name}`),
      validateInput: definition.validateInput || ((input) => validateHostData(input, `${name} input`)),
      validateOutput: definition.validateOutput || null,
    }))
  }
  return definitions
}

function normalizeErrorCodes(value = {}) {
  return Object.freeze({
    unavailable: value.unavailable || APP_ERROR_CODES.hostUnavailable,
    protocol: value.protocol || APP_ERROR_CODES.hostProtocol,
  })
}

function normalizeProtocolDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Host protocol definition must be an object')
  }
  const protocol = validateHostProtocol(raw.protocol)
  const methods = normalizeMemberDefinitions(raw.methods, 'method', protocol)
  const events = normalizeMemberDefinitions(raw.events, 'event', protocol)
  if (methods.size === 0 && events.size === 0) {
    throw new TypeError(`Host protocol must define at least one method or event: ${protocol}`)
  }
  if (raw.handleRequest !== undefined && typeof raw.handleRequest !== 'function') {
    throw new TypeError(`${protocol} handleRequest must be a function`)
  }
  return Object.freeze({
    protocol,
    methods,
    events,
    handleRequest: raw.handleRequest || null,
    errorCodes: normalizeErrorCodes(raw.errorCodes),
  })
}

function unavailable(definition, message) {
  return new AppServiceError(definition?.errorCodes.unavailable || APP_ERROR_CODES.hostUnavailable, message)
}

function protocolError(definition, message) {
  return new AppServiceError(definition?.errorCodes.protocol || APP_ERROR_CODES.hostProtocol, message)
}

export class AppHostCapabilityRegistry {
  constructor(options = {}) {
    this.protocols = new Map()
    this.handlers = new Map()
    this.activeByInstance = new Map()
    this.activeTotal = 0
    this.maxConcurrentPerInstance = Math.max(1, Number(options.maxConcurrentPerInstance) || 32)
    this.maxConcurrentTotal = Math.max(1, Number(options.maxConcurrentTotal) || 512)
    this.authorize = typeof options.authorize === 'function' ? options.authorize : null
    for (const definition of options.protocols || []) this.registerProtocol(definition)
  }

  registerProtocol(rawDefinition) {
    const definition = normalizeProtocolDefinition(rawDefinition)
    if (this.protocols.has(definition.protocol)) {
      throw new TypeError(`Host protocol is already registered: ${definition.protocol}`)
    }
    this.protocols.set(definition.protocol, definition)
    return () => {
      if (this.protocols.get(definition.protocol) !== definition) return
      this.protocols.delete(definition.protocol)
      this.handlers.delete(definition.protocol)
    }
  }

  registerHandler(protocol, method, handler) {
    const { definition, member, name } = this.requireMember(protocol, method, 'method')
    if (typeof handler !== 'function') throw new TypeError('Host protocol handler must be a function')
    let handlers = this.handlers.get(definition.protocol)
    if (!handlers) {
      handlers = new Map()
      this.handlers.set(definition.protocol, handlers)
    }
    if (handlers.has(name)) {
      throw new TypeError(`Host protocol handler is already registered: ${definition.protocol} ${name}`)
    }
    handlers.set(name, handler)
    return () => {
      if (handlers.get(name) === handler) handlers.delete(name)
      if (handlers.size === 0 && this.handlers.get(definition.protocol) === handlers) {
        this.handlers.delete(definition.protocol)
      }
    }
  }

  listProtocols() {
    return [...this.protocols.keys()]
  }

  listMethods(protocol) {
    const normalized = validateHostProtocol(protocol)
    return [...(this.protocols.get(normalized)?.methods.keys() || [])]
  }

  requireMember(protocol, rawName, kind) {
    const normalizedProtocol = validateHostProtocol(protocol)
    const definition = this.protocols.get(normalizedProtocol)
    if (!definition) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, `Host protocol is unavailable: ${normalizedProtocol}`)
    const name = validateHostMember(rawName, `${normalizedProtocol} ${kind}`)
    const members = kind === 'event' ? definition.events : definition.methods
    const member = members.get(name)
    if (!member) throw protocolError(definition, `Unknown ${normalizedProtocol} ${kind}: ${name}`)
    return { definition, member, name }
  }

  authorizeMember(request, definition, member, name, kind) {
    try {
      requireHostProtocol(request.protocols, definition.protocol)
    } catch (error) {
      if (error?.code === APP_ERROR_CODES.hostUnavailable) {
        throw unavailable(definition, `App Backend does not declare protocol: ${definition.protocol}`)
      }
      throw error
    }
    if (member.permission) {
      requireHostPermission(request.permissions, member.permission)
      requireHostPermission(request.grants ?? request.permissions, member.permission, { source: 'grant' })
    }
    const authorization = Object.freeze({
      protocol: definition.protocol,
      kind,
      name,
      permission: member.permission,
    })
    if (this.authorize) this.authorize(request, authorization)
    return authorization
  }

  prepareEvent(request) {
    const { definition, member, name } = this.requireMember(request.protocol, request.name, 'event')
    const authorization = this.authorizeMember(request, definition, member, name, 'event')
    const data = member.validateInput(request.data)
    return Object.freeze({
      protocol: definition.protocol,
      name,
      data,
      permission: authorization.permission,
      validateOutput: member.validateOutput,
    })
  }

  async dispatch(request) {
    const { definition, member, name } = this.requireMember(request.protocol, request.method, 'method')
    const authorization = this.authorizeMember(request, definition, member, name, 'method')
    const input = member.validateInput(request.input)
    if (request.signal?.aborted) throw cancellationError(request.signal)

    const principal = request.principal || request.owner || null
    const principalKey = principal?.key || [
      principal?.scope || 'host',
      principal?.orgId || '',
      principal?.userId || '',
    ].join(':')
    const key = `${principalKey}:${request.appId}:${request.instanceId}`
    const activeForInstance = this.activeByInstance.get(key) || 0
    if (activeForInstance >= this.maxConcurrentPerInstance || this.activeTotal >= this.maxConcurrentTotal) {
      throw unavailable(definition, 'Host protocol concurrency limit reached')
    }
    const handler = this.handlers.get(definition.protocol)?.get(name) || definition.handleRequest
    if (!handler) {
      throw unavailable(definition, `Host protocol method is unavailable: ${definition.protocol} ${name}`)
    }

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
      principal: request.principal || null,
      dataDir: request.dataDir || null,
      runtimeDir: request.runtimeDir || null,
      requestId: request.requestId,
      protocol: definition.protocol,
      method: name,
      permission: authorization.permission,
      signal: request.signal,
    })
    const operation = Promise.resolve().then(() => {
      if (request.signal?.aborted) throw cancellationError(request.signal)
      return handler(input, context)
    }).then((result) => member.validateOutput ? member.validateOutput(result) : result).finally(release)
    const canceled = cancellation(request.signal)
    try {
      return await (canceled ? Promise.race([operation, canceled.promise]) : operation)
    } finally {
      canceled?.dispose()
    }
  }
}
