import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { zipSync } from 'fflate'
import { extractAppArchive } from '../src/apps/app-runtime.mjs'

test('App archives preserve native execution without restoring group or special permissions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-executable-archive-'))
  try {
    const archive = path.join(root, 'app.zip')
    await fs.writeFile(archive, zipSync({
      'runtime/dbx-mcp': [Buffer.from('binary'), { os: 3, attrs: (0o107777 << 16) >>> 0 }],
      'mcp.json': [Buffer.from('{}'), { os: 3, attrs: (0o100666 << 16) >>> 0 }],
    }))
    const output = path.join(root, 'extracted')
    await extractAppArchive(archive, output)
    expect(await fs.readFile(path.join(output, 'runtime/dbx-mcp'), 'utf8')).toBe('binary')
    if (process.platform !== 'win32') {
      expect((await fs.stat(path.join(output, 'runtime/dbx-mcp'))).mode & 0o7777).toBe(0o700)
      expect((await fs.stat(path.join(output, 'mcp.json'))).mode & 0o7777).toBe(0o600)
    }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('App archives continue to reject symlinks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-link-archive-'))
  try {
    const archive = path.join(root, 'app.zip')
    await fs.writeFile(archive, zipSync({
      'runtime/dbx-mcp': [Buffer.from('/tmp/elsewhere'), { os: 3, attrs: (0o120777 << 16) >>> 0 }],
    }))
    await expect(extractAppArchive(archive, path.join(root, 'extracted'))).rejects.toThrow('Symbolic links are not allowed')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
