import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'

export type ImageSettings = {
  provider: string
  url: string
  apiKey: string
  model: string
}

export type ImageRequest = {
  prompt: string
  aspect_ratio?: string
  subject_reference?: Array<{ type: 'character'; image_file: string }>
  sourcePath?: string
}

export function supportsImageOperation(settings: ImageSettings | undefined, edit = false): boolean {
  if (!settings?.model?.trim() || !settings.apiKey?.trim()) return false
  const provider = settings.provider?.trim().toLowerCase()
  return provider === 'openai' || (provider === 'minimax' && !edit && Boolean(settings.url?.trim()))
}

function openAIEndpoint(url: string, edit: boolean): string {
  const segment = edit ? 'edits' : 'generations'
  const base = (url.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
  if (/\/images\/(edits|generations)$/.test(base)) return base.replace(/(edits|generations)$/, segment)
  return `${base.endsWith('/images') ? base : `${base}/images`}/${segment}`
}

function openAIImageSize(ratio = '1:1'): string {
  if (['16:9', '4:3', '3:2', '21:9'].includes(ratio)) return '1536x1024'
  if (['9:16', '3:4', '2:3'].includes(ratio)) return '1024x1536'
  return '1024x1024'
}

export function imageMediaType(bytes: Buffer): string {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  throw new Error('Image provider returned unsupported or invalid image bytes')
}

/** One image per request. Both the model call and any result download are cancellable. */
export async function requestImage(
  settings: ImageSettings,
  input: ImageRequest,
  signal: AbortSignal,
): Promise<Buffer> {
  const edit = Boolean(input.sourcePath)
  if (!supportsImageOperation(settings, edit)) {
    throw new Error(`Image ${edit ? 'editing' : 'generation'} is not configured or supported by this session's image provider`)
  }
  signal.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  signal.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('Image request timed out after 180 seconds')), 180_000)
  timeout.unref?.()
  try {
    const provider = settings.provider.trim().toLowerCase()
    const headers: Record<string, string> = { Authorization: `Bearer ${settings.apiKey.trim()}` }
    let body: string | FormData
    let endpoint: string
    if (provider === 'openai') {
      if (input.subject_reference?.length) {
        throw new Error('OpenAI does not support subject_reference; use image_edit with source_path')
      }
      endpoint = openAIEndpoint(settings.url, edit)
      const parameters = { model: settings.model.trim(), prompt: input.prompt, n: 1, size: openAIImageSize(input.aspect_ratio) }
      if (input.sourcePath) {
        const source = await readFile(input.sourcePath)
        const mime = imageMediaType(source)
        const form = new FormData()
        form.append('image', new Blob([new Uint8Array(source)], { type: mime }), basename(input.sourcePath))
        for (const [key, value] of Object.entries(parameters)) form.append(key, String(value))
        body = form
      } else {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(parameters)
      }
    } else {
      endpoint = settings.url.trim()
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify({
        model: settings.model.trim(), prompt: input.prompt,
        aspect_ratio: input.aspect_ratio || '1:1',
        subject_reference: input.subject_reference, response_format: 'base64',
      })
    }

    const response = await fetch(endpoint, { method: 'POST', headers, body, signal: controller.signal })
    if (!response.ok) throw new Error(`Image request failed: HTTP ${response.status} ${(await response.text()).slice(0, 500)}`)
    const payload = await response.json() as {
      error?: { message?: string }
      base_resp?: { status_code?: number; status_msg?: string }
      data?: { image_base64?: string[] } | Array<{ b64_json?: string; url?: string }>
    }
    if (payload.error || payload.base_resp?.status_code) {
      throw new Error(`Image request failed: ${payload.error?.message || payload.base_resp?.status_msg || 'provider error'}`)
    }
    let bytes: Buffer
    if (provider === 'minimax') {
      const value = !Array.isArray(payload.data) ? payload.data?.image_base64?.[0] : undefined
      if (!value) throw new Error('Image request returned no images')
      bytes = Buffer.from(value, 'base64')
    } else {
      const item = Array.isArray(payload.data) ? payload.data[0] : undefined
      if (item?.b64_json) {
        bytes = Buffer.from(item.b64_json, 'base64')
      } else if (item?.url) {
        const download = await fetch(item.url, { signal: controller.signal })
        if (!download.ok) throw new Error(`Image download failed: HTTP ${download.status}`)
        bytes = Buffer.from(await download.arrayBuffer())
      } else {
        throw new Error('Image request returned no images')
      }
    }
    controller.signal.throwIfAborted()
    imageMediaType(bytes)
    return bytes
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', cancel)
  }
}
