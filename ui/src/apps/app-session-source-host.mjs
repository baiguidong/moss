import { contractDefinition } from '../../../packages/app-sdk/src/host/contracts.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { redactSessionSource } from './session-source-redaction.mjs'

export const SESSION_SOURCE_PROTOCOL = 'moss.session-source/v1'
export const SESSION_SOURCE_PERMISSION = 'session-source:read'
export const createSessionSourceProtocolDefinition = () => contractDefinition(SESSION_SOURCE_PROTOCOL)

export function sessionSourceFileName(sessionId) {
  return `session-${createHash('sha256').update(sessionId).digest('hex')}.json`
}

/** A permission-gated, per-session export for Apps that inspect local history. */
export class AppSessionSourceHost {
  constructor({ mossHome, getRuntime, getSessions, getSessionSnapshot, getSessionRevision,
    openSession = () => {}, log = () => {} }) {
    Object.assign(this, { mossHome, getRuntime, getSessions, getSessionSnapshot, getSessionRevision, openSession, log })
    this.queue = Promise.resolve()
    this.epochs = new Map()
    this.exports = new Map()
    this.closed = false
  }
  active(context, permission = SESSION_SOURCE_PERMISSION) {
    const runtime = this.getRuntime()
    const installation = runtime?.installations.get(context.appId)
    const instance = runtime?.instances.get(context.instanceId)
    return !this.closed && installation?.enabled === true && installation.grants?.includes(permission)
      && instance?.enabled === true && instance.appId === context.appId
  }
  localSessions() {
    return this.getSessions().filter(session => session && session.agentMode !== 'remote-direct')
  }
  descriptor(session) {
    return {
      id: session.id,
      revision: this.getSessionRevision(session),
      updatedAt: Number(session.updatedAt) || 0,
      historyLength: Array.isArray(session.history) ? session.history.length : 0,
      busy: Boolean(session.busy),
    }
  }
  async root(context) {
    const runtime = this.getRuntime()
    if (!this.active(context)) throw new Error('App 会话读取权限已变更。')
    const pkg = await runtime.getActivePackage(context.appId)
    if (!pkg.manifest.host?.protocols?.includes(SESSION_SOURCE_PROTOCOL)
      || !pkg.manifest.permissions?.includes(SESSION_SOURCE_PERMISSION)) throw new Error('App 未声明会话读取能力。')
    const directory = runtime.appDataPath(runtime.dataDir, context.appId, 'instances', context.instanceId, 'session-source')
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const dataRoot = await fs.realpath(runtime.dataDir)
    const actual = await fs.realpath(directory)
    if (actual !== path.join(dataRoot, path.relative(runtime.dataDir, directory))) throw new Error('会话导出目录不能包含符号链接。')
    return actual
  }
  handle(method, input, context) {
    const definition = createSessionSourceProtocolDefinition().methods[method]
    if (!definition) throw new Error('Unknown session source capability')
    definition.validateInput(input)
    if (!this.active(context, definition.permission)) throw new Error('App 会话权限已变更。')
    if (method === 'session.list') return { sessions: this.localSessions().map(session => this.descriptor(session)) }
    if (method === 'session.open') {
      if (!this.localSessions().some(session => session.id === input.sessionId)) throw new Error('对应本地会话不存在。')
      this.openSession(input)
      return { opened: true }
    }
    const epoch = this.epochs.get(context.appId) || 0
    const current = () => !this.closed && epoch === (this.epochs.get(context.appId) || 0) && this.active(context)
    const next = this.queue.then(async () => {
      if (!current()) throw new Error('App 会话读取权限已变更。')
      const session = this.localSessions().find(entry => entry.id === input.sessionId)
      if (!session) throw new Error('对应本地会话不存在。')
      const descriptor = this.descriptor(session)
      const directory = await this.root(context)
      const fileName = sessionSourceFileName(session.id)
      const file = path.join(directory, fileName)
      const cacheKey = `${context.appId}:${context.instanceId}:${session.id}`
      if (this.exports.get(cacheKey) !== descriptor.revision || !await fs.stat(file).catch(() => null)) {
        const snapshot = redactSessionSource({ ...this.getSessionSnapshot(session), mossHome: this.mossHome })
        const temporary = `${file}.${randomUUID()}.tmp`
        try {
          await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' })
          if (!current()) throw new Error('App 会话读取权限已变更。')
          await fs.rename(temporary, file)
          if (!current()) { await fs.rm(file, { force: true }); throw new Error('App 会话读取权限已变更。') }
          this.exports.set(cacheKey, descriptor.revision)
        } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
      }
      if (!current()) throw new Error('App 会话读取权限已变更。')
      return { sessionId: session.id, revision: descriptor.revision, fileName }
    })
    this.queue = next.catch(() => {})
    return next
  }
  async eventRoot(context) {
    const directory = await this.root(context)
    const events = path.join(directory, 'events')
    await fs.mkdir(events, { recursive: true, mode: 0o700 })
    if (await fs.realpath(events) !== path.join(directory, 'events')) throw new Error('会话事件目录不能包含符号链接。')
    return events
  }
  async writeEvent(file, event, current) {
    const temporary = `${file}.${randomUUID()}.tmp`
    try {
      await fs.writeFile(temporary, JSON.stringify(redactSessionSource(event)), { mode: 0o600, flag: 'wx' })
      if (!current()) throw new Error('App 会话读取权限已变更。')
      await fs.rename(temporary, file)
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
  }
  recordEvent(payload) {
    const runtime = this.getRuntime()
    if (!runtime || this.closed) return Promise.resolve(null)
    const contexts = runtime.installations.list()
      .filter(item => item.enabled && item.grants?.includes(SESSION_SOURCE_PERMISSION))
      .flatMap(item => runtime.instances.list(item.appId).filter(instance => instance.enabled)
        .map(instance => ({ appId: item.appId, instanceId: instance.id })))
    if (!contexts.length) return Promise.resolve(null)
    const id = randomUUID()
    const event = { ...payload, id, createdAt: Date.now(), schemaVersion: 1 }
    const next = this.queue.then(async () => {
      const tickets = []
      for (const context of contexts) {
        const epoch = this.epochs.get(context.appId) || 0
        const current = () => !this.closed && epoch === (this.epochs.get(context.appId) || 0) && this.active(context)
        if (!current()) continue
        try {
          const events = await this.eventRoot(context)
          await this.writeEvent(path.join(events, `${id}.json`), event, current)
          tickets.push({ context, epoch, id })
        } catch (error) { this.log(error) }
      }
      return tickets.length ? tickets : null
    })
    this.queue = next.catch(() => {})
    return next
  }
  updateEvent(tickets, details) {
    if (!Array.isArray(tickets) || !tickets.length) return Promise.resolve(false)
    const next = this.queue.then(async () => {
      let updated = false
      for (const { context, epoch, id } of tickets) {
        const current = () => !this.closed && epoch === (this.epochs.get(context.appId) || 0) && this.active(context)
        if (!current()) continue
        try {
          const events = await this.eventRoot(context)
          const file = path.join(events, `${id}.json`)
          const event = JSON.parse(await fs.readFile(file, 'utf8'))
          await this.writeEvent(file, { ...event, details }, current)
          updated = true
        } catch (error) { this.log(error) }
      }
      return updated
    })
    this.queue = next.catch(() => {})
    return next
  }
  async beforeDeactivation(appId) {
    this.epochs.set(appId, (this.epochs.get(appId) || 0) + 1)
    await this.queue
    for (const key of this.exports.keys()) if (key.startsWith(`${appId}:`)) this.exports.delete(key)
  }
  async close() { this.closed = true; await this.queue; this.exports.clear() }
}
