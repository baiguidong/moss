import { open, readdir, stat } from 'fs/promises'
import { join } from 'path'

export const LITE_READ_BUF_SIZE = 65_536
export const SYNTHETIC_MODEL = '<synthetic>'

export type TranscriptEntry = {
  type?: string
  uuid?: string
  parentUuid?: string | null
  sessionId?: string
  timestamp?: string
  isSidechain?: boolean
  message?: {
    model?: string
    usage?: {
      input_tokens?: number
      output_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      server_tool_use?: { web_search_requests?: number }
    }
    [key: string]: unknown
  }
  [key: string]: unknown
}

export function isTranscriptMessage(entry: TranscriptEntry): boolean {
  return (
    entry.type === 'user' ||
    entry.type === 'assistant' ||
    entry.type === 'attachment' ||
    entry.type === 'system'
  )
}

export function extractJsonStringField(text: string, key: string): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(text)
  if (!match?.[1]) return undefined
  try {
    return JSON.parse(`"${match[1]}"`) as string
  } catch {
    return match[1]
  }
}

export async function readHeadAndTail(
  filePath: string,
  fileSize: number,
  buffer: Buffer,
): Promise<{ head: string; tail: string }> {
  try {
    const handle = await open(filePath, 'r')
    try {
      const first = await handle.read(buffer, 0, LITE_READ_BUF_SIZE, 0)
      const head = buffer.toString('utf8', 0, first.bytesRead)
      const offset = Math.max(0, fileSize - LITE_READ_BUF_SIZE)
      if (offset === 0) return { head, tail: head }
      const last = await handle.read(buffer, 0, LITE_READ_BUF_SIZE, offset)
      return { head, tail: buffer.toString('utf8', 0, last.bytesRead) }
    } finally {
      await handle.close()
    }
  } catch {
    return { head: '', tail: '' }
  }
}

export async function collectJsonlFilesRecursive(dirPath: string): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name)
    if (entry.isDirectory()) files.push(...(await collectJsonlFilesRecursive(fullPath)))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(fullPath)
  }
  return files
}

export async function fileSizeOrNull(filePath: string): Promise<number | null> {
  try {
    return (await stat(filePath)).size
  } catch {
    return null
  }
}
