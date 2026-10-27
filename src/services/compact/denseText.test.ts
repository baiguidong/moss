import { expect, test } from 'bun:test'
import {
  classifyDenseText,
  estimateDenseTextTokens,
  estimateDenseTextTokensInMessages,
} from './denseText.js'

test('detects base64 data URIs and charges their payload conservatively', () => {
  const value = `data:image/png;base64,${'A'.repeat(300)}`
  expect(classifyDenseText(value)).toBe('base64')
  expect(estimateDenseTextTokens(value)).toBe(100)
})

test('detects SVG path data as dense text', () => {
  const value = `<svg><path d="${'M10 10 '.repeat(40)}"/></svg>`
  expect(classifyDenseText(value)).toBe('svg')
  expect(estimateDenseTextTokens(value)).toBeGreaterThan(value.length / 4)
})

test('walks nested tool results without serializing binary objects', () => {
  const value = 'x'.repeat(160)
  expect(
    estimateDenseTextTokensInMessages([
      { type: 'user', message: { content: [{ type: 'tool_result', content: value }] } },
    ]),
  ).toBe(54)
})

