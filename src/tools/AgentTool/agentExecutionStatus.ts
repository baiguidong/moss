import type { Message } from '../../types/message.js'
import { isPromptTooLongMessage } from '../../services/api/errors.js'

export type AgentExecutionFailure = {
  code: string
  message: string
}

function assistantText(message: Message): string {
  if (message.type !== 'assistant' || !Array.isArray(message.message.content)) {
    return ''
  }
  return message.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}

export function getAgentExecutionFailure(
  message: Message,
): AgentExecutionFailure | null {
  if (message.type !== 'assistant' || !message.isApiErrorMessage) {
    return null
  }

  const record = message as Message & {
    apiError?: string
    error?: string
  }
  const text = assistantText(message) || 'Agent API request failed.'
  const code = isPromptTooLongMessage(message)
    ? 'prompt_too_long'
    : record.apiError || record.error || 'api_error'

  return { code, message: text }
}

export class AgentExecutionError extends Error {
  readonly code: string

  constructor(failure: AgentExecutionFailure) {
    super(failure.message)
    this.name = 'AgentExecutionError'
    this.code = failure.code
  }
}
