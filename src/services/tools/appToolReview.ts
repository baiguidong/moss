import { getGlobalAppEventBridge, type Tool, type ToolUseContext } from '../../Tool.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AssistantMessage } from '../../types/message.js'
import { AsyncResource } from 'node:async_hooks'

/** Host user policy runs after ordinary permission checks, including bypass mode. */
export async function reviewAppToolCall<T>(tool: Tool, args: Record<string, unknown>, context: ToolUseContext,
  canUseTool: CanUseToolFn, parent: AssistantMessage, invoke: (input: Record<string, unknown>, reviewed: boolean) => Promise<T>): Promise<T> {
  const identity = tool.mcpInfo?.appId ? { kind: 'mcp' as const, appId: tool.mcpInfo.appId, serverName: tool.mcpInfo.serverName, toolName: tool.mcpInfo.toolName }
    : tool.appInfo?.contributionId ? { kind: 'app' as const, appId: tool.appInfo.appId, contributionId: tool.appInfo.contributionId } : null
  const emitAppEvent = context.emitAppEvent ?? getGlobalAppEventBridge()
  if (!identity || !emitAppEvent) return invoke(args, false)
  const result = await emitAppEvent({
    type: 'tool_call_review', input: { ...identity, toolName: identity.kind === 'mcp' ? identity.toolName : tool.name,
      arguments: args, schema: tool.inputJSONSchema, toolUseId: context.toolUseId! },
    signal: context.abortController.signal,
    // Functions are in-process authority. Remote messages cannot supply them.
    execute: AsyncResource.bind(async (input, reviewed, onDispatch) => {
      context.abortController.signal.throwIfAborted()
      if (reviewed) {
        const validation = await tool.validateInput?.(input, context)
        if (validation && !validation.result) throw new Error(validation.message)
        const permission = await canUseTool(tool, input, context, parent, context.toolUseId!)
        if (permission.behavior !== 'allow') throw new Error('当前参数未获得工具调用权限。')
        if (permission.updatedInput && JSON.stringify(permission.updatedInput) !== JSON.stringify(input)) throw new Error('权限检查修改了参数，请重新生成草稿。')
      }
      await onDispatch?.()
      return invoke(input, reviewed)
    }),
  })
  if (!result.ok) throw new Error(result.error)
  return result.result as T
}
