import { readFile, writeFile } from 'fs/promises'
import {
  isTranscriptMessage,
  type TranscriptEntry,
} from './lib/transcript.js'
import type { SessionRecord } from './types.js'

type TranscriptReadResult = {
  entries: TranscriptEntry[]
  lineCount: number
  parseErrorCount: number
}

async function readTranscriptEntries(filePath: string): Promise<TranscriptReadResult> {
  const raw = await readFile(filePath, 'utf8')
  const entries: TranscriptEntry[] = []
  let lineCount = 0
  let parseErrorCount = 0

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    lineCount += 1
    try {
      entries.push(JSON.parse(trimmed) as TranscriptEntry)
    } catch {
      parseErrorCount += 1
    }
  }

  return { entries, lineCount, parseErrorCount }
}

const FORK_OMITTED_ENTRY_TYPES = new Set([
  'attribution-snapshot',
  'file-history-snapshot',
  'queue-operation',
  'worktree-state',
])

export async function cloneSessionTranscript(
  sourcePath: string,
  targetPath: string,
  sourceSessionId: string,
  targetSessionId: string,
  title: string,
): Promise<number> {
  const { entries } = await readTranscriptEntries(sourcePath)
  const cloned: TranscriptEntry[] = []
  let messageCount = 0

  for (const entry of entries) {
    if (entry.isSidechain || FORK_OMITTED_ENTRY_TYPES.has(entry.type || '')) {
      continue
    }
    if (entry.type === 'content-replacement' && entry.agentId) {
      continue
    }
    if (entry.type === 'custom-title' || entry.type === 'ai-title') {
      continue
    }

    const next = structuredClone(entry)
    if (typeof next.sessionId === 'string') {
      next.sessionId = targetSessionId
    }
    if (isTranscriptMessage(next)) {
      messageCount += 1
      delete next.slug
      next.forkedFrom = {
        sessionId: sourceSessionId,
        messageUuid: next.uuid,
      }
    }
    cloned.push(next)
  }

  if (messageCount === 0) {
    throw new Error('No conversation to fork')
  }

  cloned.push({
    type: 'custom-title',
    sessionId: targetSessionId,
    customTitle: title,
  })
  await writeFile(
    targetPath,
    `${cloned.map(entry => JSON.stringify(entry)).join('\n')}\n`,
    'utf8',
  )
  return messageCount
}

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

function visibleTranscriptMessages(entries: TranscriptEntry[]): TranscriptEntry[] {
  return entries.filter(entry => isTranscriptMessage(entry) && !entry.isSidechain)
}

export async function loadSessionContextFromTranscript(session: SessionRecord): Promise<{
  customTitle?: string
  tag?: string
  summary?: string
  mode?: string
  messages: TranscriptEntry[]
  transcript: {
    lineCount: number
    parseErrorCount: number
  }
} | null> {
  let result: TranscriptReadResult
  try {
    result = await readTranscriptEntries(session.transcriptPath)
  } catch {
    return null
  }

  const messages = visibleTranscriptMessages(result.entries)
  const lastMessage = messages[messages.length - 1]
  const leafSessionId =
    typeof lastMessage?.sessionId === 'string'
      ? lastMessage.sessionId
      : session.transcriptSessionId
  const summary = lastMessage?.uuid
    ? [...result.entries]
        .reverse()
        .find(entry => entry.type === 'summary' && entry.leafUuid === lastMessage.uuid)
        ?.summary
    : undefined

  return {
    customTitle: latestMetadata(result.entries, 'custom-title', 'customTitle', leafSessionId),
    tag: latestMetadata(result.entries, 'tag', 'tag', leafSessionId),
    summary: typeof summary === 'string' ? summary : undefined,
    mode: latestMetadata(result.entries, 'mode', 'mode', leafSessionId),
    messages,
    transcript: {
      lineCount: result.lineCount,
      parseErrorCount: result.parseErrorCount,
    },
  }
}
