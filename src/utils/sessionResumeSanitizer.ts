import type { Message } from '../types/message.js'
import { createAssistantMessage, NO_RESPONSE_REQUESTED } from './messages.js'

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMossImageToolUseResult(value: unknown): boolean {
  if (!isObjectRecord(value)) {
    return false
  }

  if (typeof value.ok !== 'boolean') {
    return false
  }

  return (
    value.fileKind === 'image' ||
    typeof value.previewUrl === 'string' ||
    typeof value.previewMarkdown === 'string' ||
    (typeof value.mediaType === 'string' && value.mediaType.startsWith('image/'))
  )
}

export type ResumeMessageSanitization = {
  messages: Message[]
  removedApiError: boolean
}

export function sanitizeMessagesForResume(
  messages: Message[],
): ResumeMessageSanitization {
  let removedApiError = false
  const sanitized = messages
    .filter(message => {
      const shouldRemove =
        message.type === 'assistant' && message.isApiErrorMessage
      if (shouldRemove) {
        removedApiError = true
      }
      return !shouldRemove
    })
    .map(message => {
      if (
        message.type === 'user' &&
        isMossImageToolUseResult(message.toolUseResult)
      ) {
        const { toolUseResult: _toolUseResult, ...rest } = message
        return rest as Message
      }
      return message
    })

  const lastRelevantIdx = sanitized.findLastIndex(
    m => m.type !== 'system' && m.type !== 'progress',
  )
  if (lastRelevantIdx !== -1 && sanitized[lastRelevantIdx]?.type === 'user') {
    sanitized.splice(
      lastRelevantIdx + 1,
      0,
      createAssistantMessage({ content: NO_RESPONSE_REQUESTED }) as Message,
    )
  }

  return { messages: sanitized, removedApiError }
}
