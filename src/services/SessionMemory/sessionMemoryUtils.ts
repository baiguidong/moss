/**
 * Session Memory utility functions that can be imported without circular dependencies.
 * These are separate from the main sessionMemory.ts to avoid importing runAgent.
 */

import { isFsInaccessible } from '../../utils/errors.js'
import { DEFAULT_SESSION_MEMORY_SETTINGS } from '../../../packages/direct-connect-protocol/src/index.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { getSessionMemoryPath } from '../../utils/permissions/filesystem.js'
import { sleep } from '../../utils/sleep.js'
import { logEvent } from '../analytics/index.js'
import { getSessionId } from '../../bootstrap/state.js'

const EXTRACTION_WAIT_TIMEOUT_MS = 15000
const EXTRACTION_STALE_THRESHOLD_MS = 60000 // 1 minute

/**
 * Configuration for session memory extraction thresholds
 */
export type SessionMemoryConfig = {
  /** Minimum context window tokens before initializing session memory.
   * Uses the same token counting as autocompact (input + output + cache tokens)
   * to ensure consistent behavior between the two features. */
  minimumMessageTokensToInit: number
  /** Minimum context window growth (in tokens) between session memory updates.
   * Uses the same token counting as autocompact (tokenCountWithEstimation)
   * to measure actual context growth, not cumulative API usage. */
  minimumTokensBetweenUpdate: number
  /** Number of tool calls between session memory updates */
  toolCallsBetweenUpdates: number
}

// Default configuration values
export const DEFAULT_SESSION_MEMORY_CONFIG: SessionMemoryConfig = {
  minimumMessageTokensToInit:
    DEFAULT_SESSION_MEMORY_SETTINGS.minimumMessageTokensToInit,
  minimumTokensBetweenUpdate:
    DEFAULT_SESSION_MEMORY_SETTINGS.minimumTokensBetweenUpdate,
  toolCallsBetweenUpdates: DEFAULT_SESSION_MEMORY_SETTINGS.toolCallsBetweenUpdates,
}

type SessionMemoryRuntimeState = {
  lastSummarizedMessageId?: string
  extractionStartedAt?: number
  tokensAtLastExtraction: number
  initialized: boolean
  config: SessionMemoryConfig
}

const sessionMemoryStates = new Map<string, SessionMemoryRuntimeState>()

function getState(): SessionMemoryRuntimeState {
  const sessionId = getSessionId()
  let state = sessionMemoryStates.get(sessionId)
  if (!state) {
    state = {
      tokensAtLastExtraction: 0,
      initialized: false,
      config: { ...DEFAULT_SESSION_MEMORY_CONFIG },
    }
    sessionMemoryStates.set(sessionId, state)
  }
  return state
}

/**
 * Get the message ID up to which the session memory is current
 */
export function getLastSummarizedMessageId(): string | undefined {
  return getState().lastSummarizedMessageId
}

/**
 * Set the last summarized message ID (called from sessionMemory.ts)
 */
export function setLastSummarizedMessageId(
  messageId: string | undefined,
): void {
  getState().lastSummarizedMessageId = messageId
}

/**
 * Mark extraction as started (called from sessionMemory.ts)
 */
export function markExtractionStarted(): void {
  getState().extractionStartedAt = Date.now()
}

/**
 * Mark extraction as completed (called from sessionMemory.ts)
 */
export function markExtractionCompleted(): void {
  getState().extractionStartedAt = undefined
}

/**
 * Wait for any in-progress session memory extraction to complete (with 15s timeout)
 * Returns immediately if no extraction is in progress or if extraction is stale (>1min old).
 */
export async function waitForSessionMemoryExtraction(): Promise<void> {
  const startTime = Date.now()
  while (getState().extractionStartedAt) {
    const extractionAge = Date.now() - getState().extractionStartedAt!
    if (extractionAge > EXTRACTION_STALE_THRESHOLD_MS) {
      // Extraction is stale, don't wait
      return
    }

    if (Date.now() - startTime > EXTRACTION_WAIT_TIMEOUT_MS) {
      // Timeout - continue anyway
      return
    }

    await sleep(1000)
  }
}

/**
 * Get the current session memory content
 */
export async function getSessionMemoryContent(): Promise<string | null> {
  const fs = getFsImplementation()
  const memoryPath = getSessionMemoryPath()

  try {
    const content = await fs.readFile(memoryPath, { encoding: 'utf-8' })

    logEvent('tengu_session_memory_loaded', {
      content_length: content.length,
    })

    return content
  } catch (e: unknown) {
    if (isFsInaccessible(e)) return null
    throw e
  }
}

/**
 * Set the session memory configuration
 */
export function setSessionMemoryConfig(
  config: Partial<SessionMemoryConfig>,
): void {
  const state = getState()
  state.config = {
    ...state.config,
    ...config,
  }
}

/**
 * Get the current session memory configuration
 */
export function getSessionMemoryConfig(): SessionMemoryConfig {
  return { ...getState().config }
}

/**
 * Record the context size at the time of extraction.
 * Used to measure context growth for minimumTokensBetweenUpdate threshold.
 */
export function recordExtractionTokenCount(currentTokenCount: number): void {
  getState().tokensAtLastExtraction = currentTokenCount
}

/**
 * Check if session memory has been initialized (met minimumTokensToInit threshold)
 */
export function isSessionMemoryInitialized(): boolean {
  return getState().initialized
}

/**
 * Mark session memory as initialized
 */
export function markSessionMemoryInitialized(): void {
  getState().initialized = true
}

/**
 * Check if we've met the threshold to initialize session memory.
 * Uses total context window tokens (same as autocompact) for consistent behavior.
 */
export function hasMetInitializationThreshold(
  currentTokenCount: number,
): boolean {
  return currentTokenCount >= getState().config.minimumMessageTokensToInit
}

/**
 * Check if we've met the threshold for the next update.
 * Measures actual context window growth since last extraction
 * (same metric as autocompact and initialization threshold).
 */
export function hasMetUpdateThreshold(currentTokenCount: number): boolean {
  const tokensSinceLastExtraction =
    currentTokenCount - getState().tokensAtLastExtraction
  return (
    tokensSinceLastExtraction >= getState().config.minimumTokensBetweenUpdate
  )
}

/**
 * Get the configured number of tool calls between updates
 */
export function getToolCallsBetweenUpdates(): number {
  return getState().config.toolCallsBetweenUpdates
}

/**
 * Reset session memory state (useful for testing)
 */
export function resetSessionMemoryState(): void {
  sessionMemoryStates.clear()
}

export function discardSessionMemoryState(sessionId: string): void {
  sessionMemoryStates.delete(sessionId)
}
