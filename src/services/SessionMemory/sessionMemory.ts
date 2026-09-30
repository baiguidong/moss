import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { isSessionMemoryEnabled } from './config.js'

export const MAX_SESSION_SUMMARY_CHARS = 12_000

// Ownership lasts until the write settles, including during session disposal.
// Different sessions can save independently; overlapping saves cannot overwrite
// each other out of order. Atomic rename also keeps readers from seeing a partial file.
const activeWrites = new Set<string>()

/** Persist text supplied by the main model. Never starts a model or sampling hook. */
export async function saveSessionSummary(
  summary: string,
  signal: AbortSignal,
): Promise<void> {
  if (!isSessionMemoryEnabled()) {
    throw new Error('Session summaries are disabled.')
  }
  if (!summary.trim() || summary.length > MAX_SESSION_SUMMARY_CHARS) {
    throw new Error(`Summary must contain 1–${MAX_SESSION_SUMMARY_CHARS} characters of non-empty text.`)
  }
  signal.throwIfAborted()

  // Resolve once in the current session scope; the model cannot choose a path.
  const path = getSessionMemoryPath()
  if (activeWrites.has(path)) {
    throw new Error('A session summary save is already running. Retry after it finishes.')
  }
  activeWrites.add(path)
  const temporaryPath = `${path}.${randomUUID()}.tmp`
  let ownsTemporaryFile = false
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    signal.throwIfAborted()
    const file = await open(temporaryPath, 'wx', 0o600)
    ownsTemporaryFile = true
    try {
      await file.writeFile(summary, { encoding: 'utf8', signal })
    } finally {
      await file.close()
    }
    signal.throwIfAborted()
    if (!isSessionMemoryEnabled()) {
      throw new Error('Session summaries are disabled.')
    }
    await rename(temporaryPath, path)
  } finally {
    try {
      if (ownsTemporaryFile) await rm(temporaryPath, { force: true })
    } finally {
      activeWrites.delete(path)
    }
  }
}
