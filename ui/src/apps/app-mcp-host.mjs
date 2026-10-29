import { isToolSourceAvailable } from '../../../packages/app-sdk/src/tool-services.mjs'
import { createMcpProtocolDefinition as contractDefinition, validateMcpHostInput as contractInput, validateMcpHostOutput } from '../../../packages/app-sdk/src/mcp/index.mjs'
import { mcpLimits } from '../../../packages/host-contracts/src/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../../packages/app-sdk/src/protocol/index.mjs'
import { compileJsonSchema } from '../../../packages/app-sdk/src/schemas/index.mjs'
import fs from 'node:fs/promises'
import { getAppToolScope } from '../../../packages/app-sdk/src/tool-scope.mjs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { writePrivateFileAtomic } from '../../../shared/security/credential-crypto.mjs'
import { isValidMcpServerName, normalizeMcpStore, validateMcpServerConfig } from '../desktop-mcp-settings.mjs'
import { resolveMcpLaunchConfig } from './mcp-launch-config.mjs'
import { readMcpAppConfig } from '../../../packages/app-runtime/src/packages/mcp-app.mjs'
import { validateMcpPathSettings } from '../../../packages/app-sdk/src/mcp/path-bindings.mjs'
import { mergeMcpDefaults, adoptMcpSettings } from './mcp-config-defaults.mjs'
import { catalogSnapshot, readToolCatalog, writeToolCatalog } from './app-mcp-catalog.mjs'
import { isDeepStrictEqual } from 'node:util'

export const MCP_PROTOCOL = 'moss.mcp/v1'
export const MCP_METHODS = ['servers.list', 'servers.save', 'servers.remove', 'servers.set-enabled', 'servers.inspect', 'auth.start', 'auth.clear']
const MAX_SERVERS = mcpLimits.servers
const SECRET_FIELD = 'mcpSecrets'
const MAX_BRIDGE_TOOL_SCHEMA_BYTES = 64 * 1024
const MAX_BRIDGE_CATALOG_BYTES = 512 * 1024
const permissions = { 'servers.list': 'mcp:read', 'servers.inspect': 'mcp:connect', 'auth.start': 'mcp:auth', 'auth.clear': 'mcp:auth' }

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数格式不正确。')
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('包含不支持的参数。')
  return value
}
export function validateMcpHostInput(method, value) {
  contractInput(method, value)
  if (!MCP_METHODS.includes(method)) throw new Error('不支持的 MCP 操作。')
  const keys = method === 'servers.list' ? [] : method === 'servers.save' ? ['name', 'previousName', 'enabled', 'config'] : method === 'servers.set-enabled' ? ['name', 'enabled'] : ['name']
  record(value, keys)
  if (['__proto__', 'constructor', 'prototype'].includes(value.name) || ['__proto__', 'constructor', 'prototype'].includes(value.previousName)) throw new Error('请使用其他服务名称。')
  if (method !== 'servers.list' && (!isValidMcpServerName(value.name) || value.name.length > 64)) throw new Error('服务名称只能包含字母、数字、连字符和下划线，最多 64 个字符。')
  if (method === 'servers.save') {
    if (value.previousName !== undefined && (!isValidMcpServerName(value.previousName) || value.previousName.length > 64)) throw new Error('原服务名称无效。')
    validateMcpServerConfig(value.config)
    if (Buffer.byteLength(JSON.stringify(value.config)) > mcpLimits.configBytes) throw new Error('服务配置超过 64 KB。')
  }
  if (['servers.save', 'servers.set-enabled'].includes(method) && typeof value.enabled !== 'boolean') throw new Error('启用状态无效。')
  return value
}
export function createMcpProtocolDefinition() {
  const definition = contractDefinition()
  for (const [method, value] of Object.entries(definition.methods)) value.validateInput = input => validateMcpHostInput(method, input)
  return definition
}

function key(context) { return `${context.owner?.key || 'host'}/${context.appId}/${context.instanceId}` }
function runtimeName(appId, name, owner) {
  const normalize = value => value.replace(/[^a-zA-Z0-9_]/g, '_')
  const appName = normalize(appId)
  // Standalone MCP Apps commonly repeat their local App name as the service name.
  const base = appId === 'moss.mcp' ? name : normalize(appId.split('.').at(-1)) === normalize(name)
    ? appName
    : `${appName}__${name}`
  if (!owner?.key || owner.key === 'host') return base
  // OAuth credentials are keyed by MCP runtime name and config. Keep every
  // non-host owner's transports in a stable, separate credential namespace.
  // Limit the server name so ordinary model-facing names such as
  // <server>__execute_sql fit within the API's 64-character tool-name limit.
  // @ cannot occur in a user-configured server name, so a Host-owned service
  // cannot reuse this raw name and its OAuth credential key.
  const hint = value => normalize(value).replace(/_+/g, '_').slice(0, 8)
  const digest = createHash('sha256').update(JSON.stringify([owner.key, appId, name])).digest('hex').slice(0, 20)
  return `@o_${hint(appId.split('.').at(-1))}_${hint(name)}_${digest}`
}
function decodeSecrets(values) {
  if (!values[SECRET_FIELD]) return {}
  let parsed
  try { parsed = JSON.parse(values[SECRET_FIELD]) } catch { throw new Error('MCP 密钥存储格式无效。') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MCP 密钥存储格式无效。')
  return parsed
}
function restoreConfig(entry, secrets) {
  const config = structuredClone(entry.config)
  for (const field of ['env', 'headers']) {
    if (!Object.keys(config[field] || {}).length) continue
    const stored = secrets[entry.secretId]?.[field]
    if (!stored || Object.keys(config[field]).some(name => typeof stored[name] !== 'string')) return null
    config[field] = stored
  }
  return config
}
function safeError(error, configs) {
  let message = String(error?.message || error || '连接失败。')
  for (const config of configs) {
    for (const value of [...Object.values(config?.env || {}), ...Object.values(config?.headers || {})]) {
      if (value) message = message.split(value).join('[已隐藏]')
    }
  }
  return message.slice(0, 1200)
}

function bridgeCallbackError(signal) {
  // Transport errors can echo URL userinfo/query values, argv or provider data.
  // A fixed message is the only safe response to a different App.
  return signal?.aborted
    ? new AppServiceError(APP_ERROR_CODES.actionCanceled, 'MCP 工具操作已取消。')
    : new AppServiceError(APP_ERROR_CODES.hostUnavailable, '目标 MCP 服务暂不可用。')
}

function bridgeToolDescriptor(service, tool) {
  try {
    if (!tool || typeof tool.name !== 'string' || !tool.name || tool.name.length > 256 || /[\x00-\x1f\x7f]/.test(tool.name)
      || !tool.inputSchema || typeof tool.inputSchema !== 'object' || Array.isArray(tool.inputSchema)) {
      throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'MCP 工具目录格式无效。')
    }
    const inputSchema = structuredClone(tool.inputSchema)
    if (Buffer.byteLength(JSON.stringify(inputSchema)) > MAX_BRIDGE_TOOL_SCHEMA_BYTES) {
      throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'MCP 工具输入结构超过跨 App 调用上限。')
    }
    const description = typeof tool.description === 'string' ? tool.description.slice(0, 1500) : ''
    const revision = createHash('sha256').update(JSON.stringify({
      service: service.serviceRevision, name: tool.name, description: tool.description || '',
      inputSchema, outputSchema: tool.outputSchema || null, annotations: tool.annotations || null,
    })).digest('hex')
    return { appId: service.appId, instanceId: service.instanceId, serviceId: service.serviceId, serviceName: service.localName,
      revision, name: tool.name, description, inputSchema }
  } catch (error) {
    if (error instanceof AppServiceError) throw error
    throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'MCP 工具目录格式无效。')
  }
}

function bridgeInputString(value, label, optional = false) {
  if (optional && value === undefined) return
  if (typeof value !== 'string' || !value || value.length > 256) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `${label} 无效。`)
  }
}

async function resolveBundledMcpServers(servers, packageRoot) {
  const root = await fs.realpath(packageRoot)
  const bundledPath = async value => {
    if (typeof value !== 'string' || !value.startsWith('@app/')) return value
    const relative = value.slice(5)
    if (!relative || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('App 内 MCP 路径无效。')
    const target = await fs.realpath(path.join(root, relative))
    if (!target.startsWith(root + path.sep) || !(await fs.stat(target)).isFile()) throw new Error('App 内 MCP 文件不可用。')
    return target
  }
  return Object.fromEntries(await Promise.all(Object.entries(servers).map(async ([name, config]) => [name, {
    ...config,
    ...(config.command ? { command: await bundledPath(config.command) } : {}),
    ...(config.args ? { args: await Promise.all(config.args.map(bundledPath)) } : {}),
  }])))
}

/** Host-owned registry. MCP transport and tool execution remain in the agent runtime. */
export class AppMcpHost {
  constructor({ getRuntime, readLegacy, clearLegacy, onChanged, onCatalogChanged, inspect, discoverTool, invokeTool, authenticate, clearAuth, getIdleTimeoutMs, prepareProvider, reservedName = () => false }) {
    Object.assign(this, { getRuntime, readLegacy, clearLegacy, onChanged, onCatalogChanged, inspect, discoverTool, invokeTool, authenticate, clearAuth, getIdleTimeoutMs, prepareProvider, reservedName })
    this.providers = new Map()
    this.checks = new Map()
    this.catalogs = new Map()
    this.inspections = new Map()
    this.queue = Promise.resolve()
  }
  serial(operation) {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => {})
    return pending
  }
  currentOwner() { return this.getRuntime()?.currentOwner?.() || { key: 'host' } }
  sameOwner(provider) { return (provider.owner?.key || 'host') === this.currentOwner().key }
  withOwner(provider, operation) {
    const runtime = this.getRuntime()
    return provider.owner && runtime?.withOwner ? runtime.withOwner(provider.owner, operation) : operation()
  }
  current(provider) {
    return this.withOwner(provider, () => {
      const runtime = this.getRuntime()
      const installation = runtime?.installations.get(provider.appId)
      const instance = runtime?.instances.get(provider.instanceId)
      return Boolean(installation?.enabled && instance?.enabled && instance.appId === provider.appId
        && installation.activeVersion === provider.version
        && (!provider.installationIncarnationId || installation.incarnationId === provider.installationIncarnationId)
        && (!provider.instanceIncarnationId || instance.incarnationId === provider.instanceIncarnationId))
    })
  }
  active(provider) {
    return this.withOwner(provider, () => {
      const grants = this.getRuntime()?.installations.get(provider.appId)?.grants || []
      return this.current(provider) && grants.includes('mcp:manage') && grants.includes('mcp:connect')
    })
  }
  assertCurrent(context) {
    if (context.signal?.aborted) throw new Error('操作已取消。')
    if (!this.current(context)) throw new Error('请先启用应用。')
    if (context.permission && !this.withOwner(context, () => this.getRuntime().installations.get(context.appId)?.grants?.includes(context.permission))) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, '请在应用管理中授予此操作需要的 MCP 权限。')
  }
  async load(context) {
    const runtime = this.getRuntime()
    context = { ...context, owner: context.owner || runtime?.currentOwner?.() || { key: 'host' } }
    if (!this.catalogs.has(key(context))) this.catalogs.set(key(context), await readToolCatalog(context.dataDir))
    const file = path.join(context.dataDir, 'mcp-servers.json')
    let document
    try { document = JSON.parse(await fs.readFile(file, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error; document = { version: 1, servers: {} } }
    if (document.version !== 1 || !document.servers || typeof document.servers !== 'object' || Array.isArray(document.servers)) throw new Error('MCP 配置无法读取，请恢复备份后重试。')
    let migratedIds = false
    for (const entry of Object.values(document.servers)) {
      if (!entry.id) { entry.id = randomUUID(); migratedIds = true }
    }
    if (migratedIds) writePrivateFileAtomic(file, `${JSON.stringify(document, null, 2)}\n`)
    const credentials = await runtime.credentials.get(context.appId, context.instanceId)
    const secrets = decodeSecrets(credentials)
    const pkg = await runtime.getActivePackage(context.appId)
    const provider = { ...context,
      installationIncarnationId: runtime.installations.get(context.appId)?.incarnationId,
      instanceIncarnationId: runtime.instances.get(context.instanceId)?.incarnationId,
      toolScope: getAppToolScope(pkg.manifest.toolScope), toolLoading: pkg.manifest.toolLoading || 'on-demand', toolSelection: pkg.manifest.toolSelection || 'app', mcpIdleTimeoutMs: pkg.manifest.mcpApp?.runtime?.state === 'stateless' ? pkg.manifest.mcpApp.runtime.idleTimeoutMs || 3_600_000 : 0, signal: undefined, document, file, secrets }
    this.providers.set(key(context), provider)
    if (pkg.manifest.mcpApp && this.active(provider)) {
      const definition = await readMcpAppConfig(pkg.root, pkg.manifest)
      const bundled = Object.values(definition.mcpServers).some(config => [config.command, ...(config.args || [])].some(value => value?.startsWith('@app/')))
      definition.mcpServers = await resolveBundledMcpServers(definition.mcpServers, pkg.root)
      if (bundled) definition.revision = createHash('sha256').update(definition.revision).update(pkg.root).digest('hex')
      if (document.definitionRevision !== definition.revision) {
        const next = { version: 1, definitionRevision: definition.revision, definitionServers: definition.mcpServers, servers: {} }
        const values = { ...secrets }
        for (const [name, config] of Object.entries(definition.mcpServers)) {
          this.assertUnique(provider, name, name)
          const previous = document.servers[name]
          const current = previous && restoreConfig(previous, secrets)
          if (previous && !current) throw new Error('服务凭据缺失，请恢复凭据后再更新配置。')
          const merged = current ? document.definitionServers?.[name]
            ? mergeMcpDefaults(document.definitionServers[name], current, config) : adoptMcpSettings(current, config) : config
          next.servers[name] = this.encode(validateMcpServerConfig(merged), previous?.enabled ?? true, values, previous?.id)
          this.checks.delete(`${key(context)}/${name}`)
        }
        for (const [name, entry] of Object.entries(document.servers)) {
          if (!Object.hasOwn(definition.mcpServers, name) && !Object.hasOwn(document.definitionServers || {}, name)) next.servers[name] = entry
        }
        const result = await this.commit(context, next, values)
        this.onChanged?.(context.appId)
        return result
      }
      if (!document.definitionServers) {
        document.definitionServers = definition.mcpServers
        writePrivateFileAtomic(file, `${JSON.stringify(document, null, 2)}\n`)
      }
    }
    return provider
  }
  async commit(context, document, secrets) {
    this.assertCurrent(context)
    const serialized = `${JSON.stringify(document, null, 2)}\n`
    if (Buffer.byteLength(serialized) > 256 * 1024) throw new Error('服务配置总量超过 256 KB，请减少配置内容。')
    const runtime = this.getRuntime()
    const credentials = await runtime.credentials.get(context.appId, context.instanceId)
    // Preserve previous secret revisions until the configuration has committed.
    const combined = { ...decodeSecrets(credentials), ...secrets }
    if (Buffer.byteLength(JSON.stringify(combined)) > 512 * 1024) throw new Error('服务凭据总量超过限制，请减少凭据内容。')
    await runtime.credentials.set(context.appId, context.instanceId, { ...credentials, [SECRET_FIELD]: JSON.stringify(combined) })
    this.assertCurrent(context)
    await fs.mkdir(context.dataDir, { recursive: true })
    writePrivateFileAtomic(path.join(context.dataDir, 'mcp-servers.json'), serialized)
    const provider = await this.load(context)
    const referenced = new Set(Object.values(document.servers).map(entry => entry.secretId))
    const retained = Object.fromEntries(Object.entries(combined).filter(([id]) => referenced.has(id)))
    await runtime.credentials.set(context.appId, context.instanceId, { ...credentials, [SECRET_FIELD]: JSON.stringify(retained) })
      .catch(() => {}) // A failed cleanup may retain encrypted obsolete values, never discard live credentials.
    return provider
  }
  encode(config, enabled, secrets, id = randomUUID()) {
    const stored = structuredClone(config), secretId = randomUUID(), values = {}
    for (const field of ['env', 'headers']) {
      if (!stored[field]) continue
      values[field] = stored[field]
      stored[field] = Object.fromEntries(Object.keys(stored[field]).map(name => [name, '']))
    }
    secrets[secretId] = values
    return { id, config: stored, enabled, updatedAt: Date.now(), secretId }
  }
  async migrate(context, provider) {
    if (context.appId !== 'moss.mcp' || !this.active(context)) return provider
    const legacy = normalizeMcpStore(this.readLegacy?.())
    if (!Object.keys(legacy.servers).length) return provider
    const document = structuredClone(provider.document), secrets = { ...provider.secrets }
    for (const [name, entry] of Object.entries(legacy.servers)) {
      if (!document.servers[name]) document.servers[name] = this.encode(entry.config, entry.enabled, secrets)
      else if (JSON.stringify(restoreConfig(document.servers[name], secrets)) !== JSON.stringify(entry.config)) {
        throw new Error(`旧配置中的 ${name} 与应用配置冲突，请先处理后再迁移。`)
      }
    }
    const next = await this.commit(context, document, secrets)
    // This runs only after both encrypted credentials and the new registry are durable.
    await this.clearLegacy?.()
    this.onChanged?.(context.appId)
    return next
  }
  async refresh(targetAppId = null, { notify = true } = {}) {
    return this.serial(async () => {
      const runtime = this.getRuntime()
      if (!runtime) return
      const owner = this.currentOwner()
      const current = new Set()
      const installations = targetAppId ? [runtime.installations.get(targetAppId)].filter(Boolean) : runtime.installations.list()
      for (const installation of installations) {
        if (!installation.enabled) continue
        if (!installation.grants?.includes('mcp:manage') || !installation.grants?.includes('mcp:connect')) continue
        if (runtime.manifestMetadata) {
          const metadata = await runtime.manifestMetadata(installation).catch(() => null)
          if (!metadata?.host?.protocols?.includes(MCP_PROTOCOL)) continue
        }
        const pkg = await runtime.getActivePackage(installation.appId).catch(() => null)
        if (!pkg?.manifest.host?.protocols?.includes(MCP_PROTOCOL) || !pkg.manifest.permissions?.includes('mcp:manage') || !pkg.manifest.permissions?.includes('mcp:connect')) continue
        for (const instance of runtime.instances.list(installation.appId)) {
          if (!instance.enabled) continue
          const context = { appId: installation.appId, instanceId: instance.id, owner, version: installation.activeVersion, toolScope: getAppToolScope(pkg.manifest.toolScope), toolLoading: pkg.manifest.toolLoading || 'on-demand',
            dataDir: runtime.appDataPath(runtime.dataDir, installation.appId, 'instances', instance.id) }
          current.add(key(context))
          const provider = await this.load(context)
          if (this.active(context)) await this.migrate(context, provider)
        }
      }
      for (const [id, provider] of this.providers) {
        if (provider.owner.key === owner.key && (!targetAppId || provider.appId === targetAppId) && !current.has(id)) this.providers.delete(id)
      }
      if (notify) this.onCatalogChanged?.()
    })
  }
  async prepareForSession(appIds = [], appServiceIds = []) {
    await this.refresh(null, { notify: false })
    if (!this.prepareProvider) return
    for (const provider of this.providers.values()) {
      if (!this.sameOwner(provider) || !this.active(provider)) continue
      const available = this.effectiveScope(provider) === 'global' || appIds.includes(provider.appId)
        || Object.values(provider.document.servers).some(entry => isToolSourceAvailable(this.owner(provider, entry), appIds, appServiceIds))
      if (available) await this.withOwner(provider, () => this.prepareProvider(provider))
    }
    await this.refresh(null, { notify: false })
  }
  serviceId(provider, entry) { return `mcp/${provider.instanceId}/${entry.id}` }
  owner(provider, entry) { return { appId: provider.appId, toolScope: this.effectiveScope(provider), toolLoading: this.getRuntime()?.getToolLoading?.(provider.appId, provider.toolLoading) ?? provider.toolLoading, toolSelection: provider.toolSelection, serviceId: this.serviceId(provider, entry), ...(provider.mcpIdleTimeoutMs ? { mcpIdleTimeoutMs: this.getIdleTimeoutMs?.() ?? provider.mcpIdleTimeoutMs } : {}) } }
  enabledServers(appIds, workspace, appServiceIds = []) {
    const result = {}
    for (const provider of this.providers.values()) {
      if (!this.sameOwner(provider) || !this.active(provider)) continue
      for (const [name, entry] of Object.entries(provider.document.servers)) {
        if (Array.isArray(appIds) && !isToolSourceAvailable(this.owner(provider, entry), appIds, appServiceIds)) continue
        const config = restoreConfig(entry, provider.secrets)
        if (entry.enabled && config) result[runtimeName(provider.appId, name, provider.owner)] = resolveMcpLaunchConfig(config, { workspace })
      }
    }
    return result
  }
  serverOwners() {
    return Object.fromEntries([...this.providers.values()].filter(provider => this.sameOwner(provider)).flatMap(provider =>
      Object.keys(provider.document.servers).map(name => [runtimeName(provider.appId, name, provider.owner), this.owner(provider, provider.document.servers[name])]),
    ))
  }
  effectiveScope(provider) { return this.getRuntime()?.getToolScope?.(provider.appId, provider.toolScope) ?? getAppToolScope(provider.toolScope) }
  findServer(name) {
    for (const provider of this.providers.values()) {
      if (!this.sameOwner(provider) || !this.active(provider)) continue
      for (const [localName, entry] of Object.entries(provider.document.servers)) {
        if (runtimeName(provider.appId, localName, provider.owner) !== name) continue
        const config = restoreConfig(entry, provider.secrets)
        return config ? { ...entry, config: resolveMcpLaunchConfig(config), provider, localName } : null
      }
    }
    return null
  }
  bridgeServices(query) {
    try { return this.bridgeServicesUnchecked(query) }
    catch (error) {
      if (error instanceof AppServiceError) throw error
      throw bridgeCallbackError()
    }
  }
  bridgeServicesUnchecked({ targetAppId, targetInstanceId, serviceId }) {
    bridgeInputString(targetAppId, '目标 App')
    bridgeInputString(targetInstanceId, '目标实例', true)
    bridgeInputString(serviceId, 'MCP 服务', true)
    const matches = []
    for (const provider of this.providers.values()) {
      if (!this.sameOwner(provider) || provider.appId !== targetAppId || (targetInstanceId && provider.instanceId !== targetInstanceId)) continue
      for (const [localName, entry] of Object.entries(provider.document.servers)) {
        const currentServiceId = this.serviceId(provider, entry)
        if (serviceId && currentServiceId !== serviceId) continue
        if (!this.active(provider) || !entry.enabled) {
          if (serviceId) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, '目标 MCP 服务已停用或失去授权。')
          continue
        }
        const config = restoreConfig(entry, provider.secrets)
        if (!config) {
          if (serviceId) throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, '目标 MCP 服务凭据不可用。')
          continue
        }
        matches.push({ appId: provider.appId, instanceId: provider.instanceId, serviceId: currentServiceId,
          serviceRevision: this.toolRevision(provider, entry), localName, runtimeName: runtimeName(provider.appId, localName, provider.owner),
          config: resolveMcpLaunchConfig(config) })
      }
    }
    if (serviceId && !matches.length) throw new AppServiceError(APP_ERROR_CODES.notFound, '目标 MCP 服务不存在。')
    return matches
  }
  async refreshBridgeTarget(targetAppId, signal) {
    try { await this.refresh(targetAppId, { notify: false }) }
    catch { throw bridgeCallbackError(signal) }
  }
  assertBridgeServiceCurrent(service) {
    const current = this.bridgeServices({ targetAppId: service.appId, targetInstanceId: service.instanceId, serviceId: service.serviceId })[0]
    if (!current || current.serviceRevision !== service.serviceRevision) {
      throw new AppServiceError(APP_ERROR_CODES.conflict, '目标 MCP 服务已变化，请重新发现工具。')
    }
    return current
  }
  /** Live discovery for the cross-App broker. Display caches never authorize a call. */
  async discoverBridgeTools({ targetAppId, targetInstanceId, serviceId, toolNames, signal }) {
    if (signal?.aborted) throw bridgeCallbackError(signal)
    if (typeof this.discoverTool !== 'function') throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host 尚未提供 MCP 工具发现。')
    bridgeInputString(targetAppId, '目标 App')
    if (toolNames !== undefined && !(Array.isArray(toolNames) || toolNames instanceof Set)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'MCP 工具筛选条件无效。')
    }
    const selected = toolNames === undefined ? null : new Set(toolNames)
    if (selected && (selected.size > 512 || [...selected].some(name => typeof name !== 'string' || !name || name.length > 256))) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'MCP 工具筛选条件无效。')
    }
    await this.refreshBridgeTarget(targetAppId, signal)
    if (selected?.size === 0) return []
    const services = await this.serial(() => this.bridgeServices({ targetAppId, targetInstanceId, serviceId }))
    const discover = async service => {
      if (signal?.aborted) throw bridgeCallbackError(signal)
      let tools
      try { tools = await this.discoverTool(service.runtimeName, service.config, signal) }
      catch { throw bridgeCallbackError(signal) }
      if (!Array.isArray(tools)) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'MCP 工具目录格式无效。')
      const descriptors = tools.filter(tool => (!selected || selected.has(tool?.name)) && !service.config.disabledTools?.includes(tool?.name))
        .map(tool => bridgeToolDescriptor(service, tool))
      await this.serial(() => this.assertBridgeServiceCurrent(service))
      return descriptors
    }
    const result = []
    let remaining = MAX_BRIDGE_CATALOG_BYTES - 2, firstUnavailable = null
    // A broken connection must not hide working connections in the same App.
    // The current broker API returns tools only; an explicit serviceId still
    // reports its own error, and a completely empty partial result reports one.
    for (let offset = 0; offset < services.length; offset += 3) {
      const outcomes = await Promise.allSettled(services.slice(offset, offset + 3).map(discover))
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          if (!serviceId && outcome.reason?.code === APP_ERROR_CODES.hostUnavailable) {
            firstUnavailable ||= outcome.reason
            continue
          }
          throw outcome.reason
        }
        for (const descriptor of outcome.value) {
          const bytes = Buffer.byteLength(JSON.stringify(descriptor)) + (result.length ? 1 : 0)
          if (bytes > remaining) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'MCP 工具目录超过跨 App 调用上限。')
          result.push(descriptor)
          remaining -= bytes
        }
      }
    }
    if (!result.length && firstUnavailable) throw firstUnavailable
    return result
  }
  /** A signed broker reference must identify this exact target App, instance and service. */
  async invokeBridgeTool({ targetAppId, targetInstanceId, serviceId, revision, toolName, arguments: args = {}, signal, authorizeDispatch }) {
    if (signal?.aborted) throw bridgeCallbackError(signal)
    bridgeInputString(targetAppId, '目标 App')
    bridgeInputString(targetInstanceId, '目标实例')
    bridgeInputString(serviceId, 'MCP 服务')
    bridgeInputString(toolName, 'MCP 工具')
    if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision) || typeof authorizeDispatch !== 'function'
      || !args || typeof args !== 'object' || Array.isArray(args)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, '跨 App MCP 工具调用参数无效。')
    }
    let inputBytes
    try { inputBytes = Buffer.byteLength(JSON.stringify(args)) }
    catch { throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'MCP 工具参数必须是 JSON 对象。') }
    if (inputBytes > 256 * 1024) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'MCP 工具参数超过跨 App 调用上限。')
    if (typeof this.invokeTool !== 'function') throw new AppServiceError(APP_ERROR_CODES.hostUnavailable, 'Host 尚未提供 MCP 工具调用。')
    await this.refreshBridgeTarget(targetAppId, signal)
    const service = await this.serial(() => this.bridgeServices({ targetAppId, targetInstanceId, serviceId })[0])
    if (service.config.disabledTools?.includes(toolName)) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, '此 MCP 工具已停用。')
    let trustedBeforeCallError
    let result
    try {
      result = await this.invokeTool(service.runtimeName, service.config, toolName, args, { signal,
        beforeCall: async tool => {
          try {
            if (tool.name !== toolName || bridgeToolDescriptor(service, tool).revision !== revision) {
              throw new AppServiceError(APP_ERROR_CODES.conflict, 'MCP 工具结构已变化，请重新发现。')
            }
            let valid
            try { valid = compileJsonSchema(tool.inputSchema)(args) }
            catch { throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'MCP 工具输入结构无法验证。') }
            if (!valid) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'MCP 工具参数不符合实时输入结构。')
            await authorizeDispatch()
            await this.serial(() => {
              const current = this.assertBridgeServiceCurrent(service)
              if (current.config.disabledTools?.includes(toolName)) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, '此 MCP 工具已停用。')
            })
          } catch (error) {
            if (error instanceof AppServiceError) trustedBeforeCallError = error
            throw error
          }
        } })
    } catch (error) {
      if (error === trustedBeforeCallError) throw error
      throw bridgeCallbackError(signal)
    }
    await this.serial(() => this.assertBridgeServiceCurrent(service))
    return result
  }
  hasApp(appId) { return [...this.providers.values()].some(provider => this.sameOwner(provider) && provider.appId === appId) }
  toolRevision(provider, entry) { return `${provider.version}/${entry.secretId}/${entry.updatedAt}/${entry.enabled}` }
  cachedCatalog(provider, name) {
    const entry = provider.document.servers[name], cached = this.catalogs.get(key(provider))?.[name]
    return entry && cached?.revision === this.toolRevision(provider, entry) ? cached : undefined
  }
  async rememberCatalog(provider, name, check) {
    if (check.state !== 'connected') return
    const config = restoreConfig(provider.document.servers[name], provider.secrets)
    const snapshot = catalogSnapshot(check, value => value ? safeError(value, [config]) : '')
    if (!snapshot) return
    const services = Object.fromEntries(Object.keys(provider.document.servers).flatMap(name => {
      const cached = this.cachedCatalog(provider, name)
      return cached ? [[name, cached]] : []
    }))
    services[name] = { ...snapshot, revision: this.toolRevision(provider, provider.document.servers[name]) }
    this.catalogs.set(key(provider), services)
    await writeToolCatalog(provider.dataDir, services).catch(() => {})
  }
  // Live Agent discovery updates the same display cache without starting a probe.
  async recordRuntimeCatalog(name, config, check, connectionStartedAt) {
    const found = this.findServer(name)
    if (!found || !found.enabled || check.state !== 'connected') return
    if (Number.isFinite(connectionStartedAt) && connectionStartedAt < found.updatedAt) return
    const { scope: _scope, ...launch } = config
    const expected = resolveMcpLaunchConfig(restoreConfig(found.provider.document.servers[found.localName], found.provider.secrets), { workspace: config.env?.MOSS_SESSION_WORKSPACE || undefined })
    if (!isDeepStrictEqual(launch, expected)) return
    const revision = this.toolRevision(found.provider, found)
    return this.serial(async () => {
      if (!this.active(found.provider)) return
      const current = await this.load(found.provider), entry = current.document.servers[found.localName]
      if (!entry || !entry.enabled || this.toolRevision(current, entry) !== revision) return
      await this.rememberCatalog(current, found.localName, check)
      const cached = this.cachedCatalog(current, found.localName)
      if (cached) {
        const { revision: _revision, ...snapshot } = cached
        this.checks.set(`${key(current)}/${found.localName}`, { ...snapshot, state: 'connected' })
      }
      this.onCatalogChanged?.()
    })
  }
  /** Desktop disclosure only: never include launch configuration or credentials. */
  toolCatalog(appId) {
    const result = [], runtime = this.getRuntime()
    let budget = 400 * 1024
    for (const provider of this.providers.values()) {
      if (!this.sameOwner(provider) || provider.appId !== appId) continue
      const installation = runtime?.installations.get(appId), instance = runtime?.instances.get(provider.instanceId)
      if (!installation || !instance || installation.activeVersion !== provider.version) continue
      for (const server of this.list(provider).servers) {
        const cached = this.cachedCatalog(provider, server.name)
        const runtimeCheck = this.checks.get(`${key(provider)}/${server.name}`)
        const live = server.check?.state === 'connected'
        const knownTools = live ? server.check.tools : cached?.tools || [], tools = []
        for (const tool of knownTools) {
          const bytes = Buffer.byteLength(JSON.stringify(tool)) + 1
          if (bytes > budget) break
          tools.push(tool); budget -= bytes
        }
        const status = !installation.enabled ? 'app-disabled' : !instance.enabled ? 'instance-disabled'
          : !this.active(provider) ? 'unauthorized' : !server.enabled ? 'disabled'
            : server.credentialsMissing ? 'credentials-missing' : server.check?.state || 'unchecked'
        result.push({ appId, instanceId: provider.instanceId, name: server.name,
          serviceId: this.serviceId(provider, provider.document.servers[server.name]),
          runtimeName: runtimeName(appId, server.name, provider.owner), revision: this.toolRevision(provider, provider.document.servers[server.name]),
          status, tools, error: server.check?.error || cached?.error,
          schemaRevision: live ? runtimeCheck?.schemaRevision : cached?.schemaRevision,
          catalogStale: live ? runtimeCheck?.catalogStale : cached?.catalogStale,
          catalogSource: live ? 'live' : cached ? 'cache' : 'unknown',
          checkedAt: live ? server.check.checkedAt : cached?.checkedAt,
          truncated: Boolean((live ? server.check.truncated : cached?.truncated) || tools.length < knownTools.length) })
      }
    }
    return result
  }
  async inspectTools(input) {
    record(input, ['appId', 'instanceId', 'name', 'revision'])
    const provider = [...this.providers.values()].find(item => this.sameOwner(item) && item.appId === input.appId && item.instanceId === input.instanceId)
    const entry = provider?.document.servers[input.name]
    if (!entry || !this.active(provider) || !entry.enabled) throw new Error('服务已停用或未授权，请在 App 管理中检查。')
    if (this.toolRevision(provider, entry) !== input.revision) throw new Error('连接配置已变化，请重新加载。')
    const inspectionKey = `${key(provider)}/${input.name}/${input.revision}`
    let pending = this.inspections.get(inspectionKey)
    if (!pending) {
      pending = this.handle('servers.inspect', { name: input.name }, { ...provider, expectedToolRevision: input.revision, signal: AbortSignal.timeout(300_000) })
      this.inspections.set(inspectionKey, pending)
    }
    try { await pending } finally { if (this.inspections.get(inspectionKey) === pending) this.inspections.delete(inspectionKey) }
    return this.toolCatalog(input.appId).find(item => item.instanceId === input.instanceId && item.name === input.name)
  }
  /** Core's configuration-driven MCP page. No App UI or guest context is needed. */
  async manage(input) {
    record(input, ['appId', 'instanceId', 'version', 'method', 'input'])
    if (!['servers.list', 'servers.save', 'servers.inspect', 'auth.start', 'auth.clear'].includes(input.method)) throw new Error('不支持的 MCP 管理操作。')
    for (const field of ['appId', 'instanceId', 'version']) if (typeof input[field] !== 'string' || !input[field]) throw new Error('App 标识不完整。')
    const provider = [...this.providers.values()].find(item => this.sameOwner(item) && item.appId === input.appId && item.instanceId === input.instanceId)
    if (!provider || provider.version !== input.version || !this.current(provider)) throw new Error('App 状态已变化，请重新打开详情页。')
    const pkg = await this.getRuntime().getActivePackage(input.appId)
    if (!pkg.manifest.mcpApp || pkg.manifest.ui?.entry || !pkg.manifest.host?.protocols?.includes(MCP_PROTOCOL)) throw new Error('此 App 未声明通用 MCP 配置。')
    const permission = permissions[input.method] || 'mcp:manage'
    if (!pkg.manifest.permissions?.includes(permission)) throw new AppServiceError(APP_ERROR_CODES.permissionDenied, '此 App 未声明所需的 MCP 权限。')
    return this.handle(input.method, input.input, { ...provider, signal: AbortSignal.timeout(300_000) })
  }
  list(provider, extra = {}, focusName = '') {
    let budget = 400 * 1024
    const checks = new Map()
    const names = Object.keys(provider.document.servers).sort((a, b) => Number(b === focusName) - Number(a === focusName))
    for (const name of names) {
      const check = this.checks.get(`${key(provider)}/${name}`)
      if (!check) continue
      const tools = []
      for (const tool of check.tools || []) {
        const publicTool = { name: tool.name, description: tool.description || '', disabled: tool.disabled === true }
        const bytes = Buffer.byteLength(JSON.stringify(publicTool)) + 1
        if (bytes > budget) break
        tools.push(publicTool); budget -= bytes
      }
      checks.set(name, { state: check.state, tools, checkedAt: check.checkedAt,
        truncated: Boolean(check.truncated || tools.length < (check.tools?.length || 0)),
        ...(check.durationMs === undefined ? {} : { durationMs: check.durationMs }),
        ...(check.error === undefined ? {} : { error: check.error }),
        ...(check.serverInfo ? { serverInfo: { name: check.serverInfo.name, version: check.serverInfo.version } } : {}),
      })
    }
    return { servers: Object.entries(provider.document.servers).map(([name, entry]) => ({
      name, enabled: entry.enabled, config: entry.config, updatedAt: entry.updatedAt,
      credentialsMissing: !restoreConfig(entry, provider.secrets),
      check: checks.get(name) || null,
    })), ...extra }
  }
  assertUnique(provider, name, previousName) {
    if (name !== previousName && provider.document.servers[name]) throw new AppServiceError(APP_ERROR_CODES.conflict, '已有同名服务，请使用其他名称。')
    const target = runtimeName(provider.appId, name, provider.owner).replaceAll('-', '_')
    for (const other of this.providers.values()) {
      if (other.owner.key !== provider.owner.key) continue
      for (const localName of Object.keys(other.document.servers)) {
        if (key(other) === key(provider) && localName === previousName) continue
        if (runtimeName(other.appId, localName, other.owner).replaceAll('-', '_') === target) throw new AppServiceError(APP_ERROR_CODES.conflict, '该名称会与其他 MCP 工具标识冲突，请使用其他名称。')
      }
    }
    if (this.reservedName(runtimeName(provider.appId, name, provider.owner))) throw new AppServiceError(APP_ERROR_CODES.conflict, '该名称已被连接器使用，请使用其他名称。')
  }
  async handle(method, raw, context) {
    try { return validateMcpHostOutput(method, await this.handleRequest(method, raw, context)) }
    catch (error) {
      if (error instanceof AppServiceError) throw error
      throw new AppServiceError(context.signal?.aborted ? APP_ERROR_CODES.actionCanceled : APP_ERROR_CODES.hostUnavailable, error.message)
    }
  }
  async handleRequest(method, raw, context) {
    let input
    try { input = validateMcpHostInput(method, raw) }
    catch (error) { throw new AppServiceError(APP_ERROR_CODES.invalidInput, error.message, error.details) }
    context = { ...context, permission: permissions[method] || 'mcp:manage' }
    const prepared = await this.serial(async () => {
      this.assertCurrent(context)
      let provider = await this.migrate(context, await this.load(context))
      if (method === 'servers.list') return { result: this.list(provider) }
      const previousName = input.previousName || input.name
      const entry = provider.document.servers[previousName]
      if (method !== 'servers.save' && !entry) throw new AppServiceError(APP_ERROR_CODES.notFound, '服务不存在，请刷新后重试。')
      if (context.expectedToolRevision && (!this.active(provider) || !entry.enabled || this.toolRevision(provider, entry) !== context.expectedToolRevision)) {
        throw new Error('连接配置或启用状态已变化，请重新加载。')
      }
      if (['servers.inspect', 'auth.start', 'auth.clear'].includes(method)) {
        const config = restoreConfig(entry, provider.secrets)
        if (!config) throw new Error('服务凭据已清除，请编辑连接并重新填写。')
        return { provider, entry, config: resolveMcpLaunchConfig(config) }
      }
      const document = structuredClone(provider.document), secrets = { ...provider.secrets }
      if (method === 'servers.save') {
        if (input.previousName && !entry) throw new AppServiceError(APP_ERROR_CODES.notFound, '服务已被删除，请刷新后重试。')
        this.assertUnique(provider, input.name, input.previousName)
        if (!entry && Object.keys(document.servers).length >= MAX_SERVERS) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, `最多添加 ${MAX_SERVERS} 个服务。`)
        const config = validateMcpServerConfig(input.config)
        if (config.roots || config.pathBindings) await validateMcpPathSettings(config)
        const previous = entry && restoreConfig(entry, secrets)
        for (const field of ['env', 'headers']) for (const name of Object.keys(config[field] || {})) {
          if (config[field][name] === '' && previous?.[field]?.[name] !== undefined) config[field][name] = previous[field][name]
        }
        if (input.previousName && input.previousName !== input.name) delete document.servers[input.previousName]
        document.servers[input.name] = this.encode(config, input.enabled, secrets, entry?.id)
      } else if (method === 'servers.remove') delete document.servers[input.name]
      else document.servers[input.name] = { ...entry, enabled: input.enabled, updatedAt: Math.max(Date.now(), (entry.updatedAt || 0) + 1) }
      provider = await this.commit(context, document, secrets)
      this.checks.delete(`${key(context)}/${previousName}`)
      this.checks.delete(`${key(context)}/${input.name}`)
      this.onCatalogChanged?.()
      return { result: this.list(provider, this.onChanged?.(context.appId) || {}) }
    })
    if (prepared.result) return prepared.result
    const { config, entry } = prepared, name = runtimeName(context.appId, input.name, context.owner || this.currentOwner())
    try {
      let check
      if (method === 'servers.inspect') {
        check = await this.inspect(name, config, context.signal)
        // MCP Implementation may include title, websiteUrl, icons and other
        // metadata. The App protocol exposes only its declared identity fields.
        if (check.serverInfo) check = { ...check, serverInfo: { name: check.serverInfo.name, version: check.serverInfo.version } }
      }
      else {
        if (!['http', 'sse'].includes(config.type)) throw new Error('本地进程连接不需要浏览器授权。')
        if (method === 'auth.start') await this.authenticate(name, config, context.signal)
        else await this.clearAuth(name, config, context.signal)
        check = { state: method === 'auth.start' ? 'authorized' : 'unchecked', tools: [], checkedAt: Date.now() }
      }
      return await this.serial(async () => {
        this.assertCurrent(context)
        let current = await this.load(context)
        if (this.toolRevision(current, current.document.servers[input.name] || {}) !== this.toolRevision(prepared.provider, entry)) throw new Error('连接配置已变化，请重新检查。')
        if (method === 'auth.clear') {
          const document = structuredClone(current.document)
          document.servers[input.name].updatedAt = Math.max(Date.now(), (entry.updatedAt || 0) + 1)
          current = await this.commit(context, document, current.secrets)
          const catalogs = this.catalogs.get(key(current)) || {}
          delete catalogs[input.name]
          await writeToolCatalog(current.dataDir, catalogs).catch(() => {})
        } else await this.rememberCatalog(current, input.name, check)
        this.checks.set(`${key(context)}/${input.name}`, check)
        this.onCatalogChanged?.()
        return this.list(current, method === 'servers.inspect' ? {} : this.onChanged?.(context.appId) || {}, input.name)
      })
    } catch (error) {
      const message = safeError(error, [config])
      if (method !== 'servers.inspect' || context.signal?.aborted) throw new Error(message)
      return this.serial(async () => {
        this.assertCurrent(context)
        const current = await this.load(context)
        if (this.toolRevision(current, current.document.servers[input.name] || {}) !== this.toolRevision(prepared.provider, entry)) throw new Error('连接配置已变化，请重新检查。')
        this.checks.set(`${key(context)}/${input.name}`, { state: 'failed', tools: [], checkedAt: Date.now(), error: message })
        this.onCatalogChanged?.()
        return this.list(current)
      })
    }
  }
}
