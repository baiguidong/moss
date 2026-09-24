import { describe, expect, mock, test } from 'bun:test'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))

const { createAssistantMessage, createUserMessage, ensureToolResultPairing, normalizeMessagesForAPI } =
  await import('./messages.js')

function assistant(content: unknown[], id: unknown) {
  const message = createAssistantMessage({ content: content as never })
  // Compatible gateways and older transcripts can omit the response ID.
  message.message.id = id as string
  return message
}

const call = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: { command: 'df' } })
const result = (id: string) => createUserMessage({
  content: [{ type: 'tool_result', tool_use_id: id, content: 'Filesystem ...' }],
})

describe('assistant response boundaries', () => {
  for (const id of [undefined, null, '']) {
    test(`keeps repeated df requests after the previous answer when response ID is ${String(id)}`, () => {
      const messages = [
        createUserMessage({ content: '执行 df 命令，并将完整结果发送给我' }),
        assistant([call('first')], id),
        result('first'),
        assistant([{ type: 'text', text: 'Filesystem ...' }], id),
        createUserMessage({ content: '执行 df 命令，并将完整结果发送给我' }),
        assistant([call('second')], id),
        result('second'),
      ]
      const normalized = normalizeMessagesForAPI(messages)
      expect(normalized.map(m => m.message.content)).toEqual(messages.map(m => m.message.content))
      expect(normalized.at(-1)?.message.content).toEqual(result('second').message.content)
    })
  }

  test('does not replay the summary instruction after successful edits in an older transcript', () => {
    const messages = [
      createUserMessage({ content: 'Run df' }),
      assistant([call('df')], undefined), result('df'),
      assistant([{ type: 'text', text: 'Filesystem ...' }], undefined),
      createUserMessage({ content: 'Update the session notes using Edit, then stop.' }),
      assistant([{ type: 'tool_use', id: 'edit', name: 'Edit', input: {
        file_path: '/summary.md', old_string: 'pending', new_string: 'done',
      } }], undefined),
      createUserMessage({ content: [{ type: 'tool_result', tool_use_id: 'edit', content: 'Updated successfully.' }] }),
    ]
    const normalized = normalizeMessagesForAPI(messages)
    expect(normalized.map(m => m.message.content)).toEqual(messages.map(m => m.message.content))
  })

  test('still merges streamed blocks with a real shared response ID across tool results', () => {
    const messages = [
      createUserMessage({ content: 'Inspect two filesystems' }),
      assistant([call('a')], 'response-a'), result('a'),
      assistant([call('b')], 'response-a'), result('b'),
      assistant([{ type: 'text', text: 'Done' }], 'response-b'),
    ]
    const normalized = normalizeMessagesForAPI(messages)
    expect(normalized.map(m => m.type)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(normalized[1]?.message.content).toEqual([call('a'), call('b')])
    expect(normalized.at(-1)?.message.content).toEqual([{ type: 'text', text: 'Done' }])
  })

  test('preserves all results for adjacent blocks from an older stream without IDs', () => {
    const messages = [
      createUserMessage({ content: 'Inspect filesystems' }),
      assistant([call('a')], undefined),
      assistant([call('b')], undefined),
      result('a'), result('b'),
      assistant([{ type: 'text', text: 'Done' }], undefined),
      createUserMessage({ content: 'Update the session notes' }),
    ]
    const normalized = normalizeMessagesForAPI(messages)
    const paired = ensureToolResultPairing(normalized)
    expect(paired).toEqual(normalized)
    expect(paired[1]?.message.content).toEqual([call('a'), call('b')])
    expect(paired[2]?.message.content).toEqual([
      ...(result('a').message.content as unknown[]),
      ...(result('b').message.content as unknown[]),
    ])
    expect(paired.at(-1)?.message.content).toBe('Update the session notes')
  })
})
