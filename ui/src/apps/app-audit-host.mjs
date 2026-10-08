import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync, backup } from 'node:sqlite'

export const AUDIT_APP_ID = 'moss.audit'
export const AUDIT_PROTOCOL = 'moss.audit/v1'

function validate(input, fields, required = []) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected an object')
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Unknown audit capability field')
  for (const key of fields) {
    if (input[key] === undefined && !required.includes(key)) continue
    if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > (key === 'details' ? 16000 : 4000)) throw new Error(`Invalid ${key}`)
  }
  return input
}
export function createAuditProtocolDefinition() {
  return { protocol: AUDIT_PROTOCOL, methods: {
    'source.capture': { permission: 'audit:read', validateInput: input => validate(input, []) },
    'session.open': { permission: 'audit:navigate', validateInput: input => validate(input, ['sessionId', 'toolUseId'], ['sessionId']) },
    'notification.publish': { permission: 'audit:notify', validateInput: input => {
      validate(input, ['id', 'severity', 'title', 'message', 'details'], ['id', 'severity', 'title', 'message'])
      if (!['info', 'warning', 'error'].includes(input.severity)) throw new Error('Invalid severity')
      return input
    } },
  } }
}

/** Redact before data leaves the Host, preserving tool names, paths and message structure. */
export function redactAuditSource(value, key = '', seen = new WeakSet()) {
  if (/token|secret|password|authorization|cookie|api[_-]?key/i.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return value
    .replace(/([?&](?:access_token|refresh_token|token|code|client_secret|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:authorization|cookie)\b\s*[:=]\s*)[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  const result = Array.isArray(value) ? value.map(item => redactAuditSource(item, '', seen))
    : Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactAuditSource(item, name, seen)]))
  seen.delete(value)
  return result
}

/** Owns source export only. Rules, analysis and the live audit database belong to the App. */
export class AppAuditHost {
  constructor({ mossHome, getRuntime, getSessions, openSession = () => {}, notify = () => {} }) {
    Object.assign(this, { mossHome, getRuntime, getSessions, openSession, notify })
    this.queue = Promise.resolve()
    this.epoch = 0
    this.paused = false
    this.closed = false
  }
  active(instanceId) {
    const runtime = this.getRuntime()
    const installation = runtime?.installations.get(AUDIT_APP_ID)
    const instance = runtime?.instances.get(instanceId)
    return !this.closed && !this.paused && installation?.enabled === true && installation.grants?.includes('audit:read')
      && instance?.enabled === true && instance.appId === AUDIT_APP_ID
  }
  serialize(operation) {
    const next = this.queue.then(operation)
    this.queue = next.catch(() => {})
    return next
  }
  async root(instanceId) {
    const runtime = this.getRuntime()
    if (!this.active(instanceId)) throw new Error('请启用审计 App 并授予会话读取权限。')
    const pkg = await runtime.getActivePackage(AUDIT_APP_ID)
    if (!pkg.manifest.backend?.protocols?.includes(AUDIT_PROTOCOL) || !pkg.manifest.permissions?.includes('audit:read')) throw new Error('审计 App 未声明读取能力。')
    const directory = runtime.appDataPath(runtime.dataDir, AUDIT_APP_ID, 'instances', instanceId)
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const dataRoot = await fs.realpath(runtime.dataDir)
    const actual = await fs.realpath(directory)
    if (actual !== path.join(dataRoot, path.relative(runtime.dataDir, directory))) throw new Error('审计数据目录不能包含符号链接。')
    for (const name of ['source', 'events']) {
      const target = path.join(directory, name)
      await fs.mkdir(target, { recursive: true, mode: 0o700 })
      if (await fs.realpath(target) !== path.join(actual, name)) throw new Error('审计数据目录不能包含符号链接。')
    }
    return directory
  }
  async write(directory, name, value, current) {
    const file = path.join(directory, name)
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
      if (!current()) throw new Error('审计 App 授权已变更。')
      await fs.rename(temporary, file)
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  async importLegacy(directory, current) {
    const marker = path.join(directory, 'legacy-import-v1.json')
    if (await fs.lstat(marker).catch(() => null)) return
    const target = path.join(directory, 'audit.db')
    const source = path.join(this.mossHome, 'audit.db')
    const legacy = await fs.lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (legacy?.isSymbolicLink()) throw new Error('旧审计数据库不能是符号链接。')
    if (legacy?.isFile() && !await fs.lstat(target).catch(() => null)) {
      const temporary = `${target}.${randomUUID()}.tmp`
      const database = new DatabaseSync(source, { readOnly: true })
      try {
        await backup(database, temporary)
        await fs.chmod(temporary, 0o600)
        if (!current()) throw new Error('审计 App 授权已变更。')
        await fs.rename(temporary, target)
      } finally { database.close(); await fs.rm(temporary, { force: true }).catch(() => {}) }
    }
    await this.write(directory, 'legacy-import-v1.json', { schemaVersion: 1, imported: Boolean(legacy), at: Date.now() }, current)
  }
  handle(method, input, context) {
    if (context.appId !== AUDIT_APP_ID) throw new Error('此能力仅供审计 App 使用。')
    const definition = createAuditProtocolDefinition().methods[method]
    if (!definition) throw new Error('Unknown audit capability')
    definition.validateInput(input)
    if (!this.active(context.instanceId)) throw new Error('审计 App 未启用。')
    if (method === 'session.open') {
      if (!this.getSessions().some(session => session.id === input.sessionId && session.agentMode !== 'remote-direct')) throw new Error('对应本地会话不存在。')
      this.openSession(input)
      return { opened: true }
    }
    if (method === 'notification.publish') {
      this.notify({ severity: input.severity, source: '审计中心', title: input.title, message: input.message, details: input.details }, { id: `audit:${input.id}` })
      return { delivered: true }
    }
    const epoch = this.epoch
    const current = () => epoch === this.epoch && this.active(context.instanceId)
    return this.serialize(async () => {
      if (!current()) throw new Error('审计 App 授权已变更。')
      const directory = await this.root(context.instanceId)
      await this.importLegacy(directory, current)
      const sessions = this.getSessions().filter(session => session && session.agentMode !== 'remote-direct')
      const capturedAt = Date.now()
      await this.write(directory, 'source/snapshot.json', redactAuditSource({ schemaVersion: 1, capturedAt, mossHome: this.mossHome, sessions }), current)
      return { schemaVersion: 1, capturedAt, sessionCount: sessions.length }
    })
  }
  recordEvent(payload) {
    const instance = this.getRuntime()?.instances.list(AUDIT_APP_ID)?.[0]
    if (!instance || !this.active(instance.id)) return Promise.resolve(null)
    const epoch = this.epoch
    const current = () => epoch === this.epoch && this.active(instance.id)
    return this.serialize(async () => {
      const directory = await this.root(instance.id)
      const event = redactAuditSource({ ...payload, id: randomUUID(), createdAt: Date.now(), schemaVersion: 1 })
      await this.write(directory, `events/${event.id}.json`, event, current)
      return { id: event.id, instanceId: instance.id, epoch }
    })
  }
  updateEvent(ticket, details) {
    if (!ticket || ticket.epoch !== this.epoch || !this.active(ticket.instanceId)) return Promise.resolve(false)
    const current = () => ticket.epoch === this.epoch && this.active(ticket.instanceId)
    return this.serialize(async () => {
      const directory = await this.root(ticket.instanceId)
      const name = `events/${ticket.id}.json`
      const event = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'))
      await this.write(directory, name, { ...event, details: redactAuditSource(details) }, current)
      return true
    })
  }
  refresh() { if (!this.closed) this.paused = false }
  async beforeDeactivation(appId) {
    if (appId !== AUDIT_APP_ID) return
    this.paused = true
    this.epoch += 1
    await this.queue
  }
  async close() { this.closed = true; await this.beforeDeactivation(AUDIT_APP_ID) }
}
