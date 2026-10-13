// Background memory consolidation. Fires the /dream prompt as a forked
// subagent when time-gate passes AND enough sessions have accumulated.
//
// Gate order (cheapest first):
//   1. Time: hours since lastConsolidatedAt >= minHours (one stat)
//   2. Sessions: transcript count with mtime > lastConsolidatedAt >= minSessions
//   3. Lock: no other process mid-consolidation
//
// State is closure-scoped inside initAutoDream() rather than module-level
// (tests call initAutoDream() in beforeEach for a fresh closure).

import type { REPLHookContext } from '../../utils/hooks/postSamplingHooks.js'
import {
  createCacheSafeParams,
  runForkedAgent,
} from '../../utils/forkedAgent.js'
import {
  createUserMessage,
  createMemorySavedMessage,
} from '../../utils/messages.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import type { ToolUseContext } from '../../Tool.js'
import { logEvent } from '../analytics/index.js'
import { getAutoMemorySettings } from '../autoMemorySettings.js'
import { isAutoMemoryEnabled, getAutoMemPath } from '../../memdir/paths.js'
import { isAutoDreamEnabled } from './config.js'
import { getProjectDir } from '../../utils/sessionStorage.js'
import {
  getOriginalCwd,
  getIsRemoteMode,
  getSessionId,
  getSessionEngineDir,
} from '../../bootstrap/state.js'
import { createAutoMemCanUseTool } from '../extractMemories/extractMemories.js'
import { buildConsolidationPrompt } from './consolidationPrompt.js'
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  releaseConsolidationLock,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
  type ConsolidationLock,
} from './consolidationLock.js'
import {
  registerDreamTask,
  addDreamTurn,
  completeDreamTask,
  failDreamTask,
  isDreamTask,
  DreamTask,
} from '../../tasks/DreamTask/DreamTask.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'

// Scan throttle: when time-gate passes but session-gate doesn't, the lock
// mtime doesn't advance, so the time-gate keeps passing every turn.
const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000

type AutoDreamConfig = {
  minHours: number
  minSessions: number
}

function getConfig(): AutoDreamConfig {
  const settings = getAutoMemorySettings()
  return {
    minHours: settings.dreamMinHours,
    minSessions: settings.dreamMinSessions,
  }
}

function isGateOpen(): boolean {
  if (getIsRemoteMode()) return false
  if (!isAutoMemoryEnabled()) return false
  return isAutoDreamEnabled()
}

type AppendSystemMessageFn = NonNullable<ToolUseContext['appendSystemMessage']>

export type ManualDreamOptions = { signal?: AbortSignal; transcriptDir: string }
export type DreamResult = { sessionsReviewed: number; summary: string; filesTouched: string[] }

let runner:
  | ((
      context: REPLHookContext,
      appendSystemMessage?: AppendSystemMessageFn,
      manual?: ManualDreamOptions,
    ) => Promise<DreamResult | undefined>)
  | null = null

/**
 * Call once at startup (from backgroundHousekeeping alongside
 * initExtractMemories), or per-test in beforeEach for a fresh closure.
 */
export function initAutoDream(): void {
  const lastSessionScanAtByMemoryRoot = new Map<string, number>()
  const activeMemoryRoots = new Set<string>()

  runner = async function runAutoDream(context, appendSystemMessage, manual) {
    const cfg = getConfig()
    const force = manual !== undefined
    if (!force && !isGateOpen()) return
    const memoryRoot = getAutoMemPath()

    // --- Time gate ---
    let lastAt: number
    try {
      lastAt = await readLastConsolidatedAt()
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] readLastConsolidatedAt failed: ${(e as Error).message}`,
      )
      return
    }
    const hoursSince = (Date.now() - lastAt) / 3_600_000
    if (!force && hoursSince < cfg.minHours) return

    // --- Scan throttle ---
    const sinceScanMs =
      Date.now() - (lastSessionScanAtByMemoryRoot.get(memoryRoot) ?? 0)
    if (!force && sinceScanMs < SESSION_SCAN_INTERVAL_MS) {
      logForDebugging(
        `[autoDream] scan throttle — time-gate passed but last scan was ${Math.round(sinceScanMs / 1000)}s ago`,
      )
      return
    }
    lastSessionScanAtByMemoryRoot.set(memoryRoot, Date.now())

    // --- Session gate ---
    let sessionIds: string[]
    try {
      sessionIds = await listSessionsTouchedSince(lastAt)
    } catch (e: unknown) {
      logForDebugging(
        `[autoDream] listSessionsTouchedSince failed: ${(e as Error).message}`,
      )
      return
    }
    // Exclude the current session (its mtime is always recent).
    const currentSession = getSessionId()
    sessionIds = sessionIds.filter(id => id !== currentSession)
    if (!force && sessionIds.length < cfg.minSessions) {
      logForDebugging(
        `[autoDream] skip — ${sessionIds.length} sessions since last consolidation, need ${cfg.minSessions}`,
      )
      return
    }

    if (activeMemoryRoots.has(memoryRoot)) {
      if (manual) throw new Error('长期记忆正在整理中，请稍后重试。')
      return
    }
    activeMemoryRoots.add(memoryRoot)

    let consolidationLock: ConsolidationLock | undefined
    let lockSettled = false
    try {
      // --- Lock ---
      // Manual runs skip scheduling gates, but share the automatic runner's lock.
      {
        try {
          consolidationLock =
            (await tryAcquireConsolidationLock(lastAt)) ?? undefined
        } catch (e: unknown) {
          logForDebugging(
            `[autoDream] lock acquire failed: ${(e as Error).message}`,
          )
          if (manual) throw e
          return
        }
        if (!consolidationLock) {
          if (manual) throw new Error('长期记忆正在整理中，请稍后重试。')
          return
        }
      }

      logForDebugging(
        `[autoDream] firing — ${hoursSince.toFixed(1)}h since last, ${sessionIds.length} sessions to review`,
      )
      logEvent('tengu_auto_dream_fired', {
        hours_since: Math.round(hoursSince),
        sessions_since: sessionIds.length,
      })

      const setAppState =
        context.toolUseContext.setAppStateForTasks ??
        context.toolUseContext.setAppState
      const abortController = new AbortController()
      const taskId = registerDreamTask(setAppState, {
        sessionsReviewing: sessionIds.length,
        consolidationLock,
        abortController,
      })
      const abort = () => abortController.abort()
      manual?.signal?.addEventListener('abort', abort, { once: true })
      if (manual?.signal?.aborted) abort()

      try {
        abortController.signal.throwIfAborted()
        const transcriptDir =
          manual?.transcriptDir ?? getSessionEngineDir() ?? getProjectDir(getOriginalCwd())
        // Tool constraints are specific to the background fork, so keep them
        // out of the reusable consolidation prompt body.
        const extra = `

**Tool constraints for this run:** Bash is restricted to read-only commands (\`ls\`, \`find\`, \`grep\`, \`cat\`, \`stat\`, \`wc\`, \`head\`, \`tail\`, and similar). Anything that writes, redirects to a file, or modifies state will be denied. Plan your exploration with this in mind — no need to probe.

Sessions since last consolidation (${sessionIds.length}):
${sessionIds.map(id => `- ${id}`).join('\n')}`
        const prompt = buildConsolidationPrompt(memoryRoot, transcriptDir, extra)

        const result = await runForkedAgent({
          promptMessages: [createUserMessage({ content: prompt })],
          cacheSafeParams: createCacheSafeParams(context),
          canUseTool: createAutoMemCanUseTool(memoryRoot),
          querySource: 'auto_dream',
          forkLabel: 'auto_dream',
          skipTranscript: true,
          overrides: { abortController },
          onMessage: makeDreamProgressWatcher(taskId, setAppState),
        })
        abortController.signal.throwIfAborted()
        const lastAssistant = result.messages.findLast(message => message.type === 'assistant')
        if (!lastAssistant || lastAssistant.isApiErrorMessage || lastAssistant.message.stop_reason === 'tool_use') {
          const errorText = lastAssistant?.isApiErrorMessage
            ? lastAssistant.message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
            : ''
          throw new Error(errorText || '模型未完成长期记忆整理，请重试。')
        }

        completeDreamTask(taskId, setAppState)
        lockSettled = true
        // Inline completion summary in the main transcript (same surface as
        // extractMemories's "Saved N memories" message).
        const dreamState = context.toolUseContext.getAppState().tasks?.[taskId]
        if (
          appendSystemMessage &&
          isDreamTask(dreamState) &&
          dreamState.filesTouched.length > 0
        ) {
          appendSystemMessage({
            ...createMemorySavedMessage(dreamState.filesTouched),
            verb: 'Improved',
          })
        }
        logForDebugging(
          `[autoDream] completed — cache: read=${result.totalUsage.cache_read_input_tokens} created=${result.totalUsage.cache_creation_input_tokens}`,
        )
        logEvent('tengu_auto_dream_completed', {
          cache_read: result.totalUsage.cache_read_input_tokens,
          cache_created: result.totalUsage.cache_creation_input_tokens,
          output: result.totalUsage.output_tokens,
          sessions_reviewed: sessionIds.length,
        })
        return {
          sessionsReviewed: sessionIds.length,
          summary: isDreamTask(dreamState)
            ? dreamState.turns.filter(turn => turn.text).at(-1)?.text || '长期记忆整理完成。'
            : '长期记忆整理完成。',
          filesTouched: isDreamTask(dreamState) ? dreamState.filesTouched : [],
        }
      } catch (e: unknown) {
        // If the user killed from the bg-tasks dialog, DreamTask.kill already
        // aborted, rolled back the lock, and set status=killed. Don't overwrite
        // or double-rollback.
        if (abortController.signal.aborted) {
          await DreamTask.kill(taskId, setAppState)
          lockSettled = true
          logForDebugging('[autoDream] aborted by user')
          if (manual) throw new Error('已停止整理长期记忆。')
          return
        }
        logForDebugging(`[autoDream] fork failed: ${(e as Error).message}`)
        logEvent('tengu_auto_dream_failed', {})
        failDreamTask(taskId, setAppState)
        if (consolidationLock) {
          await rollbackConsolidationLock(consolidationLock)
        }
        lockSettled = true
        if (manual) throw e
      } finally {
        manual?.signal?.removeEventListener('abort', abort)
      }
    } finally {
      if (consolidationLock && !lockSettled) {
        await rollbackConsolidationLock(consolidationLock)
      }
      if (consolidationLock) {
        await releaseConsolidationLock(consolidationLock)
      }
      activeMemoryRoots.delete(memoryRoot)
    }
  }
}

/**
 * Watch the forked agent's messages. For each assistant turn, extracts any
 * text blocks (the agent's reasoning/summary — what the user wants to see)
 * and collapses tool_use blocks to a count. Edit/Write file_paths are
 * collected for phase-flip + the inline completion message.
 */
function makeDreamProgressWatcher(
  taskId: string,
  setAppState: import('../../Task.js').SetAppState,
): (msg: Message) => void {
  return msg => {
    if (msg.type !== 'assistant') return
    let text = ''
    let toolUseCount = 0
    const touchedPaths: string[] = []
    for (const block of msg.message.content) {
      if (block.type === 'text') {
        text += block.text
      } else if (block.type === 'tool_use') {
        toolUseCount++
        if (
          block.name === FILE_EDIT_TOOL_NAME ||
          block.name === FILE_WRITE_TOOL_NAME
        ) {
          const input = block.input as { file_path?: unknown }
          if (typeof input.file_path === 'string') {
            touchedPaths.push(input.file_path)
          }
        }
      }
    }
    addDreamTurn(
      taskId,
      { text: text.trim(), toolUseCount },
      touchedPaths,
      setAppState,
    )
  }
}

/**
 * Entry point from stopHooks. No-op until initAutoDream() has been called.
 * Per-turn cost when enabled: one GB cache read + one stat.
 */
export async function executeAutoDream(
  context: REPLHookContext,
  appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {
  await runner?.(context, appendSystemMessage)
}

/** Global maintenance entry; it does not submit a prompt to a chat session. */
export async function executeManualDream(
  context: REPLHookContext,
  options: ManualDreamOptions,
): Promise<DreamResult> {
  if (!isAutoMemoryEnabled()) throw new Error('请先开启长期记忆。')
  options.signal?.throwIfAborted()
  if (!runner) initAutoDream()
  const result = await runner!(context, undefined, options)
  if (!result) throw new Error('无法完成长期记忆整理，请稍后重试。')
  return result
}
