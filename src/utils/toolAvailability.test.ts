import { describe, expect, test } from 'bun:test'
import { feature } from 'bun:bundle'
import type { ToolUseContext } from '../Tool.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import { assembleToolPool } from '../tools.js'
import { createAppContributionTools } from '../tools/AppContributionTool/AppContributionTool.js'
import { LibraryTools } from '../tools/LibraryTool/LibraryTools.js'
import { MossMailTool } from '../tools/MossMailTool/MossMailTool.js'
import { MossTools } from '../tools/MossTool/MossTool.js'
import { ToolSearchTool } from '../tools/ToolSearchTool/ToolSearchTool.js'
import { WorkflowCatalogTools } from '../tools/WorkflowTool/WorkflowCatalogTools.js'
import { WorkflowRunTool } from '../tools/WorkflowTool/WorkflowTool.js'
import { asSessionId } from '../types/ids.js'
import { mergeAndFilterTools } from './toolPool.js'
import { getSessionRuntimeContext, runWithSessionIdContext, runWithSessionIdContextGenerator, runWithSessionContextOverridesGenerator, type SessionRuntime } from './sessionIdContext.js'

const workflowTools = [WorkflowRunTool, ...WorkflowCatalogTools]
const workflowNames = workflowTools.map(tool => tool.name)
const denied = [
  'app_build', 'app_preview', 'app_publish', 'app_launch', 'app_update', 'app_extract_to_workspace', 'app_get_versions',
  'library_write', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_press', 'browser_scroll', 'browser_wait', 'browser_reload',
  'connector_cli_setup', 'connector_mcp_authenticate', 'example_app_action',
  ...workflowNames,
]
const image = { provider: 'openai', url: 'https://image.test', apiKey: 'test-key', model: 'image-model' }
const appTools = createAppContributionTools([{
  id: 'example/action', name: 'example_app_action', title: 'App action', description: 'Test contribution',
  appId: 'example', effect: 'read', inputSchemaDocument: { type: 'object' },
}])
const state = getDefaultAppState()
const assembleWorker = () => assembleToolPool(state.toolPermissionContext, [])
const assembleMain = () => mergeAndFilterTools(
  [...MossTools, ...LibraryTools, MossMailTool, ...appTools, ...workflowTools], assembleWorker(), state.toolPermissionContext.mode,
)
const scope = <T>(environment: SessionRuntime['executionEnvironment'], fn: () => T) =>
  runWithSessionIdContext(asSessionId(environment), null, fn, undefined, undefined, { executionEnvironment: environment, image })

describe('session tool availability', () => {
  test('filters main and independently assembled worker pools, including dynamic extras', () => {
    scope('server', () => {
      for (const pool of [assembleMain(), assembleWorker()]) {
        const names = pool.map(tool => tool.name)
        expect(names.filter(name => denied.includes(name))).toEqual([])
        expect(names).toContain('browser_open')
        expect(names).toContain('Read')
        expect(names).toContain('image_generate')
        expect(names).toContain('image_edit')
      }
      expect(assembleMain().map(tool => tool.name)).toContain(MossMailTool.name)
      expect(assembleMain().map(tool => tool.name)).toContain('library_read')
    })
    scope('desktop', () => {
      const names = assembleMain().map(tool => tool.name)
      expect(denied.filter(name => !names.includes(name))).toEqual([])
      if (feature('WORKFLOW_SCRIPTS')) {
        const workerNames = assembleWorker().map(tool => tool.name)
        expect(workflowNames.filter(name => !workerNames.includes(name))).toEqual([])
      }
    })
  })

  test('ToolSearch cannot select or expand into excluded tools after a refresh', async () => {
    await scope('server', async () => {
      for (const pool of [assembleMain(), assembleMain(), assembleWorker()]) {
        const context = { options: { tools: pool }, getAppState: () => state } as ToolUseContext
        for (const query of [
          'select:app_build,library_write,example_app_action', 'app build publish',
          `select:${workflowNames.join(',')}`, 'workflow create edit manage run',
        ]) {
          const result = await ToolSearchTool.call({ query, max_results: 10 }, context)
          expect(result.data.matches.filter(name => denied.includes(name))).toEqual([])
        }
        const result = await ToolSearchTool.call({ query: 'select:browser_open', max_results: 10 }, context)
        expect(result.data.matches).toEqual(['browser_open'])
      }
    })
  })

  test('interleaved session generators and resumed worker overrides retain their own runtime', async () => {
    function iterator(executionEnvironment: SessionRuntime['executionEnvironment']) {
      return runWithSessionIdContextGenerator(asSessionId(executionEnvironment), null, async function* () {
        expect(assembleMain().filter(tool => workflowNames.includes(tool.name)).length)
          .toBe(executionEnvironment === 'server' ? 0 : 4)
        yield assembleMain().some(tool => tool.name === 'app_build')
        yield* runWithSessionContextOverridesGenerator({ environment: { WORKER: '1' } }, async function* () {
          await Promise.resolve()
          expect(getSessionRuntimeContext()?.image).toEqual(image)
          expect(assembleMain().filter(tool => workflowNames.includes(tool.name)).length)
            .toBe(executionEnvironment === 'server' ? 0 : 4)
          yield assembleWorker().some(tool => tool.name === 'app_build')
        })
      }, undefined, undefined, { executionEnvironment, image })
    }
    const server = iterator('server')
    const desktop = iterator('desktop')
    expect((await server.next()).value).toBe(false)
    expect((await desktop.next()).value).toBe(true)
    expect((await server.next()).value).toBe(false)
    expect((await desktop.next()).value).toBe(true)
    await server.next()
    await desktop.next()
    expect(getSessionRuntimeContext()).toBeUndefined()
  })
})

test('unattended cloud sessions and workers exclude desktop-dependent tools', async () => {
  await runWithSessionIdContext(asSessionId('cloud-cron'), null, async () => {
    for (const pool of [assembleMain(), assembleWorker()]) {
      expect(pool.map(tool => tool.name).filter(name => ['browser_open','library_list','library_search','library_read','MossMail'].includes(name))).toEqual([])
      expect(pool.map(tool => tool.name)).toContain('image_generate')
    }
    const worker = runWithSessionContextOverridesGenerator({ environment: {} }, async function* () {
      yield assembleMain().some(tool => tool.name === 'browser_open')
    })
    expect((await worker.next()).value).toBe(false)
    await worker.next()
  }, undefined, undefined, { executionEnvironment:'server', unattended:true, image })
})
