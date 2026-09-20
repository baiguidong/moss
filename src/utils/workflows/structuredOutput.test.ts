import { describe, expect, test } from 'bun:test'
import { parseStructuredAgentText } from './structuredOutput.js'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'output'],
  properties: {
    status: { const: 'completed' },
    output: {
      type: 'object',
      additionalProperties: false,
      required: ['text'],
      properties: { text: { type: 'string' } },
    },
  },
}

describe('Workflow Agent structured text fallback', () => {
  test('accepts a standalone object returned directly by the model', () => {
    expect(parseStructuredAgentText(
      '{"status":"completed","output":{"text":"完成"}}',
      SCHEMA,
    )).toEqual({ ok: true, value: { status: 'completed', output: { text: '完成' } } })
  })

  test('accepts one JSON fence but rejects prose and schema mismatches', () => {
    expect(parseStructuredAgentText(
      '```json\n{"status":"completed","output":{"text":"完成"}}\n```',
      SCHEMA,
    ).ok).toBe(true)
    expect(parseStructuredAgentText(
      '结果如下： {"status":"completed","output":{"text":"完成"}}',
      SCHEMA,
    ).ok).toBe(false)
    expect(parseStructuredAgentText(
      '{"status":"completed","output":{}}',
      SCHEMA,
    ).ok).toBe(false)
  })
})
