import type { ToolPermissionContext } from '../../Tool.js'
import type { AgentDefinition } from './loadAgentsDir.js'

type AgentPermissionDefinition = Pick<
  AgentDefinition,
  'enforcePermissionMode' | 'permissionMode'
>

/** Apply an agent's permission mode without allowing a privileged parent or
 * inherited allow rules to weaken an enforced built-in policy. */
export function applyAgentPermissionConstraints(
  agentDefinition: AgentPermissionDefinition,
  context: ToolPermissionContext,
  parentContext: ToolPermissionContext,
): ToolPermissionContext {
  const mode = agentDefinition.permissionMode
  if (!mode) return context

  if (agentDefinition.enforcePermissionMode) {
    return {
      ...context,
      mode,
      alwaysAllowRules: {},
      isBypassPermissionsModeAvailable: false,
    }
  }

  if (
    parentContext.mode === 'bypassPermissions' ||
    parentContext.mode === 'acceptEdits'
  ) {
    return context
  }

  return {
    ...context,
    mode,
  }
}
