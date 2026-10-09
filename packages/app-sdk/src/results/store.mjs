import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { AppServiceError, APP_ERROR_CODES } from '../errors.mjs'
import { RESULT_LIMITS } from './index.mjs'
/** One store belongs to one App Backend; references never grant cross-App access. */
export function createResultTransport({ now = Date.now } = {}) {
  const results = new Map()
  const prune = () => { for (const [id, entry] of results) if (entry.expiresAt <= now()) results.delete(id) }
  return {
    pack(value) {
      prune()
      const bytes = Buffer.from(JSON.stringify(value))
      if (bytes.length <= RESULT_LIMITS.chunkBytes) return { value }
      if (bytes.length > RESULT_LIMITS.maxBytes || [...results.values()].reduce((sum, entry) => sum + entry.bytes.length, bytes.length) > RESULT_LIMITS.pendingBytes) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Result capacity exceeded')
      const id = randomUUID(), expiresAt = now() + RESULT_LIMITS.leaseMs
      results.set(id, { bytes, expiresAt })
      return { transfer: { id, size: bytes.length, encoding: 'base64', offsetUnit: 'byte', expiresAt } }
    },
    read({ id, offset }) {
      prune()
      const entry = results.get(id)
      if (!entry) throw new AppServiceError(APP_ERROR_CODES.notFound, 'Result expired or released')
      if (!Number.isSafeInteger(offset) || offset < 0 || offset >= entry.bytes.length) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid result offset')
      entry.expiresAt = now() + RESULT_LIMITS.leaseMs
      const chunk = entry.bytes.subarray(offset, offset + RESULT_LIMITS.chunkBytes), nextOffset = offset + chunk.length
      return { data: chunk.toString('base64'), nextOffset, done: nextOffset === entry.bytes.length }
    },
    release(id) { results.delete(id); return { released: true } },
    close() { results.clear() },
  }
}
export function readUtf16Range(file, offset = 0, limit = 32000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid result range')
  const fd = fs.openSync(file, 'r')
  try {
    const size = fs.fstatSync(fd).size / 2
    if (!Number.isSafeInteger(size) || offset > size) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid result offset')
    const bytes = Buffer.alloc(Math.min(limit, size - offset) * 2)
    let length = 0
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, offset * 2 + length)
      if (!read) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, 'Truncated result')
      length += read
    }
    return { text: bytes.toString('utf16le'), nextOffset: offset + length / 2 < size ? offset + length / 2 : null }
  } finally { fs.closeSync(fd) }
}
