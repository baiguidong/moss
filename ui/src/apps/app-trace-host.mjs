import { contractDefinition } from '../../../packages/app-sdk/src/host/contracts.mjs'
import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import path from 'node:path'
import { constants } from 'node:fs'

export const TRACE_APP_ID = 'moss.trace'
export const TRACE_PROTOCOL = 'moss.trace/v1'
export function createTraceProtocolDefinition() { return contractDefinition(TRACE_PROTOCOL) }

export class AppTraceHost {
  constructor({ mossHome, getRuntime, getCore, getSessions = () => [], log = () => {} }) {
    Object.assign(this, { mossHome, getRuntime, getCore, getSessions, log })
    this.queue = Promise.resolve()
    this.output = null
    this.closed = false
    this.pendingSessions = new Map()
    this.snapshotTask = null
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
    const valid = pkg?.manifest.host?.protocols?.includes(TRACE_PROTOCOL)
      && pkg.manifest.permissions?.includes('trace:capture') && this.active(instance.id)
    if (!valid) {
      if (this.output) { this.output = null; await (await this.getCore()).configureTraceOutput(this.mossHome, null) }
      return
    }
    const directory = runtime.appDataPath(runtime.dataDir, TRACE_APP_ID, 'instances', instance.id, 'trace')
    if (this.output?.directory === directory) return
    const core = await this.getCore()
    if (typeof core.configureTraceOutput !== 'function') throw new Error('请重新构建 Moss，当前运行时尚不支持 调用追踪。')
    await fs.mkdir(directory, { recursive: true, mode: 0o700 })
    const dataRoot = await fs.realpath(runtime.dataDir)
    const actual = await fs.realpath(directory)
    const relative = path.relative(dataRoot, actual)
    const expected = path.join(dataRoot, path.relative(runtime.dataDir, directory))
    if (relative.startsWith('..') || path.isAbsolute(relative) || actual !== expected) throw new Error('调用追踪 数据目录不能包含符号链接。')
    if (!this.active(instance.id)) return
    await core.configureTraceOutput(this.mossHome, { directory, isEnabled: () => this.active(instance.id) })
    this.output = { directory, instanceId: instance.id }
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
    const sessionId = record.underlyingSessionId || record.sessionId || record.id
    if (!sessionId || !/^[a-zA-Z0-9._-]{1,160}$/.test(sessionId)) return
    this.pendingSessions.set(sessionId, { record, output: this.output })
    if (!this.snapshotTask) {
      this.snapshotTask = Promise.resolve().then(async () => {
        try {
          while (this.pendingSessions.size) {
            const [identity, pending] = this.pendingSessions.entries().next().value
            this.pendingSessions.delete(identity)
            try {
              const core = await this.getCore()
              if (this.output !== pending.output || !this.active(pending.output.instanceId) || pending.record.deleted) continue
              await core.writeTraceSessionSnapshot(this.mossHome, identity, {
                schemaVersion: 1,
                session: { id: pending.record.id, title: pending.record.title || '未命名会话', projectPath: pending.record.workspace || '',
                  workDir: pending.record.workspace || null, parentSessionId: pending.record.parentSessionId || null },
                messages: core.toTraceMessages([], pending.record.history || []),
              })
            } catch (error) { this.log(error) }
          }
        } finally { this.snapshotTask = null }
      })
    }
    await this.snapshotTask
  }
  async getCompactionRequest(record, boundaryId) {
    if (record.agentMode === 'remote-direct') return { request: null, reason: '云端尚未提供此请求记录。' }
    const output = this.output
    if (!output || !this.active(output.instanceId)) return { request: null, reason: '未记录。请求记录需启用 调用追踪；已有会话无法补录。' }
    const sessionId = record.underlyingSessionId || record.sessionId || record.id
    if (!/^[a-zA-Z0-9._-]{1,160}$/.test(sessionId) || sessionId === '.' || sessionId === '..') throw new Error('Invalid session identity')
    const stream = createReadStream(path.join(output.directory, 'traces', `${sessionId}.jsonl`), { encoding: 'utf8' })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    let first = null
    try {
      for await (const line of lines) {
        let entry
        try { entry = JSON.parse(line) } catch { continue }
        const call = entry.type === 'call' ? entry.record : null
        if (call?.sessionId !== sessionId || call.metadata?.compactBoundaryId !== boundaryId) continue
        if (!first || call.id === first.id || call.startedAt < first.startedAt) first = call
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    finally { lines.close(); stream.destroy() }
    if (this.output !== output || !this.active(output.instanceId)) return { request: null, reason: '请求记录当前不可用。' }
    if (!first) return { request: null, reason: '未记录，或压缩后尚未发送模型请求。' }
    return { request: {
      id: first.id, model: first.model, startedAt: first.startedAt, status: first.status,
      content: first.request?.semantic?.request ?? first.request?.body?.preview ?? '',
      truncated: !first.request?.semantic && Boolean(first.request?.body?.truncated),
    } }
  }
  async status(context) {
    if (context.appId !== TRACE_APP_ID || !this.active(context.instanceId)) throw new Error('请先启用 调用追踪。')
    await this.refresh()
    if (this.output) await this.importLegacy(this.output.directory).catch(error => this.log(error))
    const core = await this.getCore()
    return core.traceOutputStatus(this.mossHome)
  }
  async beforeDeactivation(appId) {
    if (appId !== TRACE_APP_ID) return
    await this.queue
    if (!this.output && !this.snapshotTask) return
    this.output = null
    this.pendingSessions.clear()
    await (await this.getCore()).configureTraceOutput(this.mossHome, null)
    await this.snapshotTask
  }
  async close() {
    this.closed = true
    await this.beforeDeactivation(TRACE_APP_ID)
  }
}
