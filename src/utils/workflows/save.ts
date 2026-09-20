import { join, resolve } from 'path'
import { getOriginalCwd, getSessionId } from '../../bootstrap/state.js'
import { findGitRoot } from '../git.js'
import {
  parseWorkflowDefinition,
  type WorkflowDefinitionV3,
} from './definition.js'
import { getUserWorkflowsDir } from './paths.js'
import { createWorkflowDraft, publishWorkflow } from './catalog.js'

export type WorkflowSaveScope = 'user' | 'project'

export type WorkflowSaveResult =
  | { name: string; filePath: string; workflowId: string; revision: number }
  | { error: string }

export async function saveWorkflowDefinition(params: {
  definition: WorkflowDefinitionV3
  scope: WorkflowSaveScope
  cwd?: string
}): Promise<WorkflowSaveResult> {
  const parsed = parseWorkflowDefinition(params.definition)
  if (!parsed.ok) return { error: parsed.error }

  const cwd = params.cwd ?? getOriginalCwd()
  const dir = params.scope === 'project'
    ? resolveProjectWorkflowsDir(cwd)
    : getUserWorkflowsDir()
  const filePath = join(dir, `${parsed.definition.meta.name}.workflow.json`)

  try {
    const created = await createWorkflowDraft({
      definition: parsed.definition,
      scope: params.scope,
      cwd,
      origin: currentSessionOrigin(),
      changeSummary: 'Saved from a Workflow run',
    })
    const published = await publishWorkflow({ workflowId: created.record.id, cwd })
    return {
      name: parsed.definition.meta.name,
      filePath,
      workflowId: published.record.id,
      revision: published.record.publishedRevision ?? published.record.currentRevision,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function currentSessionOrigin(): { sessionId: string } | undefined {
  try {
    const sessionId = String(getSessionId())
    return sessionId ? { sessionId } : undefined
  } catch {
    return undefined
  }
}

export function resolveProjectWorkflowsDir(cwd: string): string {
  const root = findGitRoot(cwd) ?? resolve(cwd)
  return join(root, '.moss', 'workflows')
}
