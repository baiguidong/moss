// Checkpoint mtime is lastConsolidatedAt. A separate O_EXCL-created file
// represents the currently running consolidation.
//
// Lives inside the memory dir (getAutoMemPath) so it keys on git-root
// like memory does, and so it's writable even when the memory path comes
// from an env/settings override whose parent may not be.

import { randomUUID } from 'crypto'
import {
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'fs/promises'
import { join } from 'path'
import {
  getOriginalCwd,
  getSessionProjectDir,
} from '../../bootstrap/state.js'
import { getAutoMemPath } from '../../memdir/paths.js'
import { logForDebugging } from '../../utils/debug.js'
import { isProcessRunning } from '../../utils/genericProcessUtils.js'
import { listCandidates } from '../../utils/listSessionsImpl.js'
import { getProjectDir } from '../../utils/sessionStorage.js'

const LOCK_FILE = '.consolidate-lock'
const ACTIVE_LOCK_FILE = '.consolidate-active'
const ACTIVITY_DIR = '.session-activity'

// Stale past this even if the PID is live (PID reuse guard).
const HOLDER_STALE_MS = 60 * 60 * 1000

function lockPath(): string {
  return join(getAutoMemPath(), LOCK_FILE)
}

function activeLockPath(): string {
  return join(getAutoMemPath(), ACTIVE_LOCK_FILE)
}

function activityDir(): string {
  return join(getAutoMemPath(), ACTIVITY_DIR)
}

export async function recordMemorySessionActivity(sessionId: string): Promise<void> {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) return
  const dir = activityDir()
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, sessionId), '', { mode: 0o600 })
}

async function listActivityMarkersSince(sinceMs: number): Promise<string[]> {
  try {
    const entries = await readdir(activityDir(), { withFileTypes: true })
    const candidates = await Promise.all(
      entries
        .filter(entry => entry.isFile() && /^[a-zA-Z0-9_-]+$/.test(entry.name))
        .map(async entry => ({
          sessionId: entry.name,
          mtime: (await stat(join(activityDir(), entry.name))).mtimeMs,
        })),
    )
    return candidates
      .filter(candidate => candidate.mtime > sinceMs)
      .map(candidate => candidate.sessionId)
  } catch {
    return []
  }
}

/**
 * mtime of the lock file = lastConsolidatedAt. 0 if absent.
 * Per-turn cost: one stat.
 */
export async function readLastConsolidatedAt(): Promise<number> {
  try {
    const s = await stat(lockPath())
    return s.mtimeMs
  } catch {
    return 0
  }
}

/**
 * Atomically acquire the active lock, then advance the checkpoint mtime.
 * Returns the prior checkpoint for rollback, or null if blocked / stale input.
 *
 *   Success → releaseConsolidationLock; checkpoint stays at now.
 *   Failure → rollbackConsolidationLock rewinds the checkpoint and releases.
 *   Crash   → dead/stale active lock is reclaimed by the next process.
 */
export type ConsolidationLock = {
  priorMtime: number
  token: string
}

async function releaseActiveLock(token: string): Promise<void> {
  try {
    if ((await readFile(activeLockPath(), 'utf8')).trim() !== token) return
    await unlink(activeLockPath())
  } catch {
    // Already released or replaced by a new owner.
  }
}

export async function releaseConsolidationLock(
  lock: ConsolidationLock,
): Promise<void> {
  await releaseActiveLock(lock.token)
}

export async function tryAcquireConsolidationLock(
  expectedLastConsolidatedAt?: number,
): Promise<ConsolidationLock | null> {
  await mkdir(getAutoMemPath(), { recursive: true })
  const activePath = activeLockPath()
  const token = `${process.pid}:${randomUUID()}`

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(activePath, 'wx', 0o600)
      try {
        await handle.writeFile(token)
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error

      let holderPid: number | undefined
      let ageMs = 0
      try {
        const [activeStat, raw] = await Promise.all([
          stat(activePath),
          readFile(activePath, 'utf8'),
        ])
        ageMs = Date.now() - activeStat.mtimeMs
        const parsed = parseInt(raw.trim().split(':', 1)[0] ?? '', 10)
        holderPid = Number.isFinite(parsed) ? parsed : undefined
      } catch {
        continue
      }

      if (
        ageMs < HOLDER_STALE_MS &&
        (holderPid === undefined || isProcessRunning(holderPid))
      ) {
        logForDebugging(
          `[autoDream] lock held by ${holderPid === undefined ? 'another process' : `live PID ${holderPid}`} (${Math.round(ageMs / 1000)}s ago)`,
        )
        return null
      }

      try {
        await unlink(activePath)
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw unlinkError
        }
      }
    }
  }

  let ownsActiveLock = false
  try {
    ownsActiveLock = (await readFile(activePath, 'utf8')).trim() === token
  } catch {
    return null
  }
  if (!ownsActiveLock) return null

  try {
    const priorMtime = await readLastConsolidatedAt()
    if (
      expectedLastConsolidatedAt !== undefined &&
      priorMtime > expectedLastConsolidatedAt
    ) {
      await releaseActiveLock(token)
      return null
    }
    await writeFile(lockPath(), token, { mode: 0o600 })
    return { priorMtime, token }
  } catch (error) {
    await releaseActiveLock(token)
    throw error
  }
}

/**
 * Rewind the checkpoint after a failed fork and release the active lock.
 * A zero prior mtime restores the no-checkpoint state.
 */
export async function rollbackConsolidationLock(
  lock: ConsolidationLock,
): Promise<void> {
  const path = lockPath()
  try {
    if ((await readFile(activeLockPath(), 'utf8')).trim() !== lock.token) return
    if (lock.priorMtime === 0) {
      await unlink(path)
    } else {
      await writeFile(path, '')
      const t = lock.priorMtime / 1000 // utimes wants seconds
      await utimes(path, t, t)
    }
  } catch (e: unknown) {
    logForDebugging(
      `[autoDream] rollback failed: ${(e as Error).message} — next trigger delayed to minHours`,
    )
  } finally {
    await releaseActiveLock(lock.token)
  }
}

/**
 * Session IDs with mtime after sinceMs. listCandidates handles UUID
 * validation (excludes agent-*.jsonl) and parallel stat.
 *
 * Uses mtime (sessions TOUCHED since), not birthtime (0 on ext4).
 * Caller excludes the current session. Scans per-cwd transcripts — it's
 * a skip-gate, so undercounting worktree sessions is safe.
 */
export async function listSessionsTouchedSince(
  sinceMs: number,
): Promise<string[]> {
  const [activitySessions, transcriptSessions] = await Promise.all([
    listActivityMarkersSince(sinceMs),
    listCandidates(
      getSessionProjectDir() ?? getProjectDir(getOriginalCwd()),
      true,
    )
      .then(candidates => candidates
        .filter(candidate => candidate.mtime > sinceMs)
        .map(candidate => candidate.sessionId))
      .catch(() => []),
  ])
  return [...new Set([...activitySessions, ...transcriptSessions])]
}
