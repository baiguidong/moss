import { describe, expect, test } from 'bun:test'
import {
  parseSelectedMemoryFilenames,
  shouldSearchMemoriesForQuery,
} from './findRelevantMemories.js'

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

describe('memory relevance model response', () => {
  const validFilenames = new Set([
    'feedback_test_code_identifier.md',
    'user_profile.md',
  ])

  test('parses structured output', () => {
    expect(
      parseSelectedMemoryFilenames(
        '{"selected_memories":["feedback_test_code_identifier.md"]}',
        validFilenames,
      ),
    ).toEqual(['feedback_test_code_identifier.md'])
  })

  test('accepts plain filenames from gateways that ignore output_format', () => {
    expect(
      parseSelectedMemoryFilenames(
        'feedback_test_code_identifier.md',
        validFilenames,
      ),
    ).toEqual(['feedback_test_code_identifier.md'])
  })

  test('rejects filenames outside the supplied manifest', () => {
    expect(
      parseSelectedMemoryFilenames('untrusted_memory.md', validFilenames),
    ).toEqual([])
  })
})
