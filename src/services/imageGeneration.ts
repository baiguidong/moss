// Port of Codex 9ef9cb1d9f: ext/image-generation/{tool,backend}.rs and
// codex-api/src/endpoint/images.rs. Host authentication/transport are Moss-owned.
import { getSessionApiOverrides } from '../utils/sessionApiOverrides.js'
import { getSessionRuntimeContext, type SessionRuntime } from '../utils/sessionIdContext.js'

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2'
export const MAX_IMAGE_BYTES = 32 * 1024 * 1024
export type ImageSettings = { model: string }
export type ImageConnection = { model: string; url: string; apiKey: string }
export type ImageReference = { image_url: string }
export type ImageRequest = { prompt: string; transparent_background?: boolean; images: ImageReference[] }
export type ImageResponse = {
  bytes: Buffer
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  transparentBackground?: boolean
  generationId?: string
  requestId?: string
}

/** Image generation shares the main session's connection. */
export function resolveImageConnection(runtime = getSessionRuntimeContext()): ImageConnection {
  const session = getSessionApiOverrides()
  const main = runtime?.modelConnection
  return {
    model: runtime?.image?.model?.trim() || DEFAULT_IMAGE_MODEL,
    url: (session?.mossBaseUrl ?? main?.url ?? process.env.MOSS_MODEL_BASE_URL ?? '').trim(),
    apiKey: (session?.mossAuthToken ?? main?.apiKey ?? process.env.MOSS_MODEL_AUTH_TOKEN ?? '').trim(),
  }
}

export function supportsImageOperation(runtime?: SessionRuntime): boolean {
  const connection = resolveImageConnection(runtime)
  return Boolean(connection.url && connection.apiKey)
}

/** Main Messages bases may have /v1 stripped; preserve gateway prefixes. */
export function imageEndpoint(base: string, edit: boolean): string {
  const url = new URL(base)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('图片接口需要 HTTP 或 HTTPS 地址')
  if (url.username || url.password) throw new Error('请使用主会话 Key，不要在模型地址中嵌入凭据')
  let path = url.pathname.replace(/\/+$/, '')
  path = path.replace(/\/(?:images\/(?:generations|edits)|messages|chat\/completions|responses)$/, '')
  if (!/\/v\d+(?:beta)?$/.test(path) && !path.endsWith('/backend-api/codex')) path += '/v1'
  url.pathname = `${path}/images/${edit ? 'edits' : 'generations'}`
  url.hash = ''
  return url.toString()
}

export function imageMediaType(bytes: Buffer): ImageResponse['mediaType'] {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  throw new Error('图片服务返回了无效图片，仅支持 PNG、JPEG、WebP')
}

async function boundedBody(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new Error('图片服务响应超过大小限制')
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error('图片服务返回空响应')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return Buffer.concat(chunks, length)
      length += next.value.length
      if (length > limit) throw new Error('图片服务响应超过大小限制')
      chunks.push(next.value)
    }
  } finally { await reader.cancel().catch(() => {}) }
}

/** Codex uses JSON for both operations. Explicit format rejection alone may
 * fall back to the public Images multipart contract; never retry generation,
 * timeouts, rate limits or server errors that may already have incurred a charge. */
export async function requestImage(settings: ImageConnection, input: ImageRequest, signal: AbortSignal): Promise<ImageResponse> {
  if (!settings.url || !settings.apiKey) throw new Error('请先配置主会话的模型地址和 Key；图片工具复用主会话连接')
  const edit = input.images.length > 0
  const endpoint = imageEndpoint(settings.url, edit)
  const controller = new AbortController()
  const cancel = () => controller.abort(signal.reason)
  signal.throwIfAborted()
  signal.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('图片生成超时（300 秒），未自动重试，请检查服务状态')), 300_000)
  timeout.unref?.()
  const headers = { Authorization: `Bearer ${settings.apiKey}` }
  const parameters = { prompt: input.prompt, background: input.transparent_background ? 'transparent' : 'opaque', model: settings.model || DEFAULT_IMAGE_MODEL, quality: 'auto', size: 'auto' }
  try {
    let response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...parameters, ...(edit ? { images: input.images } : {}) }), signal: controller.signal, redirect: 'error' })
    let errorText = response.ok ? '' : (await boundedBody(response, 64 * 1024)).toString('utf8')
    if (edit && (response.status === 415 || (response.status === 400 && /(?:unknown|unrecognized|unsupported) (?:parameter|field).*images|(?:missing|required).*['"]image['"]|multipart\/form-data/i.test(errorText)))
      && input.images.every(image => image.image_url.startsWith('data:'))) {
      const form = new FormData()
      for (const [key, value] of Object.entries(parameters)) form.append(key, value)
      for (const [index, image] of input.images.entries()) {
        const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(image.image_url)
        if (!match) throw new Error('参考图片格式无效')
        form.append('image[]', new Blob([new Uint8Array(Buffer.from(match[2]!, 'base64'))], { type: match[1] }), `reference-${index}.${match[1]!.split('/')[1]}`)
      }
      response = await fetch(endpoint, { method: 'POST', headers, body: form, signal: controller.signal, redirect: 'error' })
      errorText = response.ok ? '' : (await boundedBody(response, 64 * 1024)).toString('utf8')
    }
    if (!response.ok) {
      let message = errorText
      try { const error = JSON.parse(errorText); message = error.error?.message || error.message || errorText } catch {}
      const detail = String(message).replaceAll(settings.apiKey, '[redacted]').slice(0, 500)
      throw new Error(`图片请求失败 HTTP ${response.status}：${detail}${response.status === 404 ? '；主会话服务未提供 Images 接口' : ''}`)
    }
    const payload = JSON.parse((await boundedBody(response, Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024 * 1024)).toString('utf8'))
    if (payload.error) throw new Error(`图片生成失败：${String(payload.error.message || 'provider error').replaceAll(settings.apiKey, '[redacted]').slice(0, 500)}`)
    const item = payload.data?.[0]
    let bytes: Buffer
    if (typeof item?.b64_json === 'string' && item.b64_json) bytes = Buffer.from(item.b64_json, 'base64')
    else if (typeof item?.url === 'string') {
      const url = new URL(item.url)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('图片下载地址无效')
      const download = await fetch(url, { signal: controller.signal }) // Never forward model credentials.
      if (!download.ok) throw new Error(`图片下载失败 HTTP ${download.status}`)
      bytes = await boundedBody(download, MAX_IMAGE_BYTES)
    } else throw new Error('图片服务没有返回图片')
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('生成图片超过 32 MB')
    controller.signal.throwIfAborted()
    return { bytes, mediaType: imageMediaType(bytes),
      transparentBackground: payload.background === 'transparent' ? true : payload.background === 'opaque' ? false : undefined,
      generationId: typeof item.generation_id === 'string' ? item.generation_id : undefined,
      requestId: response.headers.get('x-request-id') || undefined }
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel) }
}
