import { createReadStream } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { SessionRepository } from './model/repositories/session.js'
import { UsageRepository } from './model/repositories/usage.js'
import type { ModelUsageEvent, UsageOwner } from './usageTypes.js'

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export async function recordRunnerUsage(
  line: string,
  owner: UsageOwner & { sessionId: string },
  repository: UsageRepository,
): Promise<boolean> {
  let message: unknown
  try { message = JSON.parse(line) } catch { return false }
  if (!object(message) || message.type !== 'moss_usage') return false
  const event = message.event
  if (!object(event) || typeof event.eventId !== 'string' || !event.eventId || typeof event.occurredAt !== 'number') {
    throw new Error('Invalid model usage event from runner')
  }
  // Identity comes from the runner manifest, never from model output or a client.
  await repository.record(owner, owner.sessionId, event as ModelUsageEvent)
  return true
}

async function transcriptFiles(root: string): Promise<string[]> {
  let entries
  try { entries = await readdir(root, { withFileTypes: true }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...await transcriptFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
  }
  return files
}

export async function readHistoricalUsage(path: string, before: number, includeSidechains: boolean): Promise<{ events: ModelUsageEvent[]; incomplete: boolean }> {
  const events = new Map<string, ModelUsageEvent>()
  let incomplete = false
  const stream = createReadStream(path, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      let entry: unknown
      try { entry = JSON.parse(line) } catch { incomplete = true; continue }
      if (!object(entry) || entry.type !== 'assistant' || entry.forkedFrom || (!includeSidechains && entry.isSidechain)) continue
      const message = entry.message
      if (!object(message) || !object(message.usage) || message.model === '<synthetic>') continue
      const occurredAt = Date.parse(String(entry.timestamp ?? ''))
      if (!Number.isFinite(occurredAt) || occurredAt >= before) continue
      const eventId = typeof entry.requestId === 'string' && entry.requestId
        ? entry.requestId
        : typeof message.id === 'string' && message.id ? `message:${message.id}`
        : typeof entry.uuid === 'string' && entry.uuid ? `message:${entry.uuid}` : null
      if (!eventId) { incomplete = true; continue }
      const usage = message.usage
      const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : 0
      const event: ModelUsageEvent = {
        eventId, occurredAt, model: String(message.model || 'unknown'), querySource: 'transcript',
        inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens),
        cacheReadTokens: count(usage.cache_read_input_tokens), cacheWriteTokens: count(usage.cache_creation_input_tokens),
      }
      // One API response may contain several assistant text/tool blocks. Usage
      // is repeated or updated on those blocks; it must not be summed per block.
      const previous = events.get(eventId)
      if (previous) {
        for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'occurredAt'] as const) {
          event[key] = Math.max(previous[key], event[key])
        }
      }
      events.set(eventId, event)
    }
  } finally {
    lines.close()
    stream.destroy()
  }
  return { events: [...events.values()], incomplete }
}

export class UsageService {
  private pendingImports = new Map<string, Promise<boolean>>()
  private incompleteImports = new Map<string, number>()
  constructor(private readonly repository: UsageRepository, private readonly sessions: SessionRepository) {}

  async getOverview(owner: UsageOwner) {
    const incomplete = await this.importHistory(owner)
    return this.repository.getOverview(owner, incomplete)
  }

  private async importHistory(owner: UsageOwner): Promise<boolean> {
    const key = JSON.stringify([owner.orgId, owner.userId])
    const pending = this.pendingImports.get(key)
    if (pending) return pending
    if ((this.incompleteImports.get(key) ?? 0) > Date.now()) return true
    const run = this.importUserHistory(owner).then(incomplete => {
      if (incomplete) this.incompleteImports.set(key, Date.now() + 60_000)
      else this.incompleteImports.delete(key)
      return incomplete
    }).finally(() => this.pendingImports.delete(key))
    this.pendingImports.set(key, run)
    return run
  }

  private async importUserHistory(owner: UsageOwner): Promise<boolean> {
    if (await this.repository.hasImported(owner)) return false
    const { historyBefore } = await this.repository.getMetadata()
    const sessions = await this.sessions.listSessionRecords({ ...owner, includeDeleted: true })
    let incomplete = false
    for (const session of sessions) {
      if (session.createdAt >= historyBefore) continue
      let files: string[]
      try {
        files = [session.transcriptPath, ...await transcriptFiles(join(dirname(session.transcriptPath), session.transcriptSessionId, 'subagents'))]
      } catch {
        incomplete = true
        files = [session.transcriptPath]
      }
      for (const file of files) {
        let parsed: Awaited<ReturnType<typeof readHistoricalUsage>>
        try { parsed = await readHistoricalUsage(file, historyBefore, file !== session.transcriptPath) }
        catch { incomplete = true; continue }
        incomplete ||= parsed.incomplete
        for (let start = 0; start < parsed.events.length; start += 200) {
          await this.repository.db.transaction(async () => {
            for (const event of parsed.events.slice(start, start + 200)) {
              await this.repository.record(owner, session.sessionId, event)
            }
          })
        }
      }
    }
    if (!incomplete) await this.repository.markImported(owner)
    return incomplete
  }
}
