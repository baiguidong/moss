import { resolve } from 'path'
import type { SessionId } from '../types/ids.js'

const sessionWorkspaceDirectories = new Map<string, readonly string[]>()

function normalizeWorkspaceDirectories(
  directories: readonly string[],
): readonly string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const directory of directories) {
    const value = typeof directory === 'string' ? directory.trim() : ''
    if (!value) continue
    const absolutePath = resolve(value).normalize('NFC')
    if (seen.has(absolutePath)) continue
    seen.add(absolutePath)
    normalized.push(absolutePath)
  }
  return normalized
}

export function registerSessionWorkspaceDirectories(
  sessionId: string,
  directories: readonly string[],
): void {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) return
  const normalizedDirectories = normalizeWorkspaceDirectories(directories)
  if (normalizedDirectories.length === 0) {
    sessionWorkspaceDirectories.delete(normalizedSessionId)
    return
  }
  sessionWorkspaceDirectories.set(normalizedSessionId, normalizedDirectories)
}

export function getSessionWorkspaceDirectories(
  sessionId: SessionId | string,
): readonly string[] {
  return sessionWorkspaceDirectories.get(String(sessionId)) ?? []
}

export function discardSessionWorkspaceDirectories(sessionId: string): void {
  sessionWorkspaceDirectories.delete(sessionId)
}
