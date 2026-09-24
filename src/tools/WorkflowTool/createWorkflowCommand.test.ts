import { describe, expect, test } from 'bun:test'
import { feature } from 'bun:bundle'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { clearCommandMemoizationCaches, getCommands } from '../../commands.js'
import { asSessionId } from '../../types/ids.js'
import { isCommandEnabled } from '../../types/command.js'
import { runWithSessionIdContext, type SessionExecutionEnvironment } from '../../utils/sessionIdContext.js'
import { getBundledWorkflows } from '../../utils/workflows/bundled/index.js'
import { createWorkflowCommand } from './createWorkflowCommand.js'

const scope = <T>(executionEnvironment: SessionExecutionEnvironment, fn: () => T) =>
  runWithSessionIdContext(asSessionId(executionEnvironment), null, fn, undefined, undefined, { executionEnvironment })
const testWithWorkflowFeature = feature('WORKFLOW_SCRIPTS') ? test : test.skip

describe('workflow commands in server sessions', () => {
  test('a previously loaded desktop command is disabled on the server', () => {
    const command = createWorkflowCommand(getBundledWorkflows()[0]!)
    expect(scope('desktop', () => isCommandEnabled(command))).toBe(true)
    expect(scope('server', () => isCommandEnabled(command))).toBe(false)
    expect(scope('desktop', () => isCommandEnabled(command))).toBe(true)
  })

  testWithWorkflowFeature('shared discovery cache preserves desktop commands without exposing them on the server', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-commands-'))
    const names = getBundledWorkflows().map(workflow => workflow.name)
    try {
      clearCommandMemoizationCaches()
      // Loading a server session first must not cache an empty workflow list
      // for later desktop sessions using the same cwd.
      for (const environment of ['server', 'desktop', 'server', 'desktop'] as const) {
        const commands = await scope(environment, () => getCommands(cwd))
        const workflows = commands.filter(command => names.includes(command.name))
        expect(workflows.map(command => command.name)).toEqual(environment === 'server' ? [] : names)
      }
    } finally {
      clearCommandMemoizationCaches()
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
