import { createChildAbortController } from '../../utils/abortController.js'
import { runForkedAgent, type ForkedAgentParams } from '../../utils/forkedAgent.js'

export const SESSION_MEMORY_MAX_TURNS = 3
export const SESSION_MEMORY_TIMEOUT_MS = 120_000

/** Bound background work independently of the foreground conversation. */
export async function runMemoryUpdate(
  params: Omit<ForkedAgentParams, 'querySource' | 'maxTurns' | 'onMessage'>,
  run = runForkedAgent,
): Promise<void> {
  const controller = createChildAbortController(params.cacheSafeParams.toolUseContext.abortController)
  const timer = setTimeout(() => {
    controller.abort(new Error('Session memory update timed out.'))
  }, SESSION_MEMORY_TIMEOUT_MS)
  timer.unref?.()
  try {
    controller.signal.throwIfAborted()
    await run({
      ...params,
      querySource: 'session_memory',
      maxTurns: SESSION_MEMORY_MAX_TURNS,
      overrides: { ...params.overrides, abortController: controller },
      onMessage(message) {
        // A stale edit cannot be repaired by retrying the same snapshot. Stop
        // this extraction; a later update will read the summary afresh.
        if (message.type === 'user' && Array.isArray(message.message.content)) {
          const failed = message.message.content.find(block => block.type === 'tool_result' && block.is_error)
          if (failed) controller.abort(new Error('Session memory tool failed; stopped the update.'))
        } else if (message.type === 'attachment' && message.attachment.type === 'max_turns_reached') {
          controller.abort(new Error('Session memory update reached its turn limit.'))
        } else if (message.type === 'assistant' && message.isApiErrorMessage) {
          controller.abort(new Error('Session memory model request failed.'))
        }
      },
    })
    controller.signal.throwIfAborted()
  } finally {
    clearTimeout(timer)
    // Detach the child controller from the parent after successful completion too.
    controller.abort()
  }
}
