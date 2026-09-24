import type { Tool } from '../Tool.js'
import { getSessionRuntimeContext } from './sessionIdContext.js'

/** Apply to every pool, including dynamically contributed and deferred tools. */
export function filterToolsForSession<T extends Pick<Tool, 'supportedEnvironments' | 'requiresDesktop'>>(
  tools: readonly T[],
): T[] {
  const environment = getSessionRuntimeContext()?.executionEnvironment ?? 'desktop'
  return tools.filter(tool => (!tool.supportedEnvironments || tool.supportedEnvironments.includes(environment))
    && !(getSessionRuntimeContext()?.unattended && tool.requiresDesktop))
}
