import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ensureProjectAgentsFile } from '../src/project-agents.mjs'

test('project creation keeps the complete repository and generated instructions once', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'moss-agents-'))
  const file = path.join(root, 'AGENTS.md')
  try {
    const original = '# Repository rules\n\nKeep existing style.\n'
    const generated = '## Build\n\nUse bun.\n\n## Tests\n\nRun the desktop suite.'
    await writeFile(file, original)
    const first = await ensureProjectAgentsFile(root, '# AGENTS.md\n\n' + generated, { creating: true })
    await ensureProjectAgentsFile(root, '# AGENTS.md\n\n' + generated, { creating: true })
    expect(first.content.startsWith(original)).toBe(true)
    expect(first.content.split(generated)).toHaveLength(2)
    expect(await readFile(file, 'utf8')).toBe(first.content)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
