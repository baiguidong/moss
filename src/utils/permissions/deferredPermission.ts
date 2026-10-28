import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  getOriginalCwd,
  getSessionEngineDir,
  getSessionId,
} from '../../bootstrap/state.js'
import { getProjectDir } from '../sessionStorage.js'
import type { AssistantMessage } from '../../types/message.js'
import type {
  PermissionDecision,
  PermissionDenyDecision,
  PermissionDeferDecision,
} from '../../types/permissions.js'

const DEFAULT_DEFER_TTL_MS = 15 * 60 * 1000
const DEFERRED_PERMISSION_FILE = 'deferred-permissions.json'
const storageLocks = new Map<string, Promise<void>>()

async function withStorageLock<T>(
  storageDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = storageLocks.get(storageDir)
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  storageLocks.set(storageDir, current)
  if (previous) await previous
  try {
    return await operation()
  } finally {
    release()
    if (storageLocks.get(storageDir) === current) storageLocks.delete(storageDir)
  }
}

/** Storage location for the active session's pending permissions. */
export function getDeferredPermissionStorageDir(): string {
  const engineDir = getSessionEngineDir() ?? getProjectDir(getOriginalCwd())
  return join(engineDir, getSessionId())
}

export type DeferredPermissionEnvironment = {
  isNonInteractiveSession: boolean
  /** Served/remote sessions must explicitly advertise a resume endpoint. */
  isServedSession?: boolean
  hasResumeCapability: boolean
}

export type DeferredPermissionRecord = {
  version: 1
  resumeToken: string
  toolUseID: string
  toolName: string
  toolInput: Record<string, unknown>
  message?: string
  hookSnapshot?: unknown
  permissionMode: string
  createdAt: number
  expiresAt: number
}

export type DeferredPermissionResume = {
  record: DeferredPermissionRecord
  assistantMessage: AssistantMessage
}

export type DeferredPermissionOutcome =
  | { kind: 'unchanged'; decision: PermissionDecision }
  | { kind: 'ask'; decision: Extract<PermissionDecision, { behavior: 'ask' }> }
  | { kind: 'denied'; decision: PermissionDenyDecision }
  | { kind: 'persisted'; decision: PermissionDeferDecision; record: DeferredPermissionRecord }

function deferredPermissionPath(storageDir: string): string {
  return join(storageDir, DEFERRED_PERMISSION_FILE)
}

function safeParseRecords(value: string): DeferredPermissionRecord[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(item => {
      if (!item || typeof item !== 'object') return false
      const record = item as Partial<DeferredPermissionRecord>
      return (
        record.version === 1 &&
        typeof record.resumeToken === 'string' &&
        typeof record.toolUseID === 'string' &&
        typeof record.toolName === 'string' &&
        !!record.toolInput &&
        typeof record.toolInput === 'object' &&
        typeof record.permissionMode === 'string' &&
        typeof record.expiresAt === 'number'
      )
    }) as DeferredPermissionRecord[]
  } catch {
    return []
  }
}

async function readRecords(storageDir: string): Promise<DeferredPermissionRecord[]> {
  try {
    const contents = await readFile(deferredPermissionPath(storageDir), 'utf8')
    const now = Date.now()
    return safeParseRecords(contents).filter(record => record.expiresAt > now)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function writeRecords(
  storageDir: string,
  records: DeferredPermissionRecord[],
): Promise<void> {
  await mkdir(storageDir, { recursive: true, mode: 0o700 })
  const path = deferredPermissionPath(storageDir)
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  await rename(temporaryPath, path)
}

/**
 * Applies Claude Code's defer boundary: interactive sessions cannot pause a
 * tool in the background, and served sessions must fail closed unless the
 * host explicitly provides a resume mechanism.
 */
export function classifyDeferredPermission(
  decision: PermissionDecision,
  environment: DeferredPermissionEnvironment,
): Exclude<DeferredPermissionOutcome, { kind: 'persisted' }> {
  if (decision.behavior !== 'defer') {
    return { kind: 'unchanged', decision }
  }

  if (!environment.isNonInteractiveSession) {
    return {
      kind: 'ask',
      decision: {
        behavior: 'ask',
        message: decision.message,
        updatedInput: undefined,
        decisionReason: decision.decisionReason,
      },
    }
  }

  if (environment.isServedSession && !environment.hasResumeCapability) {
    return {
      kind: 'denied',
      decision: {
        behavior: 'deny',
        message:
          'Permission was deferred, but this served session has no resume capability. The tool call was rejected to avoid losing an unattended action.',
        decisionReason: {
          type: 'other',
          reason: 'deferred permission has no resume machinery',
        },
        toolUseID: decision.toolUseID,
      },
    }
  }

  if (!environment.hasResumeCapability) {
    return {
      kind: 'denied',
      decision: {
        behavior: 'deny',
        message:
          'Permission was deferred, but this session has no resume capability. The tool call was rejected to avoid losing an unattended action.',
        decisionReason: {
          type: 'other',
          reason: 'deferred permission has no resume machinery',
        },
        toolUseID: decision.toolUseID,
      },
    }
  }

  return { kind: 'unchanged', decision }
}

export async function persistDeferredPermission(params: {
  storageDir: string
  decision: PermissionDeferDecision
  toolUseID: string
  toolName: string
  toolInput: Record<string, unknown>
  permissionMode: string
  hookSnapshot?: unknown
  now?: number
  ttlMs?: number
}): Promise<DeferredPermissionRecord> {
  return withStorageLock(params.storageDir, async () => {
    const now = params.now ?? Date.now()
    const records = await readRecords(params.storageDir)
    const resumeToken = params.decision.resumeToken ?? randomUUID()
    const record: DeferredPermissionRecord = {
      version: 1,
      resumeToken,
      toolUseID: params.toolUseID,
      toolName: params.toolName,
      toolInput: params.toolInput,
      message: params.decision.message,
      ...(params.hookSnapshot === undefined
        ? {}
        : { hookSnapshot: params.hookSnapshot }),
      permissionMode: params.permissionMode,
      createdAt: now,
      expiresAt:
        params.decision.expiresAt ?? now + (params.ttlMs ?? DEFAULT_DEFER_TTL_MS),
    }
    await writeRecords(
      params.storageDir,
      [...records.filter(item => item.toolUseID !== params.toolUseID), record],
    )
    return record
  })
}

export async function listDeferredPermissions(
  storageDir: string,
): Promise<DeferredPermissionRecord[]> {
  return withStorageLock(storageDir, async () => {
    const records = await readRecords(storageDir)
    await writeRecords(storageDir, records)
    return records
  })
}

export async function consumeDeferredPermission(
  storageDir: string,
  resumeToken: string,
): Promise<DeferredPermissionRecord | undefined> {
  return withStorageLock(storageDir, async () => {
    const records = await readRecords(storageDir)
    const found = records.find(record => record.resumeToken === resumeToken)
    if (!found) return undefined
    await writeRecords(
      storageDir,
      records.filter(record => record.resumeToken !== resumeToken),
    )
    return found
  })
}

export { DEFAULT_DEFER_TTL_MS, DEFERRED_PERMISSION_FILE }
