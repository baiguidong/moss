export type CompactContextEntry = {
  id: string
  kind: 'summary' | 'preserved' | 'attachment' | 'hook'
  role: string
  content: unknown
}

/** A later capture must not masquerade as the first request after compaction. */
export function getPostCompactBoundaryId(messages: readonly any[]): string {
  const index = messages.findLastIndex(message => message.type === 'system' && message.subtype === 'compact_boundary')
  if (index < 0) return ''
  const boundary = messages[index]
  const context = boundary.compactMetadata?.context
  if (context?.version !== 1 || !Array.isArray(context.entries)) return ''
  const retained = new Set(context.entries.map((entry: CompactContextEntry) => entry.id))
  return messages.slice(index + 1).some(message => message.type === 'assistant' && !retained.has(message.uuid))
    ? '' : boundary.uuid
}

/** Capture only message payloads, never nested boundary metadata or mutable messages. */
export function buildCompactContext(result: {
  summaryMessages: readonly any[]
  messagesToKeep?: readonly any[]
  attachments: readonly any[]
  hookResults: readonly any[]
}): { version: 1; entries: CompactContextEntry[] } {
  const groups = [
    ['summary', result.summaryMessages], ['preserved', result.messagesToKeep ?? []],
    ['attachment', result.attachments], ['hook', result.hookResults],
  ] as const
  return { version: 1, entries: groups.flatMap(([kind, messages]) => messages.map(message => ({
    id: message.uuid,
    kind,
    role: message.message?.role ?? message.type,
    content: JSON.parse(JSON.stringify(message.message?.content ?? message.attachment ?? message.content ?? '')),
  }))) }
}
