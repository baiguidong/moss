import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import type { PermissionUpdate } from '../../../utils/permissions/PermissionUpdateSchema.js'
import { hasPermissionsToUseTool } from '../../../utils/permissions/permissions.js'
import type { PermissionContext } from '../PermissionContext.js'
import { createResolveOnce } from '../PermissionContext.js'

type InteractivePermissionParams = {
  ctx: PermissionContext
  description: string
  result: PermissionDecision & { behavior: 'ask' }
  awaitAutomatedChecksBeforeDialog: boolean | undefined
}

/**
 * Handles the interactive (main-agent) permission flow.
 *
 * Pushes a ToolUseConfirm entry to the confirm queue with callbacks:
 * onAbort, onAllow, onReject, and recheckPermission.
 *
 * Runs permission hooks asynchronously in the background while the user can
 * respond to the dialog. Uses a resolve-once guard to prevent duplicate
 * resolutions.
 *
 * This function does NOT return a Promise -- it sets up callbacks that
 * eventually call `resolve()` to resolve the outer promise owned by
 * the caller.
 */
function handleInteractivePermission(
  params: InteractivePermissionParams,
  resolve: (decision: PermissionDecision) => void,
): void {
  const {
    ctx,
    description,
    result,
    awaitAutomatedChecksBeforeDialog,
  } = params

  const { resolve: resolveOnce, isResolved, claim } = createResolveOnce(resolve)
  const permissionPromptStartTimeMs = Date.now()
  const displayInput = result.updatedInput ?? ctx.input

  ctx.pushToQueue({
    assistantMessage: ctx.assistantMessage,
    tool: ctx.tool,
    description,
    input: displayInput,
    toolUseContext: ctx.toolUseContext,
    toolUseID: ctx.toolUseID,
    permissionResult: result,
    permissionPromptStartTimeMs,
    onAbort() {
      if (!claim()) return
      ctx.logCancelled()
      ctx.logDecision(
        { decision: 'reject', source: { type: 'user_abort' } },
        { permissionPromptStartTimeMs },
      )
      resolveOnce(ctx.cancelAndAbort(undefined, true))
    },
    async onAllow(
      updatedInput,
      permissionUpdates: PermissionUpdate[],
      feedback?: string,
      contentBlocks?: ContentBlockParam[],
    ) {
      if (!claim()) return // atomic check-and-mark before await

      resolveOnce(
        await ctx.handleUserAllow(
          updatedInput,
          permissionUpdates,
          feedback,
          permissionPromptStartTimeMs,
          contentBlocks,
          result.decisionReason,
        ),
      )
    },
    onReject(feedback?: string, contentBlocks?: ContentBlockParam[]) {
      if (!claim()) return

      ctx.logDecision(
        {
          decision: 'reject',
          source: { type: 'user_reject', hasFeedback: !!feedback },
        },
        { permissionPromptStartTimeMs },
      )
      resolveOnce(ctx.cancelAndAbort(feedback, undefined, contentBlocks))
    },
    async recheckPermission() {
      if (isResolved()) return
      const freshResult = await hasPermissionsToUseTool(
        ctx.tool,
        ctx.input,
        ctx.toolUseContext,
        ctx.assistantMessage,
        ctx.toolUseID,
      )
      if (freshResult.behavior === 'allow') {
        // claim() (atomic check-and-mark), not isResolved(), because the
        // asynchronous permission recheck can race with local interaction.
        if (!claim()) return
        ctx.removeFromQueue()
        ctx.logDecision({ decision: 'accept', source: 'config' })
        resolveOnce(ctx.buildAllow(freshResult.updatedInput ?? ctx.input))
      }
    },
  })

  // Skip hooks if they were already awaited in the coordinator branch above
  if (!awaitAutomatedChecksBeforeDialog) {
    // Execute PermissionRequest hooks asynchronously
    // If hook returns a decision before user responds, apply it
    void (async () => {
      if (isResolved()) return
      const currentAppState = ctx.toolUseContext.getAppState()
      const hookDecision = await ctx.runHooks(
        currentAppState.toolPermissionContext.mode,
        result.suggestions,
        result.updatedInput,
        permissionPromptStartTimeMs,
      )
      if (!hookDecision || !claim()) return
      ctx.removeFromQueue()
      resolveOnce(hookDecision)
    })()
  }

}

// --

export { handleInteractivePermission }
export type { InteractivePermissionParams }
