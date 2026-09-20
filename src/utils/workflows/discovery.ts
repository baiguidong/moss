import type { Dirent } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { logForDebugging } from '../debug.js'
import { getProjectDirsUpToHome } from '../markdownConfigLoader.js'
import { getBundledWorkflows } from './bundled/index.js'
import { loadPluginWorkflows } from './pluginWorkflows.js'
import { WORKFLOW_SCRIPT_MAX_BYTES } from './constants.js'
import { parseWorkflowDefinitionJson } from './definition.js'
import { getUserWorkflowsDir } from './paths.js'
import type { WorkflowDefinition, WorkflowSource } from './types.js'

/**
 * Every workflow runnable as a `/` command, most specific definition winning.
 *
 * Precedence, lowest to highest: bundled → plugin → personal
 * (`~/.moss/workflows`) → project, and within project the directory closest
 * to the working directory.
 * A project workflow shadowing a personal one is deliberate — it is how a repo
 * pins the version of a review its contributors run.
 */
export async function loadWorkflows(
  cwd: string = getOriginalCwd(),
): Promise<WorkflowDefinition[]> {
  const projectDirs = safeProjectDirs(cwd)

  const [plugins, personal, ...projectResults] = await Promise.all([
    loadPluginWorkflows(),
    loadWorkflowsFromDir(getUserWorkflowsDir(), 'userSettings'),
    ...projectDirs.map(dir => loadWorkflowsFromDir(dir, 'projectSettings')),
  ])

  const byName = new Map<string, WorkflowDefinition>()
  for (const workflow of getBundledWorkflows()) byName.set(workflow.name, workflow)
  // Plugin workflows are namespaced `plugin:name`, so they never collide with
  // a personal or project workflow and never need to lose a precedence fight.
  for (const workflow of plugins) byName.set(workflow.name, workflow)
  for (const workflow of personal ?? []) byName.set(workflow.name, workflow)
  // projectDirs is ordered most-specific first, so apply in reverse and let
  // the closest directory overwrite the ones above it.
  for (let i = projectResults.length - 1; i >= 0; i--) {
    for (const workflow of projectResults[i] ?? []) {
      byName.set(workflow.name, workflow)
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function findWorkflowByName(
  name: string,
  cwd?: string,
): Promise<WorkflowDefinition | undefined> {
  return (await loadWorkflows(cwd)).find(workflow => workflow.name === name)
}

/**
 * Read every `.workflow.json` definition in one directory.
 *
 * Files are parsed and validated as complete definitions, so a malformed file
 * is skipped with a log line rather than breaking `/` autocomplete for the
 * rest of the directory. Nothing here executes node JavaScript.
 */
export async function loadWorkflowsFromDir(
  dir: string,
  source: WorkflowSource,
  namePrefix?: string,
): Promise<WorkflowDefinition[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }

  const loaded = await Promise.all(
    entries.map(async entry => {
      if (!entry.isFile() && !entry.isSymbolicLink()) return null
      if (!entry.name.endsWith('.workflow.json')) return null
      const filePath = join(dir, entry.name)
      try {
        const stats = await stat(filePath)
        if (stats.size > WORKFLOW_SCRIPT_MAX_BYTES) {
          logForDebugging(
            `Workflow ${filePath} exceeds ${WORKFLOW_SCRIPT_MAX_BYTES} bytes — skipping`,
          )
          return null
        }
        const sourceText = await readFile(filePath, 'utf8')
        const parsed = parseWorkflowDefinitionJson(sourceText)
        if (!parsed.ok) {
          logForDebugging(
            `Workflow ${filePath} has an invalid definition: ${parsed.error} — skipping`,
          )
          return null
        }
        return {
          source,
          name: namePrefix
            ? `${namePrefix}:${parsed.definition.meta.name}`
            : parsed.definition.meta.name,
          title: parsed.definition.meta.title,
          description: parsed.definition.meta.description,
          definition: parsed.definition,
          filePath,
        } satisfies WorkflowDefinition
      } catch (error) {
        logForDebugging(
          `Workflow ${filePath} could not be read: ${error instanceof Error ? error.message : String(error)}`,
        )
        return null
      }
    }),
  )

  return loaded.filter(
    (entry): entry is NonNullable<typeof entry> => entry !== null,
  )
}

function safeProjectDirs(cwd: string): string[] {
  try {
    return getProjectDirsUpToHome('workflows', cwd)
  } catch (error) {
    logForDebugging(
      `loadWorkflows: project-dir walk failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return []
  }
}
