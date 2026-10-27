import { applyAppToolPolicy } from './appToolPolicy.js'
import type { Tool } from '../Tool.js'
import { getSessionRuntimeContext } from './sessionIdContext.js'

/** Apply to every pool, including dynamically contributed and deferred tools. */
export function filterToolsForSession<T extends Pick<Tool, 'supportedEnvironments' | 'requiresDesktop' | 'requiresPresentation' | 'appInfo' | 'isMcp' | 'mcpInfo'>>(
  tools: readonly T[],
): T[] {
  const environment = getSessionRuntimeContext()?.executionEnvironment ?? 'desktop'
  const policy = getSessionRuntimeContext()?.appToolPolicy
  const scoped = policy ? applyAppToolPolicy(tools, policy) : tools
  return scoped.filter(tool => (!tool.supportedEnvironments || tool.supportedEnvironments.includes(environment))
    && (!tool.requiresPresentation || getSessionRuntimeContext()?.presentationEnabled === true)
    && !(getSessionRuntimeContext()?.unattended && tool.requiresDesktop))
}
