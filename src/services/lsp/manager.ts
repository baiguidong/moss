import { logForDebugging } from '../../utils/debug.js'
import { isBareMode } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { getSessionIdContext } from '../../utils/sessionIdContext.js'
import {
  createLSPServerManager,
  type LSPServerManager,
} from './LSPServerManager.js'
import { registerLSPNotificationHandlers } from './passiveFeedback.js'

/**
 * Initialization state of the LSP server manager
 */
type InitializationState = 'not-started' | 'pending' | 'success' | 'failed'

type LspManagerSlot = {
  managerInstance: LSPServerManager | undefined
  initializationState: InitializationState
  initializationError: Error | undefined
  initializationGeneration: number
  initializationPromise: Promise<void> | undefined
}

function createLspManagerSlot(): LspManagerSlot {
  return {
    managerInstance: undefined,
    initializationState: 'not-started',
    initializationError: undefined,
    initializationGeneration: 0,
    initializationPromise: undefined,
  }
}

const globalLspManagerSlot = createLspManagerSlot()
const sessionLspManagerSlots = new Map<string, LspManagerSlot>()

function getLspManagerSlot(): LspManagerSlot {
  const sessionId = getSessionIdContext()
  if (!sessionId) {
    return globalLspManagerSlot
  }
  let slot = sessionLspManagerSlots.get(sessionId)
  if (!slot) {
    slot = createLspManagerSlot()
    sessionLspManagerSlots.set(sessionId, slot)
  }
  return slot
}

function resetLspManagerSlot(slot: LspManagerSlot): void {
  slot.managerInstance = undefined
  slot.initializationState = 'not-started'
  slot.initializationError = undefined
  slot.initializationPromise = undefined
  slot.initializationGeneration++
}

/**
 * Test-only sync reset. shutdownLspServerManager() is async and tears down
 * real connections; this only clears the module-scope singleton state so
 * reinitializeLspServerManager() early-returns on 'not-started' in downstream
 * tests on the same shard.
 */
export function _resetLspManagerForTesting(): void {
  resetLspManagerSlot(globalLspManagerSlot)
  for (const slot of sessionLspManagerSlots.values()) {
    resetLspManagerSlot(slot)
  }
  sessionLspManagerSlots.clear()
}

/**
 * Get the singleton LSP server manager instance.
 * Returns undefined if not yet initialized, initialization failed, or still pending.
 *
 * Callers should check for undefined and handle gracefully, as initialization happens
 * asynchronously during Claude Code startup. Use getInitializationStatus() to
 * distinguish between pending, failed, and not-started states.
 */
export function getLspServerManager(): LSPServerManager | undefined {
  const slot = getLspManagerSlot()
  // Don't return a broken instance if initialization failed
  if (slot.initializationState === 'failed') {
    return undefined
  }
  return slot.managerInstance
}

/**
 * Get the current initialization status of the LSP server manager.
 *
 * @returns Status object with current state and error (if failed)
 */
export function getInitializationStatus():
  | { status: 'not-started' }
  | { status: 'pending' }
  | { status: 'success' }
  | { status: 'failed'; error: Error } {
  const slot = getLspManagerSlot()
  if (slot.initializationState === 'failed') {
    return {
      status: 'failed',
      error: slot.initializationError || new Error('Initialization failed'),
    }
  }
  if (slot.initializationState === 'not-started') {
    return { status: 'not-started' }
  }
  if (slot.initializationState === 'pending') {
    return { status: 'pending' }
  }
  return { status: 'success' }
}

/**
 * Check whether at least one language server is connected and healthy.
 * Backs LSPTool.isEnabled().
 */
export function isLspConnected(): boolean {
  if (getLspManagerSlot().initializationState === 'failed') return false
  const manager = getLspServerManager()
  if (!manager) return false
  const servers = manager.getAllServers()
  if (servers.size === 0) return false
  for (const server of servers.values()) {
    if (server.state !== 'error') return true
  }
  return false
}

/**
 * Wait for LSP server manager initialization to complete.
 *
 * Returns immediately if initialization has already completed (success or failure).
 * If initialization is pending, waits for it to complete.
 * If initialization hasn't started, returns immediately.
 *
 * @returns Promise that resolves when initialization is complete
 */
export async function waitForInitialization(): Promise<void> {
  const slot = getLspManagerSlot()
  // If already initialized or failed, return immediately
  if (
    slot.initializationState === 'success' ||
    slot.initializationState === 'failed'
  ) {
    return
  }

  // If pending and we have a promise, wait for it
  if (slot.initializationState === 'pending' && slot.initializationPromise) {
    await slot.initializationPromise
  }

  // If not started, return immediately (nothing to wait for)
}

/**
 * Initialize the LSP server manager singleton.
 *
 * This function is called during Claude Code startup. It synchronously creates
 * the manager instance, then starts async initialization (loading LSP configs)
 * in the background without blocking the startup process.
 *
 * Safe to call multiple times - will only initialize once (idempotent).
 * However, if initialization previously failed, calling again will retry.
 */
export function initializeLspServerManager(): void {
  // --bare / SIMPLE: no LSP. LSP is for editor integration (diagnostics,
  // hover, go-to-def in the REPL). Scripted -p calls have no use for it.
  if (isBareMode()) {
    return
  }
  logForDebugging('[LSP MANAGER] initializeLspServerManager() called')
  const slot = getLspManagerSlot()

  // Skip if already initialized or currently initializing
  if (
    slot.managerInstance !== undefined &&
    slot.initializationState !== 'failed'
  ) {
    logForDebugging(
      '[LSP MANAGER] Already initialized or initializing, skipping',
    )
    return
  }

  // Reset state for retry if previous initialization failed
  if (slot.initializationState === 'failed') {
    slot.managerInstance = undefined
    slot.initializationError = undefined
  }

  // Create the manager instance and mark as pending
  slot.managerInstance = createLSPServerManager()
  slot.initializationState = 'pending'
  logForDebugging('[LSP MANAGER] Created manager instance, state=pending')

  // Increment generation to invalidate any pending initializations
  const currentGeneration = ++slot.initializationGeneration
  logForDebugging(
    `[LSP MANAGER] Starting async initialization (generation ${currentGeneration})`,
  )

  // Start initialization asynchronously without blocking
  // Store the promise so callers can await it via waitForInitialization()
  slot.initializationPromise = slot.managerInstance
    .initialize()
    .then(() => {
      // Only update state if this is still the current initialization
      if (currentGeneration === slot.initializationGeneration) {
        slot.initializationState = 'success'
        logForDebugging('LSP server manager initialized successfully')

        // Register passive notification handlers for diagnostics
        if (slot.managerInstance) {
          registerLSPNotificationHandlers(slot.managerInstance)
        }
      }
    })
    .catch((error: unknown) => {
      // Only update state if this is still the current initialization
      if (currentGeneration === slot.initializationGeneration) {
        slot.initializationState = 'failed'
        slot.initializationError = error as Error
        // Clear the instance since it's not usable
        slot.managerInstance = undefined

        logError(error as Error)
        logForDebugging(
          `Failed to initialize LSP server manager: ${errorMessage(error)}`,
        )
      }
    })
}

/**
 * Force re-initialization of the LSP server manager, even after a prior
 * successful init. Called from refreshActivePlugins() after plugin caches
 * are cleared, so newly-loaded plugin LSP servers are picked up.
 *
 * Fixes https://github.com/anthropics/claude-code/issues/15521:
 * loadAllPlugins() is memoized and can be called very early in startup
 * (via getCommands prefetch in setup.ts) before marketplaces are reconciled,
 * caching an empty plugin list. initializeLspServerManager() then reads that
 * stale memoized result and initializes with 0 servers. Unlike commands/agents/
 * hooks/MCP, LSP was never re-initialized on plugin refresh.
 *
 * Safe to call when no LSP plugins changed: initialize() is just config
 * parsing (servers are lazy-started on first use). Also safe during pending
 * init: the generation counter invalidates the in-flight promise.
 */
export function reinitializeLspServerManager(): void {
  const slot = getLspManagerSlot()
  if (slot.initializationState === 'not-started') {
    // initializeLspServerManager() was never called (e.g. headless subcommand
    // path). Don't start it now.
    return
  }

  logForDebugging('[LSP MANAGER] reinitializeLspServerManager() called')

  // Best-effort shutdown of any running servers on the old instance so
  // Reloads don't leak child processes. Fire-and-forget: the
  // primary use case (issue #15521) has 0 servers so this is usually a no-op.
  if (slot.managerInstance) {
    void slot.managerInstance.shutdown().catch(err => {
      logForDebugging(
        `[LSP MANAGER] old instance shutdown during reinit failed: ${errorMessage(err)}`,
      )
    })
  }

  // Force the idempotence check in initializeLspServerManager() to fall
  // through. Generation counter handles invalidating any in-flight init.
  slot.managerInstance = undefined
  slot.initializationState = 'not-started'
  slot.initializationError = undefined

  initializeLspServerManager()
}

/**
 * Shutdown the LSP server manager and clean up resources.
 *
 * This should be called during Claude Code shutdown. Stops all running LSP servers
 * and clears internal state. Safe to call when not initialized (no-op).
 *
 * NOTE: Errors during shutdown are logged for monitoring but NOT propagated to the caller.
 * State is always cleared even if shutdown fails, to prevent resource accumulation.
 * This is acceptable during application exit when recovery is not possible.
 *
 * @returns Promise that resolves when shutdown completes (errors are swallowed)
 */
export async function shutdownLspServerManager(): Promise<void> {
  const shutdownSlot = async (slot: LspManagerSlot): Promise<void> => {
    if (slot.managerInstance === undefined) {
      return
    }

    try {
      await slot.managerInstance.shutdown()
      logForDebugging('LSP server manager shut down successfully')
    } catch (error: unknown) {
      logError(error as Error)
      logForDebugging(
        `Failed to shutdown LSP server manager: ${errorMessage(error)}`,
      )
    } finally {
      resetLspManagerSlot(slot)
    }
  }

  const sessionId = getSessionIdContext()
  if (sessionId) {
    const slot = sessionLspManagerSlots.get(sessionId)
    if (!slot) {
      return
    }
    await shutdownSlot(slot)
    sessionLspManagerSlots.delete(sessionId)
    return
  }

  await shutdownSlot(globalLspManagerSlot)
  for (const slot of sessionLspManagerSlots.values()) {
    await shutdownSlot(slot)
  }
  sessionLspManagerSlots.clear()
}

export async function discardSessionLspServerManager(
  sessionId: string,
): Promise<void> {
  const slot = sessionLspManagerSlots.get(sessionId)
  if (!slot) {
    return
  }
  try {
    await slot.managerInstance?.shutdown()
  } catch (error: unknown) {
    logError(error as Error)
    logForDebugging(
      `Failed to shutdown session LSP server manager: ${errorMessage(error)}`,
    )
  } finally {
    resetLspManagerSlot(slot)
    sessionLspManagerSlots.delete(sessionId)
  }
}
