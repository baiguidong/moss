import { createRequire } from 'node:module'
import type { ManagedResourceKind } from './managedResources.js'
import { expertHubBase, skillHubBase } from './managedHub.js'
import skillHubPresets from './assets/skillhub-preset-icons.json'

const maxBytes = 2 * 1024 * 1024
const requireImage = createRequire(import.meta.url)
const recent = new Map<string, { expires: number; result: Promise<string> }>()

// SkillHub selects from its ordered preset artwork by hashing the skill slug.
// Bundle the 96px thumbnails so these cards also render without a CDN request.
export function skillHubPresetIcon(slug: string): string {
  const seed = slug.trim()
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = seed.charCodeAt(i) + ((hash << 5) - hash)
  return 'data:image/webp;base64,' + skillHubPresets[Math.abs(hash) % skillHubPresets.length]
}

export function emojiIcon(value: unknown): string {
  if (typeof value !== 'string' || !/^\p{Extended_Pictographic}[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F\u200D]{0,12}$/u.test(value)) return ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="46" text-anchor="middle" font-size="43">${value}</text></svg>`
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')
}

export async function imageThumbnail(bytes: Buffer): Promise<string> {
  if (!bytes.length || bytes.length > maxBytes) return ''
  try {
    const sharp: typeof import('sharp') = requireImage('sharp')
    const image = await sharp(bytes, { limitInputPixels: 16_000_000 }).rotate()
      .resize(96, 96, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
    return 'data:image/webp;base64,' + image.toString('base64')
  } catch { return '' }
}

async function downloadIcon(url: URL): Promise<string> {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3500) })
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel()
    return ''
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > maxBytes) return ''
    chunks.push(Buffer.from(chunk))
  }
  return imageThumbnail(Buffer.concat(chunks))
}

export function hubIcon(kind: ManagedResourceKind, value: unknown): Promise<string> {
  if (!value || typeof value !== 'string') return Promise.resolve('')
  const emoji = emojiIcon(value)
  if (emoji) return Promise.resolve(emoji)
  const base = kind === 'expert' ? expertHubBase() : skillHubBase()
  let url: URL
  try { url = new URL(value.replace(/^\/(?!\/)/, ''), base + '/') } catch { return Promise.resolve('') }
  const skillUpload = kind === 'skill' && url.origin === 'https://skillhub-1388575217.cos.accelerate.myqcloud.com'
    && url.pathname.startsWith('/skill-icons/uploads/')
  if (url.username || url.password || (!skillUpload && ![new URL(base).origin, 'https://cloudcache.tencent-cloud.com'].includes(url.origin))) return Promise.resolve('')
  const key = url.href
  const hit = recent.get(key)
  if (hit && hit.expires > Date.now()) return hit.result
  if (recent.size >= 512) recent.delete(recent.keys().next().value!)
  const entry = { expires: Date.now() + 3600_000, result: downloadIcon(url).catch(() => '') }
  recent.set(key, entry)
  void entry.result.then(icon => { if (!icon) entry.expires = Date.now() + 60_000 })
  return entry.result
}
