import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * OpenAI-backed Messages gateways can stringify images inside tool_result,
 * charging for base64 text while withholding the image from vision. Keep the
 * tool result paired and put its images in the same user turn as native image
 * blocks. Apply at the wire boundary, after message merging and cache edits.
 * Claude models retain their native nested representation.
 */
export function normalizeToolImagesForModel(
  messages: BetaMessageParam[],
  model: string,
): BetaMessageParam[] {
  if (!/(^|[/:])(?:gpt-|chatgpt-|o[134](?:-|$))/i.test(model)) return messages
  return messages.map(message => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message
    const images: Extract<(typeof message.content)[number], { type: 'image' }>[] = []
    const content = message.content.map(block => {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) return block
      let count = 0
      const nested = block.content.map(item => {
        if (item.type !== 'image') return item
        images.push(item)
        count++
        return { type: 'text' as const, text: `[Image ${images.length} from tool ${block.tool_use_id} follows the tool results in this message.]` }
      })
      return count ? { ...block, content: nested } : block
    })
    return images.length ? { ...message, content: [...content, ...images] } : message
  })
}
