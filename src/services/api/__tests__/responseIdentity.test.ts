import { describe, expect, test } from 'bun:test'
import { ensureResponseId } from '../responseIdentity.js'

describe('gateway response identity', () => {
  test('assigns distinct IDs to responses with missing or empty IDs', () => {
    const responses = [{}, { id: undefined }, { id: null }, { id: '' }, { id: '  ' }]
      .map(response => ensureResponseId(response))
    expect(responses.every(response => response.id.trim().length > 0)).toBe(true)
    expect(new Set(responses.map(response => response.id)).size).toBe(responses.length)
  })

  test('preserves an existing ID when splitting or normalizing a response again', () => {
    const response = ensureResponseId({ role: 'assistant', content: [] })
    expect(ensureResponseId(response)).toEqual(response)
    expect(ensureResponseId({ id: 'provider-message', role: 'assistant' }).id).toBe('provider-message')
    const blocks = ['one', 'two'].map(text => ({ ...response, content: [{ type: 'text', text }] }))
    expect(blocks[0]?.id).toBe(blocks[1]?.id)
  })
})
