import { randomBytes } from 'crypto'
import { join } from 'path'
import {
  getOriginalCwd,
  getSessionEngineDir,
  getSessionId,
} from '../../bootstrap/state.js'
import { getTaskScopeContext } from '../sessionIdContext.js'
import { getMossConfigHomeDir } from '../envUtils.js'
import { getProjectDir } from '../sessionStorage.js'

/** `~/.moss/workflows` — personal workflows, available in every project. */
export function getUserWorkflowsDir(): string {
  return join(getMossConfigHomeDir(), 'workflows')
}

/**
 * A fresh run id. Shaped `wf_<8 hex>-<3 hex>` so it is short enough to read in
 * the progress view and still collision-free within a session.
 */
export function createWorkflowRunId(): string {
  const bytes = randomBytes(6).toString('hex')
  return `wf_${bytes.slice(0, 8)}-${bytes.slice(8, 11)}`
}

/** Subdirectory (relative to `subagents/`) holding this run's journal. */
export function getWorkflowTranscriptSubdir(runId: string): string {
  return join('workflows', runId)
}

/**
 * Desktop runtimes may be recreated with a new engine session id while the
 * visible conversation remains the same. Workflow artifacts belong to that
 * stable conversation so history survives runtime replacement and restart.
 */
function getWorkflowStorageSessionId(): string {
  const ownerSessionId = getTaskScopeContext()?.sessionId
  return typeof ownerSessionId === 'string' && ownerSessionId.trim()
    ? ownerSessionId
    : String(getSessionId())
}

/**
 * Absolute directory for a run's workflow-specific artifacts. Agent
 * transcripts stay in the session's normal flat subagent directory so the
 * existing transcript reader can open them; this directory holds the journal.
 */
export function getWorkflowTranscriptDir(runId: string): string {
  const projectDir = getSessionEngineDir() ?? getProjectDir(getOriginalCwd())
  return join(
    projectDir,
    getWorkflowStorageSessionId(),
    'subagents',
    getWorkflowTranscriptSubdir(runId),
  )
}

/** Where the executed structured definition is persisted for replay/export. */
export function getWorkflowDefinitionPath(runId: string, name: string): string {
  const projectDir = getSessionEngineDir() ?? getProjectDir(getOriginalCwd())
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64) || 'workflow'
  return join(
    projectDir,
    getWorkflowStorageSessionId(),
    'workflows',
    `${safeName}.${runId}.workflow.json`,
  )
}

/** Durable run snapshot used by the desktop after the live task is gone. */
export function getWorkflowRunPath(runId: string, name: string): string {
  const projectDir = getSessionEngineDir() ?? getProjectDir(getOriginalCwd())
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64) || 'workflow'
  return join(projectDir, getWorkflowStorageSessionId(), 'workflows', `${safeName}.${runId}.run.json`)
}

export function getWorkflowJournalPath(runId: string): string {
  return join(getWorkflowTranscriptDir(runId), 'journal.jsonl')
}
