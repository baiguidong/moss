import { constants } from 'node:fs'
import { open, link, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { MAX_PERSISTED_TOOL_RESULT_BYTES } from '../constants/toolLimits.js'

/** Keep a UTF-8 prefix without cutting a multi-byte character. */
export function utf8Prefix(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text
  const buffer = Buffer.from(text.slice(0, maxBytes))
  let end = Math.min(maxBytes, buffer.length)
  while (end > 0 && end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--
  return buffer.subarray(0, end).toString('utf8')
}

const publications = new Map<string, Promise<unknown>>()
export function persistBoundedOutput(
  filepath: string,
  source: { text: string } | { file: string },
  options: { maxBytes?: number; signal?: AbortSignal } = {},
) {
  const previous = publications.get(filepath) ?? Promise.resolve()
  const result = previous.catch(() => {}).then(() => writeSnapshot(filepath, source, options))
  publications.set(filepath, result)
  void result.finally(() => { if (publications.get(filepath) === result) publications.delete(filepath) }).catch(() => {})
  return result
}

/** Publish an independent, bounded snapshot; never truncate or link the source log. */
async function writeSnapshot(
  filepath: string,
  source: { text: string } | { file: string },
  options: { maxBytes?: number; signal?: AbortSignal } = {},
) {
  const limit = options.maxBytes ?? MAX_PERSISTED_TOOL_RESULT_BYTES
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_PERSISTED_TOOL_RESULT_BYTES) throw new Error('Invalid tool output storage limit')
  const temp = `${filepath}.${randomUUID()}.tmp`
  let input: Awaited<ReturnType<typeof open>> | undefined
  let output: Awaited<ReturnType<typeof open>> | undefined
  let temporaryCreated = false
  let storedBytes = 0
  const hash = createHash('sha256')
  try {
    options.signal?.throwIfAborted()
    let originalBytes: number
    let sourceChanged = false
    let initial: Awaited<ReturnType<NonNullable<typeof input>['stat']>> | undefined
    if ('file' in source) {
      input = await open(source.file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      initial = await input.stat()
      if (!initial.isFile()) throw new Error('Tool output source is not a regular file')
      originalBytes = initial.size
    } else originalBytes = Buffer.byteLength(source.text)
    output = await open(temp, 'wx', 0o600)
    temporaryCreated = true
    const write = async (buffer: Buffer) => {
      options.signal?.throwIfAborted()
      await output!.writeFile(buffer)
      hash.update(buffer); storedBytes += buffer.length
    }
    if (input) {
      const buffer = Buffer.alloc(64 * 1024)
      while (storedBytes < Math.min(originalBytes, limit)) {
        options.signal?.throwIfAborted()
        const { bytesRead } = await input.read(buffer, 0, Math.min(buffer.length, limit - storedBytes, originalBytes - storedBytes), storedBytes)
        if (!bytesRead) break
        await write(buffer.subarray(0, bytesRead))
      }
      const after = await input.stat()
      sourceChanged = after.size !== initial!.size || after.mtimeMs !== initial!.mtimeMs
    } else if ('text' in source) {
      for (let offset = 0; offset < source.text.length && storedBytes < limit;) {
        let end = Math.min(offset + 16_384, source.text.length)
        const last = source.text.charCodeAt(end - 1)
        if (end < source.text.length && last >= 0xd800 && last <= 0xdbff) end--
        const slice = source.text.slice(offset, end)
        const prefix = utf8Prefix(slice, limit - storedBytes)
        await write(Buffer.from(prefix))
        if (prefix.length < slice.length) break
        offset = end
      }
    }
    await output.close(); output = undefined
    options.signal?.throwIfAborted()
    const digest = hash.digest('hex')
    try {
      // Atomic publication: readers never see a half-written result. The
      // temporary hard link is removed below, leaving an independent file.
      await link(temp, filepath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // A replay may reuse only the same complete snapshot, never a symlink,
      // unrelated file, or partial write left by an earlier process.
      const existing = await open(filepath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        const stat = await existing.stat()
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== storedBytes) throw new Error('Existing tool output is not a matching snapshot')
        const existingHash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024)
        let offset = 0
        while (offset < storedBytes) {
          options.signal?.throwIfAborted()
          const { bytesRead } = await existing.read(buffer, 0, Math.min(buffer.length, storedBytes - offset), offset)
          if (!bytesRead) break
          existingHash.update(buffer.subarray(0, bytesRead)); offset += bytesRead
        }
        if (offset !== storedBytes || existingHash.digest('hex') !== digest) throw new Error('Existing tool output has different content')
      } finally { await existing.close() }
    }
    return { originalBytes, storedBytes, truncated: storedBytes < originalBytes || sourceChanged, sourceChanged }
  } finally {
    await output?.close().catch(() => {})
    await input?.close().catch(() => {})
    if (temporaryCreated) await unlink(temp).catch(() => {})
  }
}
