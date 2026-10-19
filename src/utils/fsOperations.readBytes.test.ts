import { afterEach, expect, spyOn, test } from 'bun:test'
import * as fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getFsImplementation } from './fsOperations.js'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await fsp.rm(root, { recursive: true, force: true })
})
async function fixture(content: string) {
  const root = await fsp.mkdtemp(join(tmpdir(), 'moss-byte-read-'))
  roots.push(root)
  const file = join(root, 'file')
  await fsp.writeFile(file, content)
  return { root, file }
}

test('bounded byte reads accept the exact limit and reject overflow instead of returning a prefix', async () => {
  const { file } = await fixture('12345')
  expect(await getFsImplementation().readFileBytes(file, 5)).toEqual(Buffer.from('12345'))
  await expect(getFsImplementation().readFileBytes(file, 4)).rejects.toThrow('maximum read size')
  await expect(getFsImplementation().readFileBytes(file, -1)).rejects.toThrow('Invalid file byte limit')
  const empty = await fixture('')
  expect(await getFsImplementation().readFileBytes(empty.file, 0)).toEqual(Buffer.alloc(0))
})

test('reads are bounded even when the file grows after fstat', async () => {
  const { file } = await fixture('a')
  const originalOpen = fsp.open
  const mockedOpen = spyOn(fsp, 'open').mockImplementation(async (...args: Parameters<typeof fsp.open>) => {
    const handle = await originalOpen(...args)
    const stat = handle.stat.bind(handle)
    handle.stat = (async () => {
      const value = await stat()
      await fsp.appendFile(file, 'bcdefghijkl')
      return value
    }) as typeof handle.stat
    return handle
  })
  try {
    await expect(getFsImplementation().readFileBytes(file, 4)).rejects.toThrow('maximum read size')
  } finally {
    mockedOpen.mockRestore()
  }
})

test('rejects directories, missing files and cancelled reads', async () => {
  const { root, file } = await fixture('data')
  await expect(getFsImplementation().readFileBytes(root, 10)).rejects.toThrow()
  await expect(getFsImplementation().readFileBytes(join(root, 'missing'), 10)).rejects.toThrow()
  const stop = new Error('stopped')
  await expect(getFsImplementation().readFileBytes(file, 10, AbortSignal.abort(stop))).rejects.toBe(stop)
})

test.skipIf(process.platform === 'win32')('a FIFO does not block the bounded read before its type is checked', async () => {
  const { root } = await fixture('')
  const fifo = join(root, 'pipe')
  const child = Bun.spawn(['mkfifo', fifo], { stdout: 'ignore', stderr: 'pipe' })
  expect(await child.exited).toBe(0)
  await expect(getFsImplementation().readFileBytes(fifo, 10)).rejects.toThrow('non-regular file')
}, 2000)
