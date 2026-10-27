import { expect, spyOn, test } from 'bun:test'
import * as queryModule from '../query.js'
import { getDefaultAppState } from '../state/AppStateStore.js'
import type { ToolUseContext } from '../Tool.js'
import { createSubagentContext, runForkedAgent } from './forkedAgent.js'
import { createFileStateCacheWithSizeLimit } from './fileStateCache.js'
import { buildEffectiveSystemPrompt } from './systemPrompt.js'
import { buildSideQuestionFallbackParams } from './queryContext.js'
import { asSystemPrompt } from './systemPromptType.js'

const mainOnly = 'MAIN_ONLY_DELIVERY_INSTRUCTIONS'
function parentContext(): ToolUseContext {
  return {
    options: { tools: [], commands: [], mcpClients: [], mainLoopModel: 'fixture-model',
      appendSystemPrompt: 'SHARED_RULES', mainSessionSystemPrompt: mainOnly },
    abortController: new AbortController(), readFileState: createFileStateCacheWithSizeLimit(100), messages: [],
    getAppState: getDefaultAppState, setAppState: () => {},
  } as unknown as ToolUseContext
}

test('main prompt rebuilding is additive; worker options retain shared rules only', () => {
  const parent = parentContext()
  const sharedTool = { name: 'Read' } as ToolUseContext['options']['tools'][number]
  const mainTool = { name: 'moss_present', requiresInteractiveMainSession: true } as ToolUseContext['options']['tools'][number]
  parent.options.tools = [sharedTool, mainTool]
  parent.options.refreshTools = () => [sharedTool, mainTool]
  const build = (context: ToolUseContext, customSystemPrompt?: string) => buildEffectiveSystemPrompt({
    mainThreadAgentDefinition: undefined, toolUseContext: context, customSystemPrompt,
    defaultSystemPrompt: ['DEFAULT_IDENTITY'], appendSystemPrompt: context.options.appendSystemPrompt,
  })
  expect(build(parent)).toEqual(['DEFAULT_IDENTITY', 'SHARED_RULES', mainOnly])
  expect(build(parent, 'CUSTOM_IDENTITY')).toEqual(['CUSTOM_IDENTITY', 'SHARED_RULES', mainOnly])
  for (const overrides of [undefined, { options: parent.options }]) {
    const child = createSubagentContext(parent, overrides)
    expect(child.options.mainSessionSystemPrompt).toBeUndefined()
    expect(child.options.appendSystemPrompt).toBe('SHARED_RULES')
    expect(build(child)).not.toContain(mainOnly)
    expect(child.options.tools).toEqual([sharedTool])
    expect(child.options.refreshTools?.()).toEqual([sharedTool])
  }
  expect(parent.options.mainSessionSystemPrompt).toBe(mainOnly)
  expect(parent.options.tools).toContain(mainTool)
})

test('background forks remove the main-only rendered block before the query loop', async () => {
  let captured: Parameters<typeof queryModule.query>[0] | undefined
  const query = spyOn(queryModule, 'query').mockImplementation(async function* (params) { captured = params })
  try {
    await runForkedAgent({
      promptMessages: [], cacheSafeParams: {
        systemPrompt: asSystemPrompt(['DEFAULT_IDENTITY', 'SHARED_RULES', mainOnly]),
        userContext: {}, systemContext: {}, forkContextMessages: [], toolUseContext: parentContext(),
      }, canUseTool: async (_tool, input) => ({ behavior: 'allow', updatedInput: input }),
      querySource: 'side_question', forkLabel: 'scope-test', skipTranscript: true,
    })
    expect(captured?.systemPrompt).toEqual(['DEFAULT_IDENTITY', 'SHARED_RULES'])
    expect(captured?.toolUseContext.options.mainSessionSystemPrompt).toBeUndefined()
  } finally { query.mockRestore() }
})

test('restored side-question prefix retains main-only instructions without replacing identity', async () => {
  const parent = parentContext()
  const rebuilt = await buildSideQuestionFallbackParams({ tools: [], commands: [], mcpClients: [], messages: [],
    readFileState: parent.readFileState, getAppState: parent.getAppState, setAppState: parent.setAppState,
    customSystemPrompt: 'CUSTOM_IDENTITY', appendSystemPrompt: 'SHARED_RULES', mainSessionSystemPrompt: mainOnly,
    thinkingConfig: { type: 'disabled' }, agents: [], mainLoopModel: 'fixture-model' })
  expect(rebuilt.systemPrompt).toEqual(['CUSTOM_IDENTITY', 'SHARED_RULES', mainOnly])
  expect(rebuilt.toolUseContext.options.mainSessionSystemPrompt).toBe(mainOnly)
})
