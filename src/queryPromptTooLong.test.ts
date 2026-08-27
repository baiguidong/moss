import { describe, expect, test } from 'bun:test'
import type { ToolUseContext } from './Tool.js'
import { query } from './query.js'
import type { QueryDeps } from './query/deps.js'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createCompactBoundaryMessage,
  createUserMessage,
} from './utils/messages.js'

function createTestAppState() {
  return {
    toolPermissionContext: { mode: 'default' },
    mcp: { clients: [], tools: [] },
    sessionHooks: new Map(),
  }
}

describe('query prompt-too-long recovery', () => {
  test('compacts once and continues the same query', async () => {
    const initialMessage = createUserMessage({ content: 'review the repository' })
    const compactSummary = createUserMessage({
      content: 'Earlier repository review context.',
      isCompactSummary: true,
    })
    let modelCalls = 0
    let compactCalls = 0
    const deps = {
      async *callModel() {
        modelCalls += 1
        yield modelCalls === 1
          ? createAssistantAPIErrorMessage({
              content: 'Prompt is too long',
              error: 'invalid_request',
            })
          : createAssistantMessage({ content: 'review complete' })
      },
      async microcompact(messages) {
        return { messages }
      },
      async autocompact() {
        return { wasCompacted: false }
      },
      async compactAfterPromptTooLong() {
        compactCalls += 1
        return {
          boundaryMarker: createCompactBoundaryMessage('auto', 180_000),
          summaryMessages: [compactSummary],
          attachments: [],
          hookResults: [],
        }
      },
      uuid: () => crypto.randomUUID(),
    } as unknown as QueryDeps
    const appState = createTestAppState()
    const context = {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'gpt-5.5',
        tools: [],
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      abortController: new AbortController(),
      readFileState: new Map(),
      getAppState: () => appState,
      setAppState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages: [initialMessage],
    } as unknown as ToolUseContext

    const output = []
    const iterator = query({
      messages: [initialMessage],
      systemPrompt: [],
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: context,
      querySource: 'agent:custom',
      deps,
    })
    let terminal
    for (;;) {
      const next = await iterator.next()
      if (next.done) {
        terminal = next.value
        break
      }
      output.push(next.value)
    }

    expect(modelCalls).toBe(2)
    expect(compactCalls).toBe(1)
    expect(output.some(message => (
      message.type === 'assistant' &&
      message.message.content.some(block => block.type === 'text' && block.text === 'Prompt is too long')
    ))).toBe(false)
    expect(output.some(message => message.type === 'system' && message.subtype === 'compact_boundary')).toBe(true)
    expect(output.some(message => (
      message.type === 'assistant' &&
      message.message.content.some(block => block.type === 'text' && block.text === 'review complete')
    ))).toBe(true)
    expect(terminal).toEqual({ reason: 'completed' })
  })

  test('surfaces a failed recovery once and stops', async () => {
    const initialMessage = createUserMessage({ content: 'review the repository' })
    let modelCalls = 0
    let compactCalls = 0
    const deps = {
      async *callModel() {
        modelCalls += 1
        yield createAssistantAPIErrorMessage({
          content: 'Prompt is too long',
          error: 'invalid_request',
        })
      },
      async microcompact(messages) {
        return { messages }
      },
      async autocompact() {
        return { wasCompacted: false }
      },
      async compactAfterPromptTooLong() {
        compactCalls += 1
        return null
      },
      uuid: () => crypto.randomUUID(),
    } as unknown as QueryDeps
    const appState = createTestAppState()
    const context = {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'gpt-5.5',
        tools: [],
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: true,
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
      abortController: new AbortController(),
      readFileState: new Map(),
      getAppState: () => appState,
      setAppState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages: [initialMessage],
    } as unknown as ToolUseContext

    const output = []
    const iterator = query({
      messages: [initialMessage],
      systemPrompt: [],
      userContext: {},
      systemContext: {},
      canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
      toolUseContext: context,
      querySource: 'agent:custom',
      deps,
    })
    let terminal
    for (;;) {
      const next = await iterator.next()
      if (next.done) {
        terminal = next.value
        break
      }
      output.push(next.value)
    }

    expect(modelCalls).toBe(1)
    expect(compactCalls).toBe(1)
    expect(output.some(message => (
      message.type === 'assistant' &&
      message.message.content.some(block => block.type === 'text' && block.text === 'Prompt is too long')
    ))).toBe(true)
    expect(terminal).toEqual({ reason: 'prompt_too_long' })
  })
})
