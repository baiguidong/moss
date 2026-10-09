import { AppServiceError, APP_ERROR_CODES, abortError } from '../errors.mjs'
export const RESULT_LIMITS = Object.freeze({ maxBytes: 32 * 1024 * 1024, chunkBytes: 256 * 1024, pendingBytes: 64 * 1024 * 1024, leaseMs: 60000 })
/** Bounded JSON transfer reader. Offsets are decoded bytes; release always runs. */
export async function readJsonResult(result, { read, release, signal, maxBytes = RESULT_LIMITS.maxBytes }) {
  if (!result?.transfer) return result?.value
  const { id, size } = result.transfer
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > RESULT_LIMITS.maxBytes) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid result limit')
    if (!Number.isSafeInteger(size) || size < 1 || size > maxBytes) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Invalid result size')
    const bytes = new Uint8Array(size)
    let offset = 0
    while (offset < size) {
      if (signal?.aborted) throw abortError(signal)
      const part = await read({ id, offset }, { signal })
      if (typeof part.data !== 'string' || part.data.length > Math.ceil(RESULT_LIMITS.chunkBytes / 3) * 4) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Invalid result chunk')
      const raw = atob(part.data)
      if (!raw.length || part.nextOffset !== offset + raw.length || part.nextOffset > size || part.done !== (part.nextOffset === size)) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Invalid result offset')
      for (let i = 0; i < raw.length; i++) bytes[offset + i] = raw.charCodeAt(i)
      offset = part.nextOffset
    }
    if (signal?.aborted) throw abortError(signal)
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } finally { await release(id).catch(() => {}) }
}

/** UTF-16 ranges are joined before JSON decoding so surrogate pairs survive chunk boundaries. */
export async function readJsonRanges(read, { signal, maxBytes = RESULT_LIMITS.maxBytes } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > RESULT_LIMITS.maxBytes) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid result limit')
  const chunks = []
  let offset = 0
  while (true) {
    if (signal?.aborted) throw abortError(signal)
    const chunk = await read({ offset, limit: 32000 }, { signal })
    if (typeof chunk.text !== 'string' || chunk.text.length > 32000 || offset + chunk.text.length > maxBytes) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Invalid result size')
    chunks.push(chunk.text)
    if (chunk.nextOffset === null) break
    if (!chunk.text.length || !Number.isSafeInteger(chunk.nextOffset) || chunk.nextOffset !== offset + chunk.text.length) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Invalid result offset')
    offset = chunk.nextOffset
  }
  if (signal?.aborted) throw abortError(signal)
  const text = chunks.join('')
  if (new TextEncoder().encode(text).length > maxBytes) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Result exceeds size limit')
  return JSON.parse(text)
}
