import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureProjectAgentsFile } from '../src/project-agents.mjs'

test('project creation reuses an existing AGENTS.md without writing to it', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-agents-'))
  const file = path.join(root, 'AGENTS.md')
  try {
    for (const original of ['# Repository rules\r\n\r\nKeep existing style.', '']) {
      await writeFile(file, original)
      await utimes(file, 1000, 1000)
      const modified = (await stat(file)).mtimeMs
      const results = await Promise.all([
        ensureProjectAgentsFile(root, '# AGENTS.md\n\n## Build\n\nUse bun.'),
        ensureProjectAgentsFile(root),
      ])
      expect(results).toEqual(Array(2).fill({ path: file, content: original, created: false }))
      expect(await readFile(file)).toEqual(Buffer.from(original))
      expect((await stat(file)).mtimeMs).toBe(modified)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('project creation writes the drafted instructions when AGENTS.md is missing', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-agents-'))
  try {
    const generated = '# AGENTS.md\n\n## Build\n\nUse bun.'
    const expected = `${generated}\n`
    const result = await ensureProjectAgentsFile(root, generated)
    expect(result.created).toBe(true)
    expect(result.content).toBe(expected)
    expect(await readFile(result.path, 'utf8')).toBe(expected)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
