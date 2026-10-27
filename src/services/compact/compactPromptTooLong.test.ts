import { expect, test } from 'bun:test'
import {
  createAssistantAPIErrorMessage,
  createAssistantMessage,
  createUserMessage,
} from '../../utils/messages.js'
import { truncateHeadForPTLRetry } from './compact.js'

function rounds(includeDensePayload: boolean) {
  return Array.from({ length: 5 }, (_, index) => {
    const assistant = createAssistantMessage({ content: `round ${index}` })
    assistant.message.id = `assistant-${index}`
    const payload = includeDensePayload && index === 0
      ? `data:image/png;base64,${'A'.repeat(150_000)}`
      : `result ${index}`
    return [
      assistant,
      createUserMessage({ content: payload }),
    ]
  }).flat()
}

test('prompt-too-long retry keeps one API round and truncates dense history more aggressively', () => {
  const error = createAssistantAPIErrorMessage({
    content: 'Prompt is too long',
    error: 'invalid_request',
  })
  const regular = truncateHeadForPTLRetry(rounds(false), error)
  const dense = truncateHeadForPTLRetry(rounds(true), error)

  expect(regular).not.toBeNull()
  expect(dense).not.toBeNull()
  expect(dense!.length).toBeLessThan(regular!.length)
  expect(dense!.length).toBeGreaterThan(0)
})

test('prompt-too-long retry stops when there is no complete earlier exchange', () => {
  const error = createAssistantAPIErrorMessage({
    content: 'Prompt is too long',
    error: 'invalid_request',
  })
  const onlyRound = rounds(false).slice(0, 2)
  expect(truncateHeadForPTLRetry(onlyRound, error)).toBeNull()
})

