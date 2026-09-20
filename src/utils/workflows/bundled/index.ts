import { parseWorkflowDefinition } from '../definition.js'
import type { WorkflowDefinition } from '../types.js'
import { DEEP_RESEARCH_DEFINITION } from './deepResearch.js'

const BUNDLED_DEFINITIONS = [DEEP_RESEARCH_DEFINITION]

let cached: WorkflowDefinition[] | null = null

export function getBundledWorkflows(): WorkflowDefinition[] {
  if (cached) return cached
  cached = BUNDLED_DEFINITIONS.map(definition => {
    const parsed = parseWorkflowDefinition(definition)
    if (!parsed.ok) {
      throw new Error(`Bundled workflow failed to validate: ${parsed.error}`)
    }
    return {
      source: 'built-in' as const,
      name: parsed.definition.meta.name,
      title: parsed.definition.meta.title,
      description: parsed.definition.meta.description,
      definition: parsed.definition,
    }
  })
  return cached
}

export function resetBundledWorkflowsForTesting(): void {
  cached = null
}
