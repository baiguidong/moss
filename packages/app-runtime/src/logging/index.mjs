import fsp from 'node:fs/promises'
import path from 'node:path'

const SENSITIVE_PATTERN = /\b(authorization|password|passwd|secret|token|api[_-]?key|access[_-]?key|code)\b\s*[:=]\s*([^\s,;]+)/gi

function redactString(value, secretValues = []) {
  let result = String(value).replace(SENSITIVE_PATTERN, '$1=[REDACTED]')
  for (const secret of secretValues.filter((item) => typeof item === 'string' && item.length > 0)) {
    result = result.split(secret).join('[REDACTED]')
  }
  return result
}

export function redactAppValue(value, secretValues = []) {
  if (typeof value === 'string') return redactString(value, secretValues)
  if (Array.isArray(value)) return value.map((item) => redactAppValue(item, secretValues))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /password|secret|token|credential|api.?key|access.?key/i.test(key)
        ? '[REDACTED]'
        : redactAppValue(item, secretValues),
    ]))
  }
  return value
}

export class AppLogStore {
  constructor(options) {
    this.logsDir = path.resolve(options.logsDir)
    this.maxFileBytes = options.maxFileBytes || 2 * 1024 * 1024
    this.maxFiles = options.maxFiles || 5
    this.secretProvider = options.secretProvider || (() => [])
    this.queues = new Map()
  }

  logPath(appId, instanceId) {
    return path.join(this.logsDir, appId, `${encodeURIComponent(instanceId)}.jsonl`)
  }

  append(entry) {
    const key = `${entry.appId}:${entry.instanceId}`
    const operation = (this.queues.get(key) || Promise.resolve()).then(async () => {
      const filePath = this.logPath(entry.appId, entry.instanceId)
      await fsp.mkdir(path.dirname(filePath), { recursive: true })
      await this.rotateIfNeeded(filePath)
      const secrets = entry.redacted ? [] : await this.secretProvider(entry.appId, entry.instanceId)
      const { redacted: _redacted, ...safeEntry } = entry
      const record = redactAppValue({ timestamp: Date.now(), level: 'info', ...safeEntry }, secrets)
      await fsp.appendFile(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 })
      return record
    })
    const tail = operation.catch(() => {})
    this.queues.set(key, tail)
    tail.finally(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    return operation
  }

  async rotateIfNeeded(filePath) {
    let size = 0
    try { size = (await fsp.stat(filePath)).size } catch {}
    if (size < this.maxFileBytes) return
    await fsp.rm(`${filePath}.${this.maxFiles}`, { force: true })
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      try { await fsp.rename(`${filePath}.${index}`, `${filePath}.${index + 1}`) } catch {}
    }
    try { await fsp.rename(filePath, `${filePath}.1`) } catch {}
  }

  async list(appId, instanceId, options = {}) {
    const limit = Math.max(1, Math.min(Number(options.limit) || 500, 5000))
    const filePath = this.logPath(appId, instanceId)
    const paths = []
    for (let index = this.maxFiles; index >= 1; index -= 1) paths.push(`${filePath}.${index}`)
    paths.push(filePath)
    const parts = await Promise.all(paths.map(async (candidate) => {
      try { return await fsp.readFile(candidate, 'utf8') } catch { return '' }
    }))
    return parts.join('').trim().split('\n').filter(Boolean).slice(-limit).flatMap((line) => {
      try { return [JSON.parse(line)] } catch { return [] }
    })
  }

  async removeApp(appId) {
    await fsp.rm(path.join(this.logsDir, appId), { recursive: true, force: true })
  }
}
