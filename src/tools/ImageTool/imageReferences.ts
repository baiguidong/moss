// Adapted from Codex ext/image-generation/src/tool.rs::recent_images.
import { MAX_IMAGE_BYTES, type ImageReference } from '../../services/imageGeneration.js'

function record(value: unknown): Record<string, any> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined
}

function imagesInContent(content: unknown): ImageReference[] {
  if (!Array.isArray(content)) return []
  return content.flatMap(value => {
    const block = record(value)
    if (!block) return []
    if (block.type === 'tool_result') return block.is_error ? [] : imagesInContent(block.content)
    if (block.type !== 'image') return []
    const source = record(block.source)
    if (source?.type === 'base64' && typeof source.data === 'string' && /^image\/(png|jpeg|webp|gif)$/.test(source.media_type)) {
      if (source.data.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3)) throw new Error('会话参考图超过 32 MB')
      return [{ image_url: `data:${source.media_type};base64,${source.data}` }]
    }
    if (source?.type === 'url' && typeof source.url === 'string' && /^https?:\/\//.test(source.url)) return [{ image_url: source.url }]
    return []
  })
}

/** Scan actual image blocks, never paths or URLs mentioned in ordinary text.
 * Like Codex, recent-N is best effort; explicit paths disambiguate edits. */
export function recentImages(history: readonly unknown[], count: number): ImageReference[] {
  if (!Number.isInteger(count) || count < 1 || count > 5) throw new Error('num_last_images_to_include 必须为 1 到 5')
  const images: ImageReference[] = []
  for (let index = history.length - 1; index >= 0; index--) {
    const item = record(history[index])
    if (!item || !['user', 'assistant'].includes(item.type)) continue
    for (const image of imagesInContent(record(item.message)?.content).reverse()) {
      images.push(image)
      if (images.length === count) return images.reverse()
    }
  }
  throw new Error(`请求最近 ${count} 张会话图片，但当前上下文只有 ${images.length} 张；可使用 referenced_image_paths 明确指定图片`)
}
