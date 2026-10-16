import { describe, expect, test } from 'bun:test'
import { normalizeToolImagesForModel } from '../toolImageCompatibility.js'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

const image = { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'test-image' } }
const messages: BetaMessageParam[] = [
  { role: 'assistant', content: [{ type: 'tool_use', id: 'one', name: 'Read', input: {} }, { type: 'tool_use', id: 'two', name: 'Read', input: {} }] },
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'one', content: [{ type: 'text', text: 'screenshot one' }, image] },
    { type: 'tool_result', tool_use_id: 'two', content: [image], cache_control: { type: 'ephemeral' } },
  ] },
]
describe('OpenAI gateway tool images', () => {
  test('keeps pairing and actual image payloads without text serialization', () => {
    const result = normalizeToolImagesForModel(messages, 'gpt-5.5')
    expect(result[0]).toBe(messages[0])
    const blocks = result[1]!.content as any[]
    expect(blocks.map(b => b.type)).toEqual(['tool_result', 'tool_result', 'image', 'image'])
    expect(blocks[0].tool_use_id).toBe('one')
    expect(blocks[0].content[0].text).toBe('screenshot one')
    expect(blocks[1].content[0].text).toContain('tool two')
    expect(blocks[1].cache_control).toEqual({ type: 'ephemeral' })
    expect(blocks[2]).toBe(image)
    expect(blocks[3]).toBe(image)
    expect(JSON.stringify(blocks.slice(0, 2))).not.toContain('test-image')
    expect((messages[1]!.content as any[])[0].content[1]).toBe(image)
    expect(normalizeToolImagesForModel(result, 'gpt-5.5')).toEqual(result)
  })
  test('does not alter native Claude or unknown model transport', () => {
    for (const model of ['claude-sonnet-4-5', 'vendor/claude-opus-4-6', 'custom-model']) {
      expect(normalizeToolImagesForModel(messages, model)).toBe(messages)
    }
  })
  test('recognizes namespaced OpenAI models', () => {
    for (const model of ['openai/gpt-5.5', 'openai:o3', 'o4-mini']) {
      expect((normalizeToolImagesForModel(messages, model)[1]!.content as any[]).at(-1).type).toBe('image')
    }
  })
  test('preserves text-only tools, user images and errors', () => {
    const plain: BetaMessageParam[] = [{ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'one', content: 'error', is_error: true }, image,
    ] }]
    expect(normalizeToolImagesForModel(plain, 'gpt-5.5')[0]).toBe(plain[0])
  })
})
