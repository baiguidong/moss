import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import {
  APP_ERROR_CODES,
  AppServiceError,
  loadJsonSchema,
  validateHostMember,
  validateHostProtocol,
} from '../../../app-sdk/src/index.mjs'
import { defaultInstanceId, validateConfiguration } from '../state/index.mjs'

export const APP_CAPABILITIES_PROTOCOL = 'moss.app-capabilities/v1'
const RESOURCE_REF_TTL_MS = 15 * 60_000
const RESOURCE_CHUNK_LIMIT = 100_000
const TOOL_REF_TTL_MS = 15 * 60_000
const TOOL_ARGUMENT_LIMIT_BYTES = 256 * 1024
const TOOL_RESULT_LIMIT_BYTES = 768 * 1024
const TOOL_SCHEMA_LIMIT_BYTES = 64 * 1024
const TOOL_LIST_LIMIT_BYTES = 512 * 1024
const TOOL_LIST_PAGE_LIMIT = 100
const ERROR_CODES = new Set(Object.values(APP_ERROR_CODES))
const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/
const INSTANCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/
const TOOL_NAME_PATTERN = /^[^\x00-\x1f\x7f*?]{1,256}$/

function grantedMethods(provider, grants) {
  const allowed = new Set(grants)
  return provider.methods.filter(method => allowed.has(method.permission)
    && (!method.resourceReadMethod || provider.methods.some(reader =>
      reader.name === method.resourceReadMethod && allowed.has(reader.permission))))
}

function sameMethod(first, second) {
  return first.action === second.action && first.permission === second.permission
    && first.resourceReadMethod === second.resourceReadMethod
}

function hasIncarnation(record) {
  return typeof record?.incarnationId === 'string' && record.incarnationId.length >= 16
}

function outcomeCode(error) {
  return ERROR_CODES.has(error?.code) ? error.code : 'error'
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} must be an object`)
  }
  return value
}

function listInput(value) {
  const input = object(value, 'Provider discovery input')
  if (Object.keys(input).some(key => key !== 'protocol')) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Unknown provider discovery field')
  return input.protocol === undefined ? {} : { protocol: validateHostProtocol(input.protocol) }
}

function invokeInput(value) {
  const input = object(value, 'Provider invocation input')
  if (Object.keys(input).some(key => !['providerRef', 'method', 'input'].includes(key))
    || typeof input.providerRef !== 'string' || input.providerRef.length > 4096) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid provider reference')
  }
  return { providerRef: input.providerRef, method: validateHostMember(input.method), input: object(input.input ?? {}, 'Provider method input') }
}

function readInput(value) {
  const input = object(value, 'Resource read input')
  if (Object.keys(input).some(key => !['resourceRef', 'offset', 'limit'].includes(key))
    || typeof input.resourceRef !== 'string' || input.resourceRef.length > 4096
    || !Number.isSafeInteger(input.offset) || input.offset < 0
    || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > RESOURCE_CHUNK_LIMIT
    || input.offset + input.limit > Number.MAX_SAFE_INTEGER) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid resource read range')
  }
  return input
}

function toolListInput(value) {
  const input = object(value, 'Tool discovery input')
  if (Object.keys(input).some(key => !['appId', 'instanceId', 'serviceId', 'offset', 'limit'].includes(key))
    || typeof input.appId !== 'string' || !APP_ID_PATTERN.test(input.appId)
    || (input.instanceId !== undefined && (typeof input.instanceId !== 'string'
      || input.instanceId.length > 160 || !INSTANCE_ID_PATTERN.test(input.instanceId)))
    || (input.serviceId !== undefined && (typeof input.serviceId !== 'string'
      || input.serviceId.length > 256 || !TOOL_NAME_PATTERN.test(input.serviceId)))
    || (input.offset !== undefined && (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 10_000))
    || (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > TOOL_LIST_PAGE_LIMIT))) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid cross-App tool discovery input')
  }
  return { appId: input.appId, instanceId: input.instanceId, serviceId: input.serviceId,
    offset: input.offset ?? 0, limit: input.limit ?? 50 }
}

function jsonBytes(value, label) {
  let serialized
  try { serialized = JSON.stringify(value) } catch {}
  if (typeof serialized !== 'string') throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} must be JSON serializable`)
  return Buffer.byteLength(serialized)
}

function toolInvokeInput(value) {
  const input = object(value, 'Tool invocation input')
  if (Object.keys(input).some(key => !['toolRef', 'arguments'].includes(key))
    || typeof input.toolRef !== 'string' || !input.toolRef || input.toolRef.length > 4096) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid cross-App tool reference')
  }
  const args = object(input.arguments ?? {}, 'Tool arguments')
  if (jsonBytes(args, 'Tool arguments') > TOOL_ARGUMENT_LIMIT_BYTES) {
    throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Cross-App tool arguments exceed the size limit')
  }
  return { toolRef: input.toolRef, arguments: args }
}

function validToolName(value) {
  return typeof value === 'string' && value === value.trim() && TOOL_NAME_PATTERN.test(value)
}

function boundedToolResult(value) {
  let serialized
  try { serialized = JSON.stringify(value) } catch {}
  if (typeof serialized !== 'string') {
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Target tool returned an invalid JSON result')
  }
  if (Buffer.byteLength(serialized) > TOOL_RESULT_LIMIT_BYTES) {
    throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Cross-App tool result exceeds the size limit')
  }
  return value
}

function tokenDigest(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest()
}

function unavailable(message, reason) {
  return new AppServiceError(APP_ERROR_CODES.hostUnavailable, message, { reason })
}

export class AppCapabilityBroker {
  constructor(runtime) {
    this.runtime = runtime
    this.secretPath = path.join(runtime.rootDir, 'app-capability-key')
    this.secret = null
    this.toolBridge = null
  }

  setToolBridge(bridge) {
    if (bridge !== null && (typeof bridge?.discoverBridgeTools !== 'function'
      || typeof bridge?.invokeBridgeTool !== 'function')) {
      throw new TypeError('App tool bridge must implement discoverBridgeTools and invokeBridgeTool')
    }
    this.toolBridge = bridge
  }

  async initialize() {
    await fsp.mkdir(this.runtime.rootDir, { recursive: true })
    try {
      await fsp.writeFile(this.secretPath, randomBytes(32), { mode: 0o600, flag: 'wx' })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    this.secret = await fsp.readFile(this.secretPath)
    if (this.secret.length !== 32) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'App capability key is invalid')
  }

  definition() {
    return {
      protocol: APP_CAPABILITIES_PROTOCOL,
      methods: {
        'providers.list': { permission: 'apps:invoke', surfaces: ['backend', 'ui'], validateInput: listInput,
          validateOutput: value => object(value, 'Provider discovery result') },
        'provider.invoke': { permission: 'apps:invoke', surfaces: ['backend', 'ui'], validateInput: invokeInput,
          validateOutput: value => object(value, 'Provider invocation result') },
        'resource.read': { permission: 'apps:invoke', surfaces: ['backend', 'ui'], validateInput: readInput,
          validateOutput: value => object(value, 'Resource read result') },
        'tools.list': { permission: 'apps:invoke', surfaces: ['backend', 'ui'], validateInput: toolListInput,
          validateOutput: value => object(value, 'Tool discovery result') },
        'tool.invoke': { permission: 'apps:invoke', surfaces: ['backend', 'ui'], validateInput: toolInvokeInput,
          validateOutput: value => object(value, 'Tool invocation result') },
      },
    }
  }

  sign(binding) {
    if (!this.secret) throw unavailable('App capability broker is not initialized', 'host_unavailable')
    const payload = Buffer.from(JSON.stringify(binding)).toString('base64url')
    return `${payload}.${tokenDigest(this.secret, payload).toString('base64url')}`
  }

  verify(ref, context, kind = 'provider') {
    const label = kind === 'tool' ? 'Tool' : kind === 'resource' ? 'Resource' : 'Provider'
    if (!this.secret || typeof ref !== 'string' || ref.length > 4096) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid ${label.toLowerCase()} reference`)
    const [payload, signature, extra] = ref.split('.')
    if (!payload || !signature || extra) throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid ${label.toLowerCase()} reference`)
    let actual, binding
    try {
      actual = Buffer.from(signature, 'base64url')
      binding = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    } catch { throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid ${label.toLowerCase()} reference`) }
    const expected = tokenDigest(this.secret, payload)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)
      || binding?.v !== 2 || binding.kind !== kind || binding.owner !== context.owner?.key
      || binding.consumerAppId !== context.appId || binding.consumerInstanceId !== context.instanceId) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, `${label} reference is outside the caller scope`)
    }
    const consumerInstallation = this.runtime.installations.get(context.appId)
    const consumerInstance = this.runtime.instances.get(context.instanceId)
    if (!hasIncarnation(consumerInstallation) || !hasIncarnation(consumerInstance)
      || consumerInstallation.incarnationId !== binding.consumerInstallationIncarnationId
      || consumerInstance.incarnationId !== binding.consumerInstanceIncarnationId
      || consumerInstallation.createdAt !== binding.consumerInstallationCreatedAt
      || consumerInstance.createdAt !== binding.consumerInstanceCreatedAt) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, `${label} reference belongs to a previous App installation`)
    }
    return binding
  }

  async consumer(context, protocol) {
    context.assertCurrent()
    const pkg = await this.runtime.getActivePackage(context.appId)
    const requires = pkg.manifest.appCapabilities?.requires || []
    if (protocol && !requires.some(item => item.protocol === protocol)) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, `App does not declare required capability: ${protocol}`)
    }
    context.assertCurrent()
    return requires
  }

  declaredTools(pkg, targetAppId, toolName) {
    const manifest = pkg?.manifest
    const target = manifest?.appCapabilities?.usesTools?.find(item => item.appId === targetAppId)
    if (!manifest?.host?.protocols?.includes(APP_CAPABILITIES_PROTOCOL)
      || !manifest.permissions?.includes('apps:invoke') || !target
      || (toolName !== undefined && !target.tools.includes(toolName))) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'App does not declare this cross-App tool dependency')
    }
    return target
  }

  async toolConsumer(context, targetAppId, toolName) {
    context.assertCurrent()
    if (targetAppId === context.appId) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'An App cannot invoke its own tools through the capability broker')
    }
    const pkg = await this.runtime.getActivePackage(context.appId)
    const declaration = this.declaredTools(pkg, targetAppId, toolName)
    const installation = this.runtime.installations.get(context.appId)
    if (!installation?.enabled || installation.activeVersion !== pkg.manifest.version
      || !installation.grants?.includes('apps:invoke')) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Cross-App tool access was revoked')
    }
    context.assertCurrent()
    return { pkg, declaration, installation }
  }

  assertToolConsumerCurrent(context, pkg, targetAppId, toolName) {
    context.assertCurrent()
    this.declaredTools(pkg, targetAppId, toolName)
    const installation = this.runtime.installations.get(context.appId)
    if (!installation?.enabled || installation.activeVersion !== pkg.manifest.version
      || !installation.grants?.includes('apps:invoke')) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Cross-App tool access was revoked')
    }
  }

  async toolTarget(appId, requestedInstanceId) {
    const instanceId = requestedInstanceId || defaultInstanceId(appId)
    const installation = this.runtime.installations.get(appId)
    if (!hasIncarnation(installation) || !installation.activeVersion) throw unavailable('Target App is unavailable', 'not_installed')
    if (!installation.enabled) throw unavailable('Target App is disabled', 'disabled')
    const instance = this.runtime.instances.get(instanceId)
    if (!hasIncarnation(instance) || instance.appId !== appId) throw unavailable('Target App instance is unavailable', 'instance_missing')
    if (!instance.enabled) throw unavailable('Target App instance is disabled', 'instance_disabled')
    let pkg
    try { pkg = await this.runtime.getActivePackage(appId) }
    catch {
      const currentInstallation = this.runtime.installations.get(appId)
      if (!hasIncarnation(currentInstallation) || currentInstallation.incarnationId !== installation.incarnationId
        || currentInstallation.createdAt !== installation.createdAt) throw unavailable('Target App is unavailable', 'not_installed')
      if (!currentInstallation.enabled) throw unavailable('Target App is disabled', 'disabled')
      const currentInstance = this.runtime.instances.get(instanceId)
      if (!hasIncarnation(currentInstance) || currentInstance.incarnationId !== instance.incarnationId
        || currentInstance.createdAt !== instance.createdAt || currentInstance.appId !== appId) {
        throw unavailable('Target App instance is unavailable', 'instance_missing')
      }
      if (!currentInstance.enabled) throw unavailable('Target App instance is disabled', 'instance_disabled')
      throw unavailable('Target App package is unavailable', 'backend_unavailable')
    }
    const currentInstallation = this.runtime.installations.get(appId)
    const currentInstance = this.runtime.instances.get(instanceId)
    if (!hasIncarnation(currentInstallation) || currentInstallation.incarnationId !== installation.incarnationId
      || currentInstallation.createdAt !== installation.createdAt) throw unavailable('Target App is unavailable', 'not_installed')
    if (!currentInstallation.enabled) throw unavailable('Target App is disabled', 'disabled')
    if (!hasIncarnation(currentInstance) || currentInstance.incarnationId !== instance.incarnationId
      || currentInstance.createdAt !== instance.createdAt || currentInstance.appId !== appId) {
      throw unavailable('Target App instance is unavailable', 'instance_missing')
    }
    if (!currentInstance.enabled) throw unavailable('Target App instance is disabled', 'instance_disabled')
    if (currentInstallation.activeVersion !== pkg.manifest.version) throw unavailable('Target App version changed', 'incompatible_version')
    return { installation: currentInstallation, instance: currentInstance, pkg }
  }

  assertToolTargetCurrent(binding, pkg) {
    const installation = this.runtime.installations.get(binding.providerAppId)
    if (!hasIncarnation(installation) || installation.incarnationId !== binding.providerInstallationIncarnationId
      || installation.createdAt !== binding.installationCreatedAt) throw unavailable('Target App is unavailable', 'not_installed')
    if (!installation.enabled) throw unavailable('Target App is disabled', 'disabled')
    const instance = this.runtime.instances.get(binding.providerInstanceId)
    if (!hasIncarnation(instance) || instance.incarnationId !== binding.providerInstanceIncarnationId
      || instance.createdAt !== binding.instanceCreatedAt || instance.appId !== binding.providerAppId) {
      throw unavailable('Target App instance is unavailable', 'instance_missing')
    }
    if (!instance.enabled) throw unavailable('Target App instance is disabled', 'instance_disabled')
    if (installation.activeVersion !== pkg.manifest.version || installation.activeVersion !== binding.providerVersion) {
      throw unavailable('Target App version changed', 'incompatible_version')
    }
    if ((pkg.manifest.publisher?.id || null) !== binding.publisherId) throw unavailable('Target App publisher changed', 'publisher_changed')
    const required = binding.source === 'mcp' ? ['mcp:manage', 'mcp:connect'] : binding.permission ? [binding.permission] : []
    if (required.some(permission => !installation.grants?.includes(permission))) {
      throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Target App tool permission was revoked')
    }
    return { installation, instance }
  }

  staticToolDetails(item, pkg) {
    if (!item || item.execution === 'native') throw unavailable('Target tool is unavailable', 'incompatible_version')
    const inputSchema = item.inputSchemaDocument || loadJsonSchema(pkg.root, item.inputSchema, `tool ${item.id} inputSchema`)
    if (jsonBytes(inputSchema, 'Tool schema') > TOOL_SCHEMA_LIMIT_BYTES) {
      throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Cross-App tool schema exceeds the size limit')
    }
    const revision = createHash('sha256').update(JSON.stringify({
      appId: item.appId, id: item.id, serviceId: item.serviceId || null, action: item.action || null,
      host: item.host || null, execution: item.execution || 'backend', permission: item.permission || null,
      effect: item.effect, title: item.title, description: item.description, inputSchema,
      outputSchema: item.outputSchema || null, instructions: item.instructions || null,
    })).digest('hex')
    return { source: 'contribution', serviceId: item.serviceId || null, serviceName: null,
      name: item.localId || item.id.split('/').at(-1),
      description: item.description.slice(0, 1500), effect: item.effect, inputSchema, revision,
      permission: item.permission || null, contributionId: item.id }
  }

  currentStaticTool(binding, pkg) {
    const current = pkg.manifest.contributes?.tools?.find(item => item.id === binding.toolName)
    if (!current || current.execution === 'native') throw unavailable('Target tool is unavailable', 'incompatible_version')
    const item = { ...current, id: `${binding.providerAppId}/${current.id}`,
      localId: current.id, appId: binding.providerAppId }
    const details = this.staticToolDetails(item, pkg)
    if (details.revision !== binding.revision || details.contributionId !== binding.contributionId
      || details.serviceId !== binding.serviceId || details.permission !== binding.permission) {
      throw unavailable('Target tool changed', 'incompatible_version')
    }
    return details
  }

  toolBinding(context, consumer, target, item) {
    const consumerInstance = this.runtime.instances.get(context.instanceId)
    if (!hasIncarnation(consumer.installation) || !hasIncarnation(consumerInstance)) {
      throw unavailable('Consumer identity is unavailable', 'host_unavailable')
    }
    return {
      v: 2, kind: 'tool', owner: context.owner.key,
      consumerAppId: context.appId, consumerInstanceId: context.instanceId,
      consumerInstallationIncarnationId: consumer.installation.incarnationId,
      consumerInstanceIncarnationId: consumerInstance.incarnationId,
      consumerInstallationCreatedAt: consumer.installation.createdAt,
      consumerInstanceCreatedAt: consumerInstance.createdAt,
      providerAppId: target.installation.appId, providerInstanceId: target.instance.id,
      providerInstallationIncarnationId: target.installation.incarnationId,
      providerInstanceIncarnationId: target.instance.incarnationId,
      installationCreatedAt: target.installation.createdAt, instanceCreatedAt: target.instance.createdAt,
      providerVersion: target.pkg.manifest.version, publisherId: target.pkg.manifest.publisher?.id || null,
      protocol: APP_CAPABILITIES_PROTOCOL,
      source: item.source, serviceId: item.serviceId, toolName: item.name, revision: item.revision,
      permission: item.permission || null, contributionId: item.contributionId || null,
      expiresAt: Date.now() + TOOL_REF_TTL_MS,
    }
  }

  assertToolDispatchCurrent(binding, consumerPkg, providerPkg, context) {
    this.assertToolConsumerCurrent(context, consumerPkg, binding.providerAppId, binding.toolName)
    this.assertToolTargetCurrent(binding, providerPkg)
    if (!Number.isSafeInteger(binding.expiresAt) || binding.expiresAt < Date.now()) {
      throw unavailable('Tool reference expired', 'expired')
    }
    if (binding.source === 'contribution') this.currentStaticTool(binding, providerPkg)
  }

  async listTools(input, context) {
    const operation = () => this.listToolsScoped(input, context)
    return typeof this.runtime.withOwner === 'function'
      ? this.runtime.withOwner(context.owner, operation) : operation()
  }

  async listToolsScoped(input, context) {
    const startedAt = Date.now()
    const traceId = createHash('sha256').update(`${context.owner.key}:${context.appId}:${context.instanceId}:${context.requestId}`).digest('hex').slice(0, 32)
    const auditBinding = { providerAppId: input.appId, providerInstanceId: input.instanceId || null,
      protocol: APP_CAPABILITIES_PROTOCOL }
    let outcome = 'ok'
    try {
      input = toolListInput(input)
      const consumer = await this.toolConsumer(context, input.appId)
      const target = await this.toolTarget(input.appId, input.instanceId)
      const allowed = new Set(consumer.declaration.tools)
      const found = []
      const seen = new Set()
      const add = (item) => {
        if (!allowed.has(item.name)) return
        if (input.serviceId && item.serviceId !== input.serviceId) return
        const identity = JSON.stringify([item.source, item.serviceId, item.name])
        if (seen.has(identity)) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Target App returned duplicate tool identities')
        seen.add(identity)
        found.push(item)
      }
      if (!input.serviceId || !input.serviceId.startsWith('mcp/')) {
        const contributions = await this.runtime.listContributions({ appId: input.appId, kinds: ['tools'] })
        for (const item of contributions.tools || []) {
          if (item.execution === 'native' || !allowed.has(item.localId)) continue
          const details = this.staticToolDetails(item, target.pkg)
          add(details)
        }
      }
      if (this.toolBridge && (!input.serviceId || input.serviceId.startsWith('mcp/'))) {
        if (target.installation.grants?.includes('mcp:manage') && target.installation.grants?.includes('mcp:connect')) {
          const dynamic = await this.toolBridge.discoverBridgeTools({ targetAppId: input.appId,
            targetInstanceId: target.instance.id, serviceId: input.serviceId, toolNames: consumer.declaration.tools,
            signal: context.signal })
          if (!Array.isArray(dynamic)) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Target MCP tool catalog is invalid')
          for (const item of dynamic) {
            if (item?.appId !== input.appId || item.instanceId !== target.instance.id
              || typeof item.serviceId !== 'string' || !item.serviceId.startsWith('mcp/')
              || item.serviceId.length > 256 || !validToolName(item.name)
              || (item.serviceName !== undefined && (typeof item.serviceName !== 'string' || item.serviceName.length > 64))
              || !/^[a-f0-9]{64}$/.test(item.revision)
              || !item.inputSchema || typeof item.inputSchema !== 'object' || Array.isArray(item.inputSchema)) {
              throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Target MCP tool catalog is invalid')
            }
            if (jsonBytes(item.inputSchema, 'Tool schema') > TOOL_SCHEMA_LIMIT_BYTES) {
              throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Cross-App tool schema exceeds the size limit')
            }
            add({ source: 'mcp', serviceId: item.serviceId, serviceName: item.serviceName || null, name: item.name,
              description: String(item.description || '').slice(0, 1500), effect: 'unknown',
              inputSchema: item.inputSchema, revision: item.revision, permission: null, contributionId: null })
          }
        }
      }
      this.assertToolConsumerCurrent(context, consumer.pkg, input.appId)
      found.sort((left, right) => left.source.localeCompare(right.source)
        || String(left.serviceId || '').localeCompare(String(right.serviceId || ''))
        || left.name.localeCompare(right.name))
      const descriptions = found.map(item => {
        const binding = this.toolBinding(context, consumer, target, item)
        this.assertToolTargetCurrent(binding, target.pkg)
        return { appId: input.appId, appName: target.pkg.manifest.displayName,
          instanceId: target.instance.id, instanceName: target.instance.displayName,
          source: item.source, serviceId: item.serviceId, serviceName: item.serviceName, name: item.name,
          description: item.description, effect: item.effect, inputSchema: item.inputSchema,
          toolRef: this.sign(binding) }
      })
      const page = []
      for (const item of descriptions.slice(input.offset)) {
        if (page.length >= input.limit) break
        if (jsonBytes({ tools: [...page, item], nextOffset: null }, 'Tool catalog') > TOOL_LIST_LIMIT_BYTES) {
          if (!page.length) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Cross-App tool description exceeds the size limit')
          break
        }
        page.push(item)
      }
      context.assertCurrent()
      return { tools: page, nextOffset: input.offset + page.length < descriptions.length ? input.offset + page.length : null }
    } catch (error) { outcome = outcomeCode(error); throw error }
    finally { this.audit(context, auditBinding, traceId, 'tools.list', startedAt, outcome, 'Cross-App tool discovery') }
  }

  async invokeTool(input, context) {
    const operation = () => this.invokeToolScoped(input, context)
    return typeof this.runtime.withOwner === 'function'
      ? this.runtime.withOwner(context.owner, operation) : operation()
  }

  async invokeToolScoped(input, context) {
    const startedAt = Date.now()
    const traceId = createHash('sha256').update(`${context.owner.key}:${context.appId}:${context.instanceId}:${context.requestId}`).digest('hex').slice(0, 32)
    let binding
    let outcome = 'ok'
    try {
      input = toolInvokeInput(input)
      if (context.surface !== 'ui' && context.invocation?.surface === 'app') {
        throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Nested cross-App calls are not supported')
      }
      binding = this.verify(input.toolRef, context, 'tool')
      if (!APP_ID_PATTERN.test(binding.providerAppId) || !validToolName(binding.toolName)
        || !['mcp', 'contribution'].includes(binding.source)
        || typeof binding.providerInstanceId !== 'string' || binding.providerInstanceId.length > 160
        || typeof binding.revision !== 'string' || !/^[a-f0-9]{64}$/.test(binding.revision)
        || (binding.source === 'mcp' && (typeof binding.serviceId !== 'string' || !binding.serviceId.startsWith('mcp/')))
        || (binding.source === 'contribution' && binding.contributionId !== `${binding.providerAppId}/${binding.toolName}`)
        || !Number.isSafeInteger(binding.expiresAt) || binding.expiresAt < Date.now()) {
        throw unavailable('Tool reference is unavailable', 'expired')
      }
      const consumer = await this.toolConsumer(context, binding.providerAppId, binding.toolName)
      const target = await this.toolTarget(binding.providerAppId, binding.providerInstanceId)
      this.assertToolDispatchCurrent(binding, consumer.pkg, target.pkg, context)
      const authorizeDispatch = () => this.assertToolDispatchCurrent(binding, consumer.pkg, target.pkg, context)
      let result
      if (binding.source === 'mcp') {
        if (!this.toolBridge) throw unavailable('MCP tool bridge is unavailable', 'host_unavailable')
        result = await this.toolBridge.invokeBridgeTool({ targetAppId: binding.providerAppId,
          targetInstanceId: binding.providerInstanceId, serviceId: binding.serviceId,
          revision: binding.revision, toolName: binding.toolName, arguments: input.arguments,
          signal: context.signal, authorizeDispatch })
      } else {
        result = await this.runtime.invokeToolContribution(binding.contributionId, input.arguments, {
          instanceId: binding.providerInstanceId, signal: context.signal, requestId: traceId,
          principal: context.principal || context.owner, authorizeDispatch,
          invocation: { surface: 'app', callerAppId: context.appId, callerInstanceId: context.instanceId,
            protocol: APP_CAPABILITIES_PROTOCOL, method: binding.toolName, traceId,
            workspace: context.invocation?.workspace },
        })
      }
      authorizeDispatch()
      return { result: boundedToolResult(result), traceId }
    } catch (error) { outcome = outcomeCode(error); throw error }
    finally { this.audit(context, binding, traceId, binding?.toolName || 'tool.invoke', startedAt, outcome, 'Cross-App tool call') }
  }

  async providerStatus(appId, instance, installation, provider, pkg) {
    const statusOf = (currentInstallation, currentInstance) => {
      if (!hasIncarnation(currentInstallation) || !hasIncarnation(currentInstance)
        || currentInstallation.incarnationId !== installation.incarnationId
        || currentInstance.incarnationId !== instance.incarnationId
        || currentInstallation.activeVersion !== pkg.manifest.version) return 'backend_unavailable'
      if (!currentInstallation.enabled) return 'disabled'
      if (!currentInstance.enabled) return 'instance_disabled'
      if (!grantedMethods(provider, currentInstallation.grants).length) return 'permission_denied'
      return 'available'
    }
    let currentInstallation = this.runtime.installations.get(appId)
    let currentInstance = this.runtime.instances.get(instance.id)
    let status = statusOf(currentInstallation, currentInstance)
    if (status !== 'available') return { status, installation: currentInstallation, instance: currentInstance }
    let secrets
    try {
      secrets = await this.runtime.credentials.get(appId, instance.id)
    } catch {
      currentInstallation = this.runtime.installations.get(appId)
      currentInstance = this.runtime.instances.get(instance.id)
      status = statusOf(currentInstallation, currentInstance)
      return { status: status === 'available' ? 'configuration_required' : status,
        installation: currentInstallation, instance: currentInstance }
    }
    currentInstallation = this.runtime.installations.get(appId)
    currentInstance = this.runtime.instances.get(instance.id)
    status = statusOf(currentInstallation, currentInstance)
    if (status !== 'available') return { status, installation: currentInstallation, instance: currentInstance }
    try { validateConfiguration(pkg.root, pkg.manifest.backend, currentInstance.config || {}, secrets) }
    catch { return { status: 'configuration_required', installation: currentInstallation, instance: currentInstance } }
    const runtimeRecord = this.runtime.runtimeForInstance(appId, instance.id)
    if (!runtimeRecord) return { status: 'backend_unavailable', installation: currentInstallation, instance: currentInstance }
    if (this.runtime.supervisor.status(runtimeRecord.key).state === 'crash-loop') {
      return { status: 'crash_loop', installation: currentInstallation, instance: currentInstance }
    }
    return { status: 'available', installation: currentInstallation, instance: currentInstance }
  }

  async list(input, context) {
    const requires = await this.consumer(context, input.protocol)
    const consumerInstallation = this.runtime.installations.get(context.appId)
    const consumerInstance = this.runtime.instances.get(context.instanceId)
    if (!hasIncarnation(consumerInstallation) || !hasIncarnation(consumerInstance)) {
      throw unavailable('Consumer identity is unavailable', 'host_unavailable')
    }
    const protocols = input.protocol ? requires.filter(item => item.protocol === input.protocol) : requires
    const providers = []
    for (const installation of this.runtime.installations.list()) {
      if (!installation.activeVersion || installation.appId === context.appId) continue
      let pkg
      try { pkg = await this.runtime.getActivePackage(installation.appId) }
      catch { continue }
      for (const provider of pkg.manifest.appCapabilities?.provides || []) {
        if (!protocols.some(item => item.protocol === provider.protocol)) continue
        for (const instance of this.runtime.instances.list(installation.appId)) {
          const current = await this.providerStatus(installation.appId, instance, installation, provider, pkg)
          const { status } = current
          const availableMethods = current.installation
            ? grantedMethods(provider, current.installation.grants).map(method => method.name) : []
          providers.push({
            appId: installation.appId,
            appName: pkg.manifest.displayName,
            instanceId: instance.id,
            instanceName: instance.displayName,
            protocol: provider.protocol,
            status,
            methods: availableMethods,
            providerRef: status === 'available' ? this.sign({
              v: 2, kind: 'provider', owner: context.owner.key,
              consumerAppId: context.appId, consumerInstanceId: context.instanceId,
              consumerInstallationIncarnationId: consumerInstallation.incarnationId,
              consumerInstanceIncarnationId: consumerInstance.incarnationId,
              consumerInstallationCreatedAt: consumerInstallation.createdAt, consumerInstanceCreatedAt: consumerInstance.createdAt,
              providerAppId: installation.appId, providerInstanceId: instance.id,
              providerInstallationIncarnationId: current.installation.incarnationId,
              providerInstanceIncarnationId: current.instance.incarnationId,
              installationCreatedAt: current.installation.createdAt, instanceCreatedAt: current.instance.createdAt,
              publisherId: pkg.manifest.publisher?.id || null,
              protocol: provider.protocol,
            }) : null,
          })
        }
      }
    }
    context.assertCurrent()
    return { providers, unmet: protocols.filter(item => !providers.some(provider => provider.protocol === item.protocol && provider.status === 'available'))
      .map(item => ({ protocol: item.protocol, optional: item.optional, reason: providers.some(provider => provider.protocol === item.protocol) ? 'unavailable' : 'not_installed' })) }
  }

  async target(binding, methodName) {
    let installation = this.runtime.installations.get(binding.providerAppId)
    if (!hasIncarnation(installation) || installation.incarnationId !== binding.providerInstallationIncarnationId
      || installation.createdAt !== binding.installationCreatedAt) throw unavailable('Provider installation is unavailable', 'not_installed')
    if (!installation.enabled) throw unavailable('Provider is disabled', 'disabled')
    let instance = this.runtime.instances.get(binding.providerInstanceId)
    if (!hasIncarnation(instance) || instance.incarnationId !== binding.providerInstanceIncarnationId
      || instance.appId !== binding.providerAppId || instance.createdAt !== binding.instanceCreatedAt) {
      throw unavailable('Provider instance is unavailable', 'instance_missing')
    }
    if (!instance.enabled) throw unavailable('Provider instance is disabled', 'instance_disabled')
    let pkg
    try { pkg = await this.runtime.getActivePackage(binding.providerAppId) }
    catch {
      const current = this.runtime.installations.get(binding.providerAppId)
      if (!hasIncarnation(current) || current.incarnationId !== binding.providerInstallationIncarnationId
        || current.createdAt !== binding.installationCreatedAt) {
        throw unavailable('Provider installation is unavailable', 'not_installed')
      }
      if (!current.enabled) throw unavailable('Provider is disabled', 'disabled')
      const currentInstance = this.runtime.instances.get(binding.providerInstanceId)
      if (!hasIncarnation(currentInstance) || currentInstance.incarnationId !== binding.providerInstanceIncarnationId
        || currentInstance.appId !== binding.providerAppId || currentInstance.createdAt !== binding.instanceCreatedAt) {
        throw unavailable('Provider instance is unavailable', 'instance_missing')
      }
      if (!currentInstance.enabled) throw unavailable('Provider instance is disabled', 'instance_disabled')
      throw unavailable('Provider package is unavailable', 'backend_unavailable')
    }
    // Package loading can yield while the provider is upgraded or revoked.
    installation = this.runtime.installations.get(binding.providerAppId)
    instance = this.runtime.instances.get(binding.providerInstanceId)
    if (!hasIncarnation(installation) || installation.incarnationId !== binding.providerInstallationIncarnationId
      || installation.createdAt !== binding.installationCreatedAt) throw unavailable('Provider installation is unavailable', 'not_installed')
    if (!installation.enabled) throw unavailable('Provider is disabled', 'disabled')
    if (!hasIncarnation(instance) || instance.incarnationId !== binding.providerInstanceIncarnationId
      || instance.appId !== binding.providerAppId || instance.createdAt !== binding.instanceCreatedAt) {
      throw unavailable('Provider instance is unavailable', 'instance_missing')
    }
    if (!instance.enabled) throw unavailable('Provider instance is disabled', 'instance_disabled')
    if (installation.activeVersion !== pkg.manifest.version) throw unavailable('Provider capability version changed', 'incompatible_version')
    if ((pkg.manifest.publisher?.id || null) !== binding.publisherId) throw unavailable('Provider publisher changed', 'publisher_changed')
    const provider = pkg.manifest.appCapabilities?.provides?.find(item => item.protocol === binding.protocol)
    if (!provider) throw unavailable('Provider capability version is unavailable', 'incompatible_version')
    const method = provider.methods.find(item => item.name === methodName)
    if (!method) throw unavailable('Provider method is unavailable', 'incompatible_version')
    if (!installation.grants.includes(method.permission)) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Provider permission was revoked')
    return { method, installation, instance, pkg }
  }

  assertDispatchCurrent(binding, pkg, methods, context) {
    context.assertCurrent()
    const installation = this.runtime.installations.get(binding.providerAppId)
    if (!hasIncarnation(installation) || installation.incarnationId !== binding.providerInstallationIncarnationId
      || installation.createdAt !== binding.installationCreatedAt) throw unavailable('Provider installation is unavailable', 'not_installed')
    if (!installation.enabled) throw unavailable('Provider is disabled', 'disabled')
    const instance = this.runtime.instances.get(binding.providerInstanceId)
    if (!hasIncarnation(instance) || instance.incarnationId !== binding.providerInstanceIncarnationId
      || instance.appId !== binding.providerAppId || instance.createdAt !== binding.instanceCreatedAt) {
      throw unavailable('Provider instance is unavailable', 'instance_missing')
    }
    if (!instance.enabled) throw unavailable('Provider instance is disabled', 'instance_disabled')
    if (installation.activeVersion !== pkg.manifest.version) throw unavailable('Provider capability version changed', 'incompatible_version')
    if ((pkg.manifest.publisher?.id || null) !== binding.publisherId) throw unavailable('Provider publisher changed', 'publisher_changed')
    const provider = pkg.manifest.appCapabilities?.provides?.find(item => item.protocol === binding.protocol)
    if (!provider) throw unavailable('Provider capability version is unavailable', 'incompatible_version')
    for (const expected of methods) {
      const method = provider.methods.find(item => item.name === expected.name)
      if (!method || !sameMethod(method, expected)) throw unavailable('Provider method changed', 'incompatible_version')
      if (!installation.grants.includes(method.permission)) {
        throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Provider permission was revoked')
      }
    }
  }

  async resourceMethods(binding) {
    const source = await this.target(binding, binding.sourceMethod)
    if (source.method.action !== binding.sourceAction
      || source.method.permission !== binding.sourcePermission
      || source.method.resourceReadMethod !== binding.readMethod) {
      throw unavailable('Result producer changed', 'incompatible_version')
    }
    const reader = await this.target(binding, binding.readMethod)
    if (reader.pkg.manifest.version !== source.pkg.manifest.version
      || reader.method.action !== binding.readAction
      || reader.method.permission !== binding.readPermission) {
      throw unavailable('Result reader changed', 'incompatible_version')
    }
    return { method: reader.method, pkg: reader.pkg }
  }

  audit(context, binding, traceId, method, startedAt, outcome, message) {
    void this.runtime.logs.append({ appId: context.appId, instanceId: context.instanceId, owner: context.owner,
      level: outcome === 'ok' ? 'info' : 'warn', message,
      details: { traceId, providerAppId: binding?.providerAppId || null,
        providerInstanceId: binding?.providerInstanceId || null,
        protocol: binding?.protocol || null, method,
        toolSource: binding?.source || null, serviceId: binding?.serviceId || null,
        durationMs: Date.now() - startedAt, outcome } }).catch(() => {})
  }

  async invoke(input, context) {
    const startedAt = Date.now()
    const traceId = createHash('sha256').update(`${context.owner.key}:${context.appId}:${context.instanceId}:${context.requestId}`).digest('hex').slice(0, 32)
    let binding
    let outcome = 'ok'
    try {
      if (context.surface !== 'ui' && context.invocation?.surface === 'app') throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Nested cross-App calls are not supported')
      binding = this.verify(input.providerRef, context)
      await this.consumer(context, binding.protocol)
      if (binding.providerAppId === context.appId) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'An App cannot invoke itself through the capability broker')
      const initial = await this.target(binding, input.method)
      const method = { ...initial.method }
      let reader = null
      if (method.resourceReadMethod) {
        const selectedReader = await this.target(binding, method.resourceReadMethod)
        if (selectedReader.pkg.manifest.version !== initial.pkg.manifest.version) {
          throw unavailable('Result reader changed', 'incompatible_version')
        }
        reader = { ...selectedReader.method }
      }
      context.assertCurrent()
      let value = await this.runtime.invoke(binding.providerAppId, binding.providerInstanceId, method.action, input.input, {
        signal: context.signal,
        requestId: traceId,
        principal: context.principal || context.owner,
        authorizeDispatch: () => this.assertDispatchCurrent(binding, initial.pkg, [
          { name: input.method, ...method },
          ...(reader ? [{ name: method.resourceReadMethod, ...reader }] : []),
        ], context),
        invocation: { surface: 'app', callerAppId: context.appId, callerInstanceId: context.instanceId,
          protocol: binding.protocol, method: input.method, traceId, workspace: context.invocation?.workspace },
      })
      context.assertCurrent()
      const current = await this.target(binding, input.method)
      if (!sameMethod(method, current.method)) throw unavailable('Provider method changed', 'incompatible_version')
      if (reader) {
        const currentReader = await this.target(binding, method.resourceReadMethod)
        if (!sameMethod(reader, currentReader.method) || currentReader.pkg.manifest.version !== current.pkg.manifest.version) {
          throw unavailable('Result reader changed', 'incompatible_version')
        }
      }
      context.assertCurrent()
      if (method.resourceReadMethod) {
        if (!value || typeof value !== 'object' || Array.isArray(value)
          || typeof value.resourceId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value.resourceId)) {
          throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Provider returned an invalid resource id')
        }
        const { resourceId, ...metadata } = value
        value = { ...metadata, resourceRef: this.sign({ ...binding, kind: 'resource',
          resourceId, sourceMethod: input.method, sourceAction: method.action, sourcePermission: method.permission,
          readMethod: method.resourceReadMethod, readAction: reader.action, readPermission: reader.permission,
          expiresAt: Date.now() + RESOURCE_REF_TTL_MS }) }
      }
      return { value, traceId }
    } catch (error) { outcome = outcomeCode(error); throw error }
    finally { this.audit(context, binding, traceId, input.method, startedAt, outcome, 'Cross-App capability call') }
  }

  async read(input, context) {
    const startedAt = Date.now()
    const traceId = createHash('sha256').update(`${context.owner.key}:${context.appId}:${context.instanceId}:${context.requestId}`).digest('hex').slice(0, 32)
    let binding
    let outcome = 'ok'
    try {
      if (context.surface !== 'ui' && context.invocation?.surface === 'app') throw new AppServiceError(APP_ERROR_CODES.permissionDenied, 'Nested cross-App calls are not supported')
      binding = this.verify(input.resourceRef, context, 'resource')
      if (!Number.isFinite(binding.expiresAt) || binding.expiresAt < Date.now()) {
        throw unavailable('Result reference expired', 'expired')
      }
      await this.consumer(context, binding.protocol)
      if (typeof binding.resourceId !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(binding.resourceId)) {
        throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid resource reference')
      }
      const selected = await this.resourceMethods(binding)
      const method = selected.method
      context.assertCurrent()
      if (binding.expiresAt < Date.now()) throw unavailable('Result reference expired', 'expired')
      const result = await this.runtime.invoke(binding.providerAppId, binding.providerInstanceId, method.action,
        { resourceId: binding.resourceId, offset: input.offset, limit: input.limit }, {
          signal: context.signal,
          requestId: traceId,
          principal: context.principal || context.owner,
          authorizeDispatch: () => this.assertDispatchCurrent(binding, selected.pkg, [
            { name: binding.sourceMethod, action: binding.sourceAction, permission: binding.sourcePermission,
              resourceReadMethod: binding.readMethod },
            { name: binding.readMethod, action: binding.readAction, permission: binding.readPermission },
          ], context),
          invocation: { surface: 'app', callerAppId: context.appId, callerInstanceId: context.instanceId,
            protocol: binding.protocol, method: binding.readMethod, traceId, workspace: context.invocation?.workspace },
        })
      context.assertCurrent()
      await this.resourceMethods(binding)
      if (binding.expiresAt < Date.now()) throw unavailable('Result reference expired', 'expired')
      context.assertCurrent()
      if (!result || typeof result !== 'object' || Array.isArray(result)
        || typeof result.text !== 'string' || result.text.length > input.limit
        || (result.nextOffset !== null && result.nextOffset !== undefined
          && (!Number.isSafeInteger(result.nextOffset) || !result.text.length
            || result.nextOffset !== input.offset + result.text.length))) {
        throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Provider returned an invalid resource chunk')
      }
      return result
    } catch (error) { outcome = outcomeCode(error); throw error }
    finally { this.audit(context, binding, traceId, binding?.readMethod || 'resource.read', startedAt, outcome, 'Cross-App resource read') }
  }
}
