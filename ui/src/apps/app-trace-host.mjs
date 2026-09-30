import fs from 'node:fs/promises'
import path from 'node:path'
import { constants } from 'node:fs'

export const TRACE_APP_ID = 'moss.trace'
export const TRACE_PROTOCOL = 'moss.trace/v1'
export function createTraceProtocolDefinition() {
  return { protocol: TRACE_PROTOCOL, methods: { status: { permission: 'trace:capture', validateInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Trace status takes no parameters')
    return input
  } } } }
}

/** The installation grants collection; an App process is never on the fetch path. */
export class AppTraceHost {
  constructor({ mossHome, getRuntime, getCore, getSessions = () => [], log = () => {} }) {
    Object.assign(this, { mossHome, getRuntime, getCore, getSessions, log })
    this.queue = Promise.resolve()
    this.output = null
    this.closed = false
  }
  active(instanceId) {
    const runtime = this.getRuntime()
    const installation = runtime?.installations.get(TRACE_APP_ID)
    const instance = runtime?.instances.get(instanceId)
    return !this.closed && installation?.enabled === true && installation.grants?.includes('trace:capture')
      && instance?.enabled === true && instance.appId === TRACE_APP_ID
  }
  refresh() {
    const next = this.queue.then(() => this.refreshNow())
    this.queue = next.catch(error => this.log(error))
    return next
  }
  async refreshNow() {
    const runtime = this.getRuntime()
    const instance = runtime?.instances.list(TRACE_APP_ID)?.[0]
    const pkg = instance && this.active(instance.id) ? await runtime.getActivePackage(TRACE_APP_ID).catch(() => null) : null
    const valid = pkg?.manifest.backend?.protocols?.includes(TRACE_PROTOCOL)
      && pkg.manifest.permissions?.includes('trace:capture') && this.active(instance.id)
    if (!valid) {
      if (this.output) { this.output = null; await (await this.getCore()).configureTraceOutput(this.mossHome, null) }
      return
    }
    const directory = runtime.appDataPath(runtime.dataDir, TRACE_APP_ID, 'instances', instance.id, 'trace')
    if (this.output?.directory === directory) return
    const core = await this.getCore()
    if (typeof core.configureTraceOutput !== 'function') throw new Error('请重新构建 Moss，当前运行时尚不支持 Trace App。')
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const dataRoot = await fs.realpath(runtime.dataDir)
    const actual = await fs.realpath(directory)
    const relative = path.relative(dataRoot, actual)
    const expected = path.join(dataRoot, path.relative(runtime.dataDir, directory))
    if (relative.startsWith('..') || path.isAbsolute(relative) || actual !== expected) throw new Error('Trace App 数据目录不能包含符号链接。')
    await this.importLegacy(directory)
    if (!this.active(instance.id)) return
    await core.configureTraceOutput(this.mossHome, { directory, isEnabled: () => this.active(instance.id) })
    this.output = { directory, instanceId: instance.id }
    // Persist session metadata beside the wire records; the App never reads Core DBs.
    await Promise.all([...this.getSessions()].map(record => this.recordSession(record)))
  }
  async importLegacy(directory) {
    const marker = path.join(directory, 'legacy-import-v1.json')
    if (await fs.stat(marker).catch(() => null)) return
    const source = path.join(this.mossHome, 'traces')
    const entries = await fs.readdir(source, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    await fs.mkdir(path.join(directory, 'traces'), { recursive: true, mode: 0o700 })
    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-zA-Z0-9._-]+\.jsonl$/.test(entry.name)) continue
      await fs.copyFile(path.join(source, entry.name), path.join(directory, 'traces', entry.name), constants.COPYFILE_EXCL)
        .catch(error => { if (error.code !== 'EEXIST') throw error })
    }
    await fs.writeFile(marker, JSON.stringify({ importedAt: new Date().toISOString() }), { mode: 0o600 })
  }
  async recordSession(record) {
    if (!this.output || !this.active(this.output.instanceId) || !record || record.agentMode === 'remote-direct' || record.deleted) return
    const core = await this.getCore()
    const sessionId = record.underlyingSessionId || record.sessionId || record.id
    if (!sessionId || !/^[a-zA-Z0-9._-]{1,160}$/.test(sessionId)) return
    await core.writeTraceSessionSnapshot(this.mossHome, sessionId, {
      schemaVersion: 1,
      session: { id: record.id, title: record.title || '未命名会话', projectPath: record.workspace || '',
        workDir: record.workspace || null, parentSessionId: record.parentSessionId || null },
      messages: core.toTraceMessages([], record.history || []),
    })
  }
  async status(context) {
    if (context.appId !== TRACE_APP_ID || !this.active(context.instanceId)) throw new Error('请先启用 Trace App。')
    await this.refresh()
    const core = await this.getCore()
    return core.traceOutputStatus(this.mossHome)
  }
  async beforeDeactivation(appId) {
    if (appId !== TRACE_APP_ID) return
    await this.queue
    this.output = null
    await (await this.getCore()).configureTraceOutput(this.mossHome, null)
  }
  async close() {
    this.closed = true
    await this.beforeDeactivation(TRACE_APP_ID)
  }
}
