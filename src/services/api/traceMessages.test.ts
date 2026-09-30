import { expect, test } from 'bun:test'
import { toTraceMessages } from './traceMessages.js'

test('adapts persisted and live SDK messages without losing tool and usage identity', () => {
  const messages = toTraceMessages([
    { type: 'user', uuid: 'u1', prompt: '检查文件', timestamp: 1000 },
    { type: 'stream_event', event: { type: 'content_block_delta' } },
    { type: 'assistant', uuid: 'a1', timestamp: 2000, message: { id: 'response-1', model: 'fixture', usage: { input_tokens: 5 }, content: [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: 'a.ts' } }] } },
    { type: 'user', uuid: 'r1', timestamp: 3000, parentUuid: 'a1', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }] } },
  ])
  expect(messages).toHaveLength(3)
  expect(messages[0]).toMatchObject({ id: 'u1', type: 'user', content: '检查文件', timestamp: '1970-01-01T00:00:01.000Z' })
  expect(messages[1]).toMatchObject({ type: 'tool_use', model: 'fixture', usageKey: 'response-1', usage: { input_tokens: 5 } })
  expect(messages[2]).toMatchObject({ type: 'tool_result', parentUuid: 'a1' })
  expect((messages[2]!.content as any[])[0].tool_use_id).toBe('tool-1')
})

test('uses stable fallbacks and deduplicates a persisted message repeated in history', () => {
  const entries = [{ type: 'user', uuid: 'same', content: 'hello' }, { type: 'user', uuid: 'same', content: 'hello' }]
  expect(toTraceMessages(entries)).toEqual(toTraceMessages(entries))
  expect(toTraceMessages(entries)).toHaveLength(1)
  expect(toTraceMessages(entries)[0]!.timestamp).toBe('1970-01-01T00:00:00.000Z')
})

const persistedUser = (id: string, timestamp: number, content = '你好啊') => ({
  type: 'user', uuid: id, timestamp: new Date(timestamp).toISOString(), message: { content },
})
const visibleUser = (id: string, timestamp: number, prompt = '你好啊') => ({
  type: 'user', uuid: id, timestamp, prompt,
})

test('merges a desktop prompt and its persisted copy with different UUIDs', () => {
  const transcript = [persistedUser('runtime-user', 1200), {
    type: 'assistant', uuid: 'answer', parentUuid: 'runtime-user', timestamp: 2000,
    message: { content: [{ type: 'text', text: '你好' }] },
  }]
  const history = [visibleUser('desktop-user', 1000), {
    type: 'assistant', uuid: 'answer', message: { content: [{ type: 'text', text: '你好' }] },
  }]
  const messages = toTraceMessages(transcript, history)
  expect(messages.map(message => message.id)).toEqual(['runtime-user', 'answer'])
  expect(messages[1]!.parentUuid).toBe('runtime-user')
  expect(history[0]!.uuid).toBe('desktop-user')
})

test('preserves repeated user sends and a new prompt not yet in the transcript', () => {
  const transcript = [persistedUser('runtime-1', 1200), persistedUser('runtime-2', 3200)]
  const history = [visibleUser('desktop-1', 1000), visibleUser('desktop-2', 3000), visibleUser('pending', 5000)]
  expect(toTraceMessages(transcript, history).map(message => message.id)).toEqual(['runtime-1', 'runtime-2', 'pending'])
  expect(toTraceMessages(transcript)).toHaveLength(2)
})

test('does not merge an earlier failed send into a later identical retry', () => {
  expect(toTraceMessages([persistedUser('runtime-retry', 3200)], [
    visibleUser('failed', 1000), visibleUser('retry', 3000),
  ]).map(message => message.id)).toEqual(['failed', 'runtime-retry'])
})

test('uses shared response ancestry when runtime context changes the prompt text', () => {
  const transcript = [persistedUser('runtime-user', 1200, '[Workspace version]\nfixture\n\n你好啊'), {
    type: 'assistant', uuid: 'answer', parentUuid: 'runtime-user', timestamp: 2000,
    message: { content: [{ type: 'text', text: '你好' }] },
  }]
  expect(toTraceMessages(transcript, [visibleUser('desktop-user', 1000), {
    type: 'assistant', uuid: 'answer', message: { content: [{ type: 'text', text: '你好' }] },
  }]).map(message => message.id)).toEqual(['runtime-user', 'answer'])
})

test('reserves explicit message IDs and does not deduplicate unrelated equal text', () => {
  const transcript = [persistedUser('known', 2000)]
  const history = [visibleUser('unmatched', 1000), persistedUser('known', 2000), persistedUser('other', 3000)]
  expect(toTraceMessages(transcript, history).map(message => message.id)).toEqual(['unmatched', 'known', 'other'])
})

test('keeps live responses after their reconciled user and persisted response timestamps', () => {
  const transcript = [persistedUser('runtime-1', 1200), persistedUser('runtime-2', 3200), {
    type: 'assistant', uuid: 'persisted-answer', parentUuid: 'runtime-2', timestamp: 4000,
    message: { content: [{ type: 'text', text: '正在处理' }] },
  }]
  const history = [visibleUser('desktop-1', 1000), visibleUser('desktop-2', 3000), {
    type: 'assistant', uuid: 'live-answer', message: { content: [{ type: 'text', text: '你好' }] },
  }, {
    type: 'assistant', uuid: 'persisted-answer', message: { content: [{ type: 'text', text: '正在处理' }] },
  }, {
    type: 'assistant', uuid: 'live-followup', message: { content: [{ type: 'text', text: '已完成' }] },
  }]
  expect(toTraceMessages(transcript, history).map(({ id, timestamp }) => [id, timestamp])).toEqual([
    ['runtime-1', new Date(1200).toISOString()],
    ['runtime-2', new Date(3200).toISOString()],
    ['live-answer', new Date(3200).toISOString()],
    ['persisted-answer', new Date(4000).toISOString()],
    ['live-followup', new Date(4000).toISOString()],
  ])
})
