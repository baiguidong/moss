import { describe, expect, test } from 'bun:test'
import { shouldSearchMemoriesForQuery } from './findRelevantMemories.js'

describe('memory recall query gate', () => {
  test('sends every non-empty query to the relevance model', () => {
    expect(shouldSearchMemoriesForQuery('remember this preference')).toBe(true)
    expect(shouldSearchMemoriesForQuery('我的测试代码标识是什么？')).toBe(true)
    expect(shouldSearchMemoriesForQuery('标识')).toBe(true)
  })

  test('rejects only empty input', () => {
    expect(shouldSearchMemoriesForQuery('')).toBe(false)
    expect(shouldSearchMemoriesForQuery('   ')).toBe(false)
  })
})
