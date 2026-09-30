/** Adapt Moss SDK/transcript entries to the cc-haha Trace view model contract. */
export type TraceMessageEntry = {
  id: string
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result'
  content: unknown
  timestamp: string
  toolUseResult?: unknown
  model?: string
  usage?: Record<string, number>
  usageKey?: string
  parentUuid?: string
  parentToolUseId?: string
  isSidechain?: boolean
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Keep transcript and desktop history separate: optimistic user UUIDs differ
 * from runtime UUIDs, while assistant/tool UUIDs can anchor the same turn. */
export function toTraceMessages(entries: unknown[], historyEntries?: unknown[]): TraceMessageEntry[] {
  const transcript = normalizeTraceMessages(entries)
  if (!historyEntries?.length) return transcript

  const history = normalizeTraceMessages(historyEntries, 'trace-live-message')
  const byId = new Map(transcript.map(message => [message.id, message]))
  const historyIds = new Set(history.map(message => message.id))
  const consumed = new Set(history.filter(message => byId.has(message.id)).map(message => message.id))
  const optimisticIds = new Set(historyEntries.flatMap((value, index) => {
    const entry = record(value)
    return entry?.type === 'user' && typeof entry.prompt === 'string' && !record(entry.message)
      ? [messageId(entry, index, 'trace-live-message')] : []
  }))
  const userPositions = history.flatMap((message, index) => message.type === 'user' ? [index] : [])
  const mirrored = new Set<string>()
  const timestampAnchors = new Map(transcript.map(message => [message.id, message.timestamp]))

  for (const [turnIndex, position] of userPositions.entries()) {
    const user = history[position]!
    if (byId.has(user.id) || !optimisticIds.has(user.id)) continue
    const nextPosition = userPositions[turnIndex + 1] ?? history.length
    const available = (candidate: TraceMessageEntry | undefined): candidate is TraceMessageEntry =>
      candidate?.type === 'user' && !candidate.isSidechain && !consumed.has(candidate.id) && !historyIds.has(candidate.id)
    let match: TraceMessageEntry | undefined

    // A shared response identifies its persisted user even if Moss prepended
    // workspace/resource context to the visible prompt.
    for (const response of history.slice(position + 1, nextPosition)) {
      let ancestor = byId.get(response.id)
      const visited = new Set<string>()
      while (ancestor && ancestor.type !== 'user' && !visited.has(ancestor.id)) {
        visited.add(ancestor.id)
        ancestor = ancestor.parentUuid ? byId.get(ancestor.parentUuid) : undefined
      }
      if (available(ancestor)) { match = ancestor; break }
    }

    // Before a response arrives, match one occurrence inside this send's time
    // window. Never collapse two real sends just because their text is equal.
    if (!match) {
      const text = userText(user.content)
      const end = history[nextPosition]?.timestamp
      match = text ? transcript.find(candidate => available(candidate)
        && userText(candidate.content) === text
        && candidate.timestamp >= user.timestamp
        && (!end || candidate.timestamp < end)) : undefined
    }
    if (match) {
      consumed.add(match.id)
      mirrored.add(user.id)
      timestampAnchors.set(user.id, match.timestamp)
    }
  }

  // SDK responses may have no timestamp. Inherit from the reconciled user or
  // shared response so live-only messages cannot fall into the preceding turn.
  const anchoredHistory = normalizeTraceMessages(historyEntries, 'trace-live-message', timestampAnchors)
  return [...transcript, ...anchoredHistory.filter(message => !byId.has(message.id) && !mirrored.has(message.id))]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

function messageId(entry: Record<string, unknown>, index: number, prefix: string): string {
  return typeof entry.uuid === 'string' ? entry.uuid
    : typeof entry.id === 'string' ? entry.id : `${prefix}-${index}`
}

function userText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  return content.flatMap(value => {
    const block = record(value)
    return block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []
  }).join('\n').trim()
}

function normalizeTraceMessages(
  entries: unknown[],
  idPrefix = 'trace-message',
  timestampAnchors?: ReadonlyMap<string, string>,
): TraceMessageEntry[] {
  const messages: TraceMessageEntry[] = []
  const seen = new Set<string>()
  let previousTimestamp = new Date(0).toISOString()
  for (const [index, value] of entries.entries()) {
    const entry = record(value)
    if (!entry) continue
    let type = entry.type as TraceMessageEntry['type']
    if (!['user', 'assistant', 'system', 'tool_use', 'tool_result'].includes(type)) continue
    const message = record(entry.message)
    let content = message?.content ?? entry.content ?? entry.prompt
    if (content === undefined) continue
    if (type === 'user' && Array.isArray(content) && content.some(block => record(block)?.type === 'tool_result')) {
      type = 'tool_result'
    }
    if (type === 'assistant' && Array.isArray(content) && content.some(block => record(block)?.type === 'tool_use')) {
      type = 'tool_use'
    }
    if (type === 'tool_result' && !Array.isArray(content)) {
      content = [{ type: 'tool_result', tool_use_id: entry.tool_use_id ?? entry.toolUseId, content, is_error: entry.is_error }]
    }
    const id = messageId(entry, index, idPrefix)
    const rawTimestamp = timestampAnchors?.get(id) ?? entry.timestamp ?? message?.timestamp
    const date = typeof rawTimestamp === 'string' || typeof rawTimestamp === 'number'
      ? new Date(rawTimestamp) : null
    const timestamp = date && Number.isFinite(date.getTime()) ? date.toISOString() : previousTimestamp
    previousTimestamp = timestamp
    if (seen.has(id)) continue
    seen.add(id)
    const model = message?.model ?? entry.model
    const usage = record(message?.usage ?? entry.usage)
    const usageKey = message?.id ?? entry.usageKey
    messages.push({
      id, type, content, timestamp,
      ...(entry.toolUseResult !== undefined ? { toolUseResult: entry.toolUseResult } : {}),
      ...(typeof model === 'string' ? { model } : {}),
      ...(usage ? { usage: Object.fromEntries(Object.entries(usage).filter((pair): pair is [string, number] => typeof pair[1] === 'number')) } : {}),
      ...(typeof usageKey === 'string' ? { usageKey } : {}),
      ...(typeof entry.parentUuid === 'string' ? { parentUuid: entry.parentUuid } : {}),
      ...(typeof entry.parent_tool_use_id === 'string' ? { parentToolUseId: entry.parent_tool_use_id }
        : typeof entry.parentToolUseId === 'string' ? { parentToolUseId: entry.parentToolUseId } : {}),
      ...(typeof entry.isSidechain === 'boolean' ? { isSidechain: entry.isSidechain } : {}),
    })
  }
  return messages
}
