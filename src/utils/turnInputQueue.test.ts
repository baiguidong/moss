import { expect, test } from 'bun:test'
import { TurnInputQueue } from './turnInputQueue'
import { query } from '../query'
import { createAssistantMessage, createUserMessage } from './messages'
import type { ToolUseContext } from '../Tool'
import type { QueryDeps } from '../query/deps'
import { asSystemPrompt } from './systemPromptType'

test('foreground inboxes isolate sessions, close atomically, and preserve cancelled inputs', () => {
  const a = new TurnInputQueue(), b = new TurnInputQueue(), states: string[] = []
  a.open(); b.open()
  expect(a.accept({ id: 'a', text: 'amend task A', onState: state => states.push(state) })).toBe(true)
  expect(b.take()).toEqual([])
  expect(a.take()).toHaveLength(1)
  expect(a.take(true)).toEqual([])
  expect(a.accept({ id: 'late', text: 'too late', onState: () => {} })).toBe(false)
  a.open(); a.accept({ id: 'pending', text: 'keep this', onState: state => states.push(state) }); a.close()
  expect(states).toEqual(['cancelled'])
})

test('accepted input is incorporated before the next model request and closing rejects late arrivals', async () => {
  const inbox = new TurnInputQueue(); inbox.open()
  let calls = 0
  const initial = createUserMessage({ content: 'Original task' })
  const supplemental = createUserMessage({ content: 'Also use Chinese', uuid: crypto.randomUUID() })
  const appState = { toolPermissionContext: { mode: 'default' }, mcp: { clients: [], tools: [] }, sessionHooks: new Map() }
  const context = {
    options: { commands: [], debug: false, mainLoopModel: 'fixture', tools: [], verbose: false, thinkingConfig: { type: 'disabled' },
      mcpClients: [], mcpResources: {}, isNonInteractiveSession: true, agentDefinitions: { activeAgents: [], allAgents: [] } },
    abortController: new AbortController(), readFileState: new Map(), getAppState: () => appState, setAppState: () => {},
    setInProgressToolUseIDs: () => {}, setResponseLength: () => {}, updateFileHistoryState: () => {}, updateAttributionState: () => {}, messages: [initial],
    takePendingUserMessages: (close: boolean) => inbox.take(close).map(() => supplemental), closePendingUserMessages: () => inbox.close(),
  } as unknown as ToolUseContext
  const seen: unknown[] = []
  const deps = {
    async *callModel({ messages }: { messages: unknown[] }) {
      seen.push(messages); calls++
      if (calls === 1) inbox.accept({ id: supplemental.uuid, text: 'Also use Chinese', onState: () => {} })
      yield createAssistantMessage({ content: calls === 1 ? 'Working' : '完成' })
    },
    async microcompact(messages: unknown[]) { return { messages } }, async autocompact() { return { wasCompacted: false } },
    uuid: () => crypto.randomUUID(),
  } as unknown as QueryDeps
  const output = []
  for await (const message of query({ messages: [initial], systemPrompt: asSystemPrompt([]), userContext: {}, systemContext: {},
    canUseTool: async () => ({ behavior: 'deny', message: 'no tools', decisionReason: { type: 'other', reason: 'test' } }), toolUseContext: context, querySource: 'agent:custom', deps })) output.push(message)
  expect(calls).toBe(2)
  expect(JSON.stringify(seen[0])).not.toContain('Also use Chinese')
  expect(JSON.stringify(seen[1])).toContain('Also use Chinese')
  expect(output.filter(message => message.type === 'user' && message.uuid === supplemental.uuid)).toHaveLength(1)
  expect(inbox.accept({ id: 'late', text: 'late', onState: () => {} })).toBe(false)
})
