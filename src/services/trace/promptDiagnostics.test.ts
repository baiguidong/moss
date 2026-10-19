import { test, expect } from 'bun:test'
import { buildPromptDiagnostics } from './promptDiagnostics'

test('accounts for actual system/tool/message blocks and exact repeated text without storing prompt text', () => {
  const repeated = '内部提示中文😀'.repeat(20)
  const result = buildPromptDiagnostics({ model: 'fixture', system: [{ type: 'text', text: repeated }],
    tools: [{ name: 'Read', description: 'read', input_schema: { type: 'object' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: repeated }, { type: 'image', source: { data: 'encoded' } }] }] })!
  expect(result.rows.map(row => row.kind)).toEqual(['system', 'tool', 'message'])
  expect(result.rows[0].bytes).toBe(Buffer.byteLength(repeated))
  expect(result.rows[0].characters).toBe([...repeated].length)
  expect(result.rows[2].duplicateOf).toBe('system[0].text')
  expect(result.unmeasuredBlocks).toBe(1)
  expect(JSON.stringify(result)).not.toContain(repeated)
  expect(result.rows[1].name).toBe('Read')
})

test('supports Chat/Responses placement and distinguishes limits from complete accounting', () => {
  const chat = buildPromptDiagnostics({ messages: [{ role: 'developer', content: 'rule' }, { role: 'user', content: 'task' }] })!
  expect(chat.rows.map(row => row.kind)).toEqual(['system', 'message'])
  const responses = buildPromptDiagnostics({ instructions: 'rule', input: 'task', tools: [{ type: 'function', name: 'read' }] })!
  expect(responses.rows.map(row => row.location)).toEqual(['instructions', 'tools[0]', 'input'])
  const bounded = buildPromptDiagnostics({ system: 'x'.repeat(2_000_100), messages: [{ content: 'other' }] })!
  expect(bounded.truncated).toBe(true); expect(bounded.rows[0].truncated).toBe(true)
  expect(bounded.rows[0].bytes).toBe(2_000_000)
  expect(buildPromptDiagnostics(null)).toBeUndefined()
})

test('Chat tool calls/results and Responses function items disclose incomplete text coverage', () => {
  const chat = buildPromptDiagnostics({ messages: [
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: 'read', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call', content: 'tool result' },
    { role: 'assistant', content: null, function_call: { name: 'read', arguments: '{}' } },
    { role: 'function', name: 'read', content: 'legacy result' },
  ] })!
  expect(chat.rows.map(row => row.location)).toEqual(['messages[0].content'])
  expect(chat.unmeasuredBlocks).toBe(4)
  const responses = buildPromptDiagnostics({ input: [
    { type: 'function_call', call_id: 'call', name: 'read', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call', output: 'tool result' },
  ] })!
  expect(responses.rows).toHaveLength(0)
  expect(responses.unmeasuredBlocks).toBe(2)
})
