import { expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { getFsImplementation, setFsImplementation } from '../../utils/fsOperations.js'
import { readImageWithTokenBudget } from './FileReadTool.js'
import { MAX_IMAGE_READ_BYTES } from './limits.js'

test('image reads always pass a hard input cap, even when callers request a larger one', async () => {
  const original = getFsImplementation()
  const limits: Array<number | undefined> = []
  const sentinel = new Error('stop-before-read')
  setFsImplementation({ ...original, async readFileBytes(_path, maxBytes) {
    limits.push(maxBytes)
    throw sentinel
  } })
  try {
    await expect(readImageWithTokenBudget('/unused', 2000)).rejects.toBe(sentinel)
    await expect(readImageWithTokenBudget('/unused', 2000, 100)).rejects.toBe(sentinel)
    await expect(readImageWithTokenBudget('/unused', 2000, Number.MAX_SAFE_INTEGER)).rejects.toBe(sentinel)
    expect(limits).toEqual([MAX_IMAGE_READ_BYTES, 100, MAX_IMAGE_READ_BYTES])
  } finally { setFsImplementation(original) }
})

test('normal PNG reads still work; oversized input, empty images and cancellation fail explicitly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-image-read-'))
  try {
    const file = join(root, 'image.png')
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'red' } }).png().toBuffer()
    await writeFile(file, png)
    const result = await readImageWithTokenBudget(file, 2000)
    expect(result.type).toBe('image')
    expect(result.file.type).toBe('image/png')
    expect(result.file.originalSize).toBe(png.length)
    await expect(readImageWithTokenBudget(file, 2000, png.length - 1)).rejects.toThrow('maximum read size')
    const stop = new Error('cancel-image-read')
    await expect(readImageWithTokenBudget(file, 2000, undefined, AbortSignal.abort(stop))).rejects.toBe(stop)
    await writeFile(file, '')
    await expect(readImageWithTokenBudget(file, 2000)).rejects.toThrow('empty')
    // Metadata-only fixture: no large bitmap is created or decoded.
    await writeFile(file, '<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"></svg>')
    await expect(readImageWithTokenBudget(file, 2000)).rejects.toThrow('pixel input limit')
  } finally { await rm(root, { recursive: true, force: true }) }
})
