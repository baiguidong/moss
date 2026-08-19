import { dirname, join } from 'path'
import { readJSONLFile } from './lib/json.js'
import {
  isTranscriptMessage,
  type TranscriptEntry,
} from './lib/transcript.js'
import { getSessionUsageSummaryFromTranscriptPath } from './usage.js'
import type { SessionRecord } from './types.js'

function latestMetadata(
  entries: TranscriptEntry[],
  type: string,
  valueKey: string,
  sessionId: string | undefined,
): string | undefined {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (
      entry?.type === type &&
      (!sessionId || entry.sessionId === sessionId) &&
      typeof entry[valueKey] === 'string'
    ) {
      return entry[valueKey] as string
    }
  }
  return undefined
}

function buildConversationChain(entries: TranscriptEntry[]): TranscriptEntry[] {
  const messages = entries.filter(
    entry => isTranscriptMessage(entry) && !entry.isSidechain && typeof entry.uuid === 'string',
  )
  if (messages.length === 0) return []

  let last = messages[0]!
  let latestTime = Date.parse(last.timestamp || '') || 0
  for (const message of messages.slice(1)) {
    const timestamp = Date.parse(message.timestamp || '')
    if (!Number.isFinite(timestamp) || timestamp >= latestTime) {
      last = message
      latestTime = Number.isFinite(timestamp) ? timestamp : latestTime
    }
  }

  const byUuid = new Map(messages.map(message => [message.uuid!, message]))
  const chain: TranscriptEntry[] = []
  const seen = new Set<string>()
  let current: TranscriptEntry | undefined = last
  while (current?.uuid && !seen.has(current.uuid)) {
    seen.add(current.uuid)
    chain.unshift(current)
    current = current.parentUuid ? byUuid.get(current.parentUuid) : undefined
  }
  return chain.map(message => {
    const { parentUuid: _parentUuid, isSidechain: _isSidechain, ...displayMessage } = message
    return displayMessage
  })
}

export async function loadSessionContextFromTranscript(session: SessionRecord): Promise<{
  customTitle?: string
  tag?: string
  summary?: string
  mode?: string
  messages: TranscriptEntry[]
  usage: Awaited<ReturnType<typeof getSessionUsageSummaryFromTranscriptPath>>
} | null> {
  let entries: TranscriptEntry[]
  try {
    entries = await readJSONLFile<TranscriptEntry>(session.transcriptPath)
  } catch {
    return null
  }

  const messages = buildConversationChain(entries)
  if (messages.length === 0) return null

  const lastMessage = messages[messages.length - 1]
  const leafSessionId =
    typeof lastMessage?.sessionId === 'string'
      ? lastMessage.sessionId
      : session.transcriptSessionId
  const summary = lastMessage?.uuid
    ? [...entries]
        .reverse()
        .find(entry => entry.type === 'summary' && entry.leafUuid === lastMessage.uuid)
        ?.summary
    : undefined
  const usage = await getSessionUsageSummaryFromTranscriptPath({
    transcriptSessionId: session.transcriptSessionId,
    mainTranscriptPath: session.transcriptPath,
    subagentsDir: join(
      dirname(session.transcriptPath),
      session.transcriptSessionId,
      'subagents',
    ),
  })

  return {
    customTitle: latestMetadata(entries, 'custom-title', 'customTitle', leafSessionId),
    tag: latestMetadata(entries, 'tag', 'tag', leafSessionId),
    summary: typeof summary === 'string' ? summary : undefined,
    mode: latestMetadata(entries, 'mode', 'mode', leafSessionId),
    messages,
    usage,
  }
}
