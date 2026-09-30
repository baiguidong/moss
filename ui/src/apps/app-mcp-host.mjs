import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { writePrivateFileAtomic } from '../../../shared/security/credential-crypto.mjs'
import { isValidMcpServerName, normalizeMcpStore, validateMcpServerConfig } from '../desktop-mcp-settings.mjs'

export const MCP_PROTOCOL = 'moss.mcp/v1'
export const MCP_METHODS = ['servers.list', 'servers.save', 'servers.remove', 'servers.set-enabled', 'servers.inspect', 'auth.start', 'auth.clear']
const MAX_SERVERS = 100
const SECRET_FIELD = 'mcpSecrets'
const permissions = { 'servers.list': 'mcp:read', 'servers.inspect': 'mcp:connect', 'auth.start': 'mcp:auth', 'auth.clear': 'mcp:auth' }

function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('参数格式不正确。')
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('包含不支持的参数。')
  return value
}
export function validateMcpHostInput(method, value) {
  if (!MCP_METHODS.includes(method)) throw new Error('不支持的 MCP 操作。')
  const keys = method === 'servers.list' ? [] : method === 'servers.save' ? ['name', 'previousName', 'enabled', 'config'] : method === 'servers.set-enabled' ? ['name', 'enabled'] : ['name']
  record(value, keys)
  if (['__proto__', 'constructor', 'prototype'].includes(value.name) || ['__proto__', 'constructor', 'prototype'].includes(value.previousName)) throw new Error('请使用其他服务名称。')
  if (method !== 'servers.list' && (!isValidMcpServerName(value.name) || value.name.length > 64)) throw new Error('服务名称只能包含字母、数字、连字符和下划线，最多 64 个字符。')
  if (method === 'servers.save') {
    if (value.previousName !== undefined && (!isValidMcpServerName(value.previousName) || value.previousName.length > 64)) throw new Error('原服务名称无效。')
    validateMcpServerConfig(value.config)
    if (Buffer.byteLength(JSON.stringify(value.config)) > 64 * 1024) throw new Error('服务配置超过 64 KB。')
  }
  if (['servers.save', 'servers.set-enabled'].includes(method) && typeof value.enabled !== 'boolean') throw new Error('启用状态无效。')
  return value
}
export function createMcpProtocolDefinition() {
  return { protocol: MCP_PROTOCOL, methods: Object.fromEntries(MCP_METHODS.map(method => [method, {
    permission: permissions[method] || 'mcp:manage', validateInput: input => validateMcpHostInput(method, input),
  }])) }
}
function key(context) { return `${context.appId}/${context.instanceId}` }
function runtimeName(appId, name) { return appId === 'moss.mcp' ? name : `${appId.replace(/[^a-zA-Z0-9_]/g, '_')}__${name}` }
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

/** Host-owned registry. MCP transport and tool execution remain in the agent runtime. */
export class AppMcpHost {
  constructor({ getRuntime, readLegacy, clearLegacy, onChanged, inspect, authenticate, clearAuth, reservedName = () => false }) {
    Object.assign(this, { getRuntime, readLegacy, clearLegacy, onChanged, inspect, authenticate, clearAuth, reservedName })
    this.providers = new Map()
    this.checks = new Map()
    this.queue = Promise.resolve()
  }
  serial(operation) {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => {})
    return pending
  }
  current(provider) {
    const runtime = this.getRuntime()
    const installation = runtime?.installations.get(provider.appId)
    const instance = runtime?.instances.get(provider.instanceId)
    return Boolean(installation?.enabled && instance?.enabled && instance.appId === provider.appId
      && installation.activeVersion === provider.version)
  }
  active(provider) {
    const grants = this.getRuntime()?.installations.get(provider.appId)?.grants || []
    return this.current(provider) && grants.includes('mcp:manage') && grants.includes('mcp:connect')
  }
  assertCurrent(context) {
    if (context.signal?.aborted) throw new Error('操作已取消。')
    if (!this.current(context)) throw new Error('请先启用应用。')
    if (context.permission && !this.getRuntime().installations.get(context.appId)?.grants?.includes(context.permission)) throw new Error('请在应用管理中授予此操作需要的 MCP 权限。')
  }
  async load(context) {
    const file = path.join(context.dataDir, 'mcp-servers.json')
    let document
    try { document = JSON.parse(await fs.readFile(file, 'utf8')) }
    catch (error) { if (error.code !== 'ENOENT') throw error; document = { version: 1, servers: {} } }
    if (document.version !== 1 || !document.servers || typeof document.servers !== 'object' || Array.isArray(document.servers)) throw new Error('MCP 配置无法读取，请恢复备份后重试。')
    const credentials = await this.getRuntime().credentials.get(context.appId, context.instanceId)
    const secrets = decodeSecrets(credentials)
    const provider = { ...context, signal: undefined, document, file, secrets }
    this.providers.set(key(context), provider)
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
  encode(config, enabled, secrets) {
    const stored = structuredClone(config), secretId = randomUUID(), values = {}
    for (const field of ['env', 'headers']) {
      if (!stored[field]) continue
      values[field] = stored[field]
      stored[field] = Object.fromEntries(Object.keys(stored[field]).map(name => [name, '']))
    }
    secrets[secretId] = values
    return { config: stored, enabled, updatedAt: Date.now(), secretId }
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
    this.onChanged?.()
    return next
  }
  async refresh() {
    return this.serial(async () => {
      const runtime = this.getRuntime()
      if (!runtime) return
      const current = new Set()
      for (const installation of runtime.installations.list()) {
        const pkg = await runtime.getActivePackage(installation.appId).catch(() => null)
        if (!pkg?.manifest.backend?.protocols?.includes(MCP_PROTOCOL) || !pkg.manifest.permissions?.includes('mcp:manage') || !pkg.manifest.permissions?.includes('mcp:connect')) continue
        for (const instance of runtime.instances.list(installation.appId)) {
          const context = { appId: installation.appId, instanceId: instance.id, version: installation.activeVersion,
            dataDir: runtime.appDataPath(runtime.dataDir, installation.appId, 'instances', instance.id) }
          current.add(key(context))
          const provider = await this.load(context)
          if (this.active(context)) await this.migrate(context, provider)
        }
      }
      for (const id of this.providers.keys()) if (!current.has(id)) this.providers.delete(id)
    })
  }
  enabledServers() {
    const result = {}
    for (const provider of this.providers.values()) {
      if (!this.active(provider)) continue
      for (const [name, entry] of Object.entries(provider.document.servers)) {
        const config = restoreConfig(entry, provider.secrets)
        if (entry.enabled && config) result[runtimeName(provider.appId, name)] = config
      }
    }
    return result
  }
  findServer(name) {
    for (const provider of this.providers.values()) {
      if (!this.active(provider)) continue
      for (const [localName, entry] of Object.entries(provider.document.servers)) {
        if (runtimeName(provider.appId, localName) !== name) continue
        const config = restoreConfig(entry, provider.secrets)
        return config ? { ...entry, config, provider, localName } : null
      }
    }
    return null
  }
  hasApp(appId) { return [...this.providers.values()].some(provider => provider.appId === appId) }
  list(provider, extra = {}, focusName = '') {
    let budget = 400 * 1024
    const checks = new Map()
    const names = Object.keys(provider.document.servers).sort((a, b) => Number(b === focusName) - Number(a === focusName))
    for (const name of names) {
      const check = this.checks.get(`${key(provider)}/${name}`)
      if (!check) continue
      const tools = []
      for (const tool of check.tools || []) {
        const bytes = Buffer.byteLength(JSON.stringify(tool)) + 1
        if (bytes > budget) break
        tools.push(tool); budget -= bytes
      }
      checks.set(name, { ...check, tools, truncated: check.truncated || tools.length < (check.tools?.length || 0) })
    }
    return { servers: Object.entries(provider.document.servers).map(([name, entry]) => ({
      name, enabled: entry.enabled, config: entry.config, updatedAt: entry.updatedAt,
      credentialsMissing: !restoreConfig(entry, provider.secrets),
      check: checks.get(name) || null,
    })), ...extra }
  }
  assertUnique(provider, name, previousName) {
    if (name !== previousName && provider.document.servers[name]) throw new Error('已有同名服务，请使用其他名称。')
    const target = runtimeName(provider.appId, name).replaceAll('-', '_')
    for (const other of this.providers.values()) {
      for (const localName of Object.keys(other.document.servers)) {
        if (key(other) === key(provider) && localName === previousName) continue
        if (runtimeName(other.appId, localName).replaceAll('-', '_') === target) throw new Error('该名称会与其他 MCP 工具标识冲突，请使用其他名称。')
      }
    }
    if (this.reservedName(runtimeName(provider.appId, name))) throw new Error('该名称已被连接器使用，请使用其他名称。')
  }
  async handle(method, raw, context) {
    const input = validateMcpHostInput(method, raw)
    context = { ...context, permission: permissions[method] || 'mcp:manage' }
    const prepared = await this.serial(async () => {
      this.assertCurrent(context)
      let provider = await this.migrate(context, await this.load(context))
      if (method === 'servers.list') return { result: this.list(provider) }
      const previousName = input.previousName || input.name
      const entry = provider.document.servers[previousName]
      if (method !== 'servers.save' && !entry) throw new Error('服务不存在，请刷新后重试。')
      if (['servers.inspect', 'auth.start', 'auth.clear'].includes(method)) {
        const config = restoreConfig(entry, provider.secrets)
        if (!config) throw new Error('服务凭据已清除，请编辑连接并重新填写。')
        return { provider, entry, config }
      }
      const document = structuredClone(provider.document), secrets = { ...provider.secrets }
      if (method === 'servers.save') {
        if (input.previousName && !entry) throw new Error('服务已被删除，请刷新后重试。')
        this.assertUnique(provider, input.name, input.previousName)
        if (!entry && Object.keys(document.servers).length >= MAX_SERVERS) throw new Error(`最多添加 ${MAX_SERVERS} 个服务。`)
        const config = validateMcpServerConfig(input.config)
        const previous = entry && restoreConfig(entry, secrets)
        for (const field of ['env', 'headers']) for (const name of Object.keys(config[field] || {})) {
          if (config[field][name] === '' && previous?.[field]?.[name] !== undefined) config[field][name] = previous[field][name]
        }
        if (input.previousName && input.previousName !== input.name) delete document.servers[input.previousName]
        document.servers[input.name] = this.encode(config, input.enabled, secrets)
      } else if (method === 'servers.remove') delete document.servers[input.name]
      else document.servers[input.name] = { ...entry, enabled: input.enabled, updatedAt: Date.now() }
      provider = await this.commit(context, document, secrets)
      this.checks.delete(`${key(context)}/${previousName}`)
      this.checks.delete(`${key(context)}/${input.name}`)
      return { result: this.list(provider, this.onChanged?.() || {}) }
    })
    if (prepared.result) return prepared.result
    const { config, entry } = prepared, name = runtimeName(context.appId, input.name)
    try {
      let check
      if (method === 'servers.inspect') check = await this.inspect(name, config, context.signal)
      else {
        if (!['http', 'sse'].includes(config.type)) throw new Error('本地进程连接不需要浏览器授权。')
        if (method === 'auth.start') await this.authenticate(name, config, context.signal)
        else await this.clearAuth(name, config, context.signal)
        check = { state: method === 'auth.start' ? 'authorized' : 'unchecked', tools: [], checkedAt: Date.now() }
      }
      return await this.serial(async () => {
        this.assertCurrent(context)
        const current = await this.load(context)
        if (current.document.servers[input.name]?.secretId !== entry.secretId) throw new Error('连接配置已变化，请重新检查。')
        this.checks.set(`${key(context)}/${input.name}`, check)
        return this.list(current, method === 'servers.inspect' ? {} : this.onChanged?.() || {}, input.name)
      })
    } catch (error) {
      const message = safeError(error, [config])
      if (method !== 'servers.inspect' || context.signal?.aborted) throw new Error(message)
      return this.serial(async () => {
        this.assertCurrent(context)
        const current = await this.load(context)
        if (current.document.servers[input.name]?.secretId !== entry.secretId) throw new Error('连接配置已变化，请重新检查。')
        this.checks.set(`${key(context)}/${input.name}`, { state: 'failed', tools: [], checkedAt: Date.now(), error: message })
        return this.list(current)
      })
    }
  }
}
