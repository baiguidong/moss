import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { getTraceScope } from './traceScope.js'
import { createTraceCallRecord, createTraceEventRecord, sanitizeTraceValue,
  type RecordTraceCallInput, type RecordTraceEventInput } from './traceRecord.js'

export type TraceCaptureAdapter = {
  recordCall(input: RecordTraceCallInput, options?: unknown): Promise<unknown>
  recordEvent(input: RecordTraceEventInput, options?: unknown): Promise<unknown>
}
type Output = {
  directory: string
  isEnabled: () => boolean
  active: boolean
  queuedBytes: number
  droppedRecords: number
  error: string | null
  queues: Map<string, Promise<void>>
  adapter: TraceCaptureAdapter
}
const outputs = new Map<string, Output | null>()
const MAX_QUEUED_BYTES = 16 * 1024 * 1024
let fallback: (() => TraceCaptureAdapter | null) | undefined

/** Only server entrypoints install a legacy provider. Desktop defaults to off. */
export function setTraceCaptureFallback(provider: (() => TraceCaptureAdapter | null) | undefined): void { fallback = provider }
function enabled(output: Output): boolean {
  try { return output.active && output.isEnabled() } catch { return false }
}
export function resolveTraceCapture(): TraceCaptureAdapter | null {
  const scope = getTraceScope()
  if (!outputs.has(scope)) return fallback?.() ?? null
  const output = outputs.get(scope)
  return output && enabled(output) ? output.adapter : null
}
function id(value: string): string {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(value) || value === '.' || value === '..') throw new Error('Invalid Trace session identity')
  return value
}
async function write(output: Output, relative: string, value: unknown, replace = false): Promise<void> {
  if (!enabled(output)) return
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`)
  if (output.queuedBytes + bytes.length > MAX_QUEUED_BYTES) {
    output.droppedRecords += 1
    output.error = 'Trace write queue is full'
    return
  }
  output.queuedBytes += bytes.length
  const file = path.join(output.directory, relative)
  const operation = (output.queues.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    if (!enabled(output)) return
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    if (!enabled(output)) return
    if (replace) {
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
        if (enabled(output)) await fs.rename(temporary, file)
      } finally { await fs.rm(temporary, { force: true }) }
    } else {
      // A line is the durable interchange unit. The App alone owns the index.
      await fs.appendFile(file, bytes, { mode: 0o600 })
    }
  }).catch(error => {
    output.droppedRecords += 1
    output.error = error instanceof Error ? error.message : String(error)
  }).finally(() => {
    output.queuedBytes -= bytes.length
    if (output.queues.get(file) === operation) output.queues.delete(file)
  })
  output.queues.set(file, operation)
  await operation
}

/** Revoke synchronously; drain before deleting App data or changing its output. */
export async function configureTraceOutput(scope: string, config: { directory: string; isEnabled?: () => boolean } | null): Promise<void> {
  const key = path.resolve(scope)
  const previous = outputs.get(key)
  if (previous) previous.active = false
  outputs.set(key, null)
  if (previous) await Promise.allSettled([...previous.queues.values()])
  if (!config) return
  if (!path.isAbsolute(config.directory)) throw new Error('Trace output directory must be absolute')
  const output: Output = {
    directory: path.resolve(config.directory), isEnabled: config.isEnabled ?? (() => true), active: true,
    queuedBytes: 0, droppedRecords: 0, error: null, queues: new Map(), adapter: {
      async recordCall(input) {
        if (!enabled(output)) return null
        const record = createTraceCallRecord(input)
        await write(output, `traces/${id(input.sessionId)}.jsonl`, { schemaVersion: 1, type: 'call', record })
        return record
      },
      async recordEvent(input) {
        if (!enabled(output)) return null
        const event = createTraceEventRecord(input)
        await write(output, `traces/${id(input.sessionId)}.jsonl`, { schemaVersion: 1, type: 'event', event })
        return event
      },
    },
  }
  outputs.set(key, output)
}
export async function writeTraceSessionSnapshot(scope: string, sessionId: string, snapshot: unknown): Promise<void> {
  const output = outputs.get(path.resolve(scope))
  if (!output || !enabled(output)) return
  await write(output, `sessions/${id(sessionId)}.json`, sanitizeTraceValue(snapshot), true)
}
export function traceOutputStatus(scope: string) {
  const output = outputs.get(path.resolve(scope))
  return { enabled: Boolean(output && enabled(output)), queuedBytes: output?.queuedBytes ?? 0,
    droppedRecords: output?.droppedRecords ?? 0, error: output?.error ?? null }
}
export async function drainTraceOutput(scope: string): Promise<void> {
  const output = outputs.get(path.resolve(scope))
  if (output) await Promise.allSettled([...output.queues.values()])
}
