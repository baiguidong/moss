import { randomUUID } from 'node:crypto'

/** Call once per response, before splitting streamed content into messages. */
export function ensureResponseId<T extends { id?: string | null }>(
  response: T,
): T & { id: string } {
  return {
    ...response,
    id: typeof response.id === 'string' && response.id.trim()
      ? response.id
      : `msg_${randomUUID()}`,
  }
}
