import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type {
  AttributionSnapshotMessage,
  LogOption,
  PersistedWorktreeSession,
} from '../types/logs.js'
import type { Message } from '../types/message.js'
import {
  loadConversationForResume,
  type TurnInterruptionState,
} from './conversationRecovery.js'
import type { FileHistorySnapshot } from './fileHistory.js'
import { sanitizeMessagesForResume } from './sessionResumeSanitizer.js'
import type { ContentReplacementRecord } from './toolResultStorage.js'

type LoadedResumeConversation = {
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  sessionId: string | undefined
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  tag?: string
  mode?: 'coordinator' | 'normal'
  worktreeSession?: PersistedWorktreeSession | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
  fullPath?: string
}

export interface PreparedSessionResume {
  sessionId: string
  sourceSessionId: string
  projectDir: string | null
  cwd: string | null
  fullPath?: string
  messages: Message[]
  turnInterruptionState: TurnInterruptionState
  fileHistorySnapshots?: FileHistorySnapshot[]
  attributionSnapshots?: AttributionSnapshotMessage[]
  contentReplacements?: ContentReplacementRecord[]
  agentName?: string
  agentColor?: string
  agentSetting?: string
  customTitle?: string
  tag?: string
  mode?: 'coordinator' | 'normal'
  worktreeSession?: PersistedWorktreeSession | null
  prNumber?: number
  prUrl?: string
  prRepository?: string
  forkSession: boolean
}

function inferResumeCwd(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const maybeCwd = (messages[i] as { cwd?: unknown } | undefined)?.cwd
    if (typeof maybeCwd === 'string' && maybeCwd.trim().length > 0) {
      return maybeCwd
    }
  }
  return null
}

export function prepareLoadedSessionResume(
  result: LoadedResumeConversation | null,
  options: {
    forkSession?: boolean
    sessionIdOverride?: string
  } = {},
): PreparedSessionResume | null {
  if (!result?.sessionId) {
    return null
  }

  const forkSession = options.forkSession ?? false
  const sanitized = sanitizeMessagesForResume(result.messages)
  const messages = sanitized.messages
  const projectDir = result.fullPath ? dirname(result.fullPath) : null
  const cwd =
    result.worktreeSession?.worktreePath ??
    inferResumeCwd(messages) ??
    projectDir

  return {
    sessionId: forkSession
      ? (options.sessionIdOverride ?? randomUUID())
      : (options.sessionIdOverride ?? result.sessionId),
    sourceSessionId: result.sessionId,
    projectDir,
    cwd,
    fullPath: result.fullPath,
    messages,
    turnInterruptionState: sanitized.removedApiError
      ? { kind: 'none' }
      : result.turnInterruptionState,
    fileHistorySnapshots: result.fileHistorySnapshots,
    attributionSnapshots: result.attributionSnapshots,
    contentReplacements: result.contentReplacements,
    agentName: result.agentName,
    agentColor: result.agentColor,
    agentSetting: result.agentSetting,
    customTitle: result.customTitle,
    tag: result.tag,
    mode: result.mode,
    worktreeSession: result.worktreeSession,
    prNumber: result.prNumber,
    prUrl: result.prUrl,
    prRepository: result.prRepository,
    forkSession,
  }
}

export async function prepareSessionResume(
  source: string | LogOption | undefined,
  options: {
    forkSession?: boolean
    sessionIdOverride?: string
    sourceJsonlFile?: string
  } = {},
): Promise<PreparedSessionResume | null> {
  const result = await loadConversationForResume(
    source,
    options.sourceJsonlFile,
  )
  return prepareLoadedSessionResume(result, options)
}
