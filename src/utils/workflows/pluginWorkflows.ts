import type { WorkflowDefinition } from './types.js'

/**
 * Moss does not currently expose a plugin workflow loader. Keep discovery's
 * source contract intact so plugin workflows can be added later without
 * coupling the workflow runtime to a missing subsystem.
 */
export async function loadPluginWorkflows(): Promise<WorkflowDefinition[]> {
  return []
}
