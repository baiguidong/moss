import { expect, test } from 'bun:test'
import { collectAppAgentResponse } from './structuredOutput'

const schema = { type: 'object', properties: { result: { type: 'string' } }, required: ['result'], additionalProperties: false }
const signal = () => new AbortController().signal

test('repairs a prose response in output-only mode without repeating task execution', async () => {
  const passes: boolean[] = []
  const result = await collectAppAgentResponse({ schema, signal: signal(), execute: async outputOnly => {
    passes.push(outputOnly)
    return outputOnly ? { text: '', structuredOutput: { result: '已完成的原始结果' } } : { text: '已完成的原始结果' }
  } })
  expect(result).toEqual({ result: '已完成的原始结果' })
  expect(passes).toEqual([false, true])
})

test('limits format repair to two additional passes and rejects invalid JSON shapes', async () => {
  const passes: boolean[] = []
  await expect(collectAppAgentResponse({ schema, signal: signal(), execute: async outputOnly => {
    passes.push(outputOnly); return { text: '{"wrong":"field"}' }
  } })).rejects.toThrow('does not match the schema')
  expect(passes).toEqual([false, true, true])
})

test('does not retry transport errors or cancellation', async () => {
  let calls = 0
  await expect(collectAppAgentResponse({ schema, signal: signal(), execute: async () => {
    calls++; throw new Error('provider unavailable')
  } })).rejects.toThrow('provider unavailable')
  const controller = new AbortController()
  await expect(collectAppAgentResponse({ schema, signal: controller.signal, execute: async () => {
    calls++; controller.abort(new Error('cancelled')); return { text: 'unfinished' }
  } })).rejects.toThrow('cancelled')
  expect(calls).toBe(2)
})

test('accepts schema-valid JSON fallback and preserves ordinary text responses', async () => {
  expect(await collectAppAgentResponse({ schema, signal: signal(), execute: async () => ({ text: '{"result":"ok"}' }) })).toEqual({ result: 'ok' })
  expect(await collectAppAgentResponse({ schema: undefined, signal: signal(), execute: async () => ({ text: '普通结果' }) })).toBe('普通结果')
})
