import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import {
  cleanupIntermediateFiles,
  detectFileIntent,
  ensureDraftsDirectory,
} from '../draftsCleanup.js'

async function withTempWorkspace<T>(fn: (workspace: string) => Promise<T>): Promise<T> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'moss-drafts-test-'))
  try {
    return await fn(workspace)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

describe('drafts cleanup', () => {
  it('detects file intent markers in language comments', () => {
    expect(detectFileIntent('helper.py', '# @draft\nprint("work")')).toMatchObject({
      intent: 'draft',
      marker: '@draft',
      line: 1,
    })
    expect(detectFileIntent('report.md', '<!-- @final -->\n# Report')).toMatchObject({
      intent: 'final',
      marker: '@final',
      line: 1,
    })
  })

  it('creates a real drafts directory for the workspace', async () => {
    await withTempWorkspace(async workspace => {
      const draftsDir = await ensureDraftsDirectory(workspace)

      expect((await stat(draftsDir)).isDirectory()).toBe(true)
      expect(draftsDir).toBe(path.join(workspace, '.drafts'))
    })
  })

  it('moves draft files to .drafts and keeps final files in the workspace root', async () => {
    await withTempWorkspace(async workspace => {
      await writeFile(path.join(workspace, 'helper.py'), '# @draft\nprint("helper")')
      await writeFile(path.join(workspace, 'report.md'), '<!-- @final -->\n# Report')

      await cleanupIntermediateFiles(workspace)

      expect(existsSync(path.join(workspace, 'helper.py'))).toBe(false)
      expect(await readFile(path.join(workspace, '.drafts', 'helper.py'), 'utf8')).toContain('@draft')
      expect(existsSync(path.join(workspace, 'report.md'))).toBe(true)
    })
  })

  it('moves package side effects when draft scripts are present', async () => {
    await withTempWorkspace(async workspace => {
      await writeFile(path.join(workspace, 'generate.js'), '// @draft\nconsole.log("generate")')
      await writeFile(path.join(workspace, 'package.json'), '{"type":"module"}')

      await cleanupIntermediateFiles(workspace)

      expect(existsSync(path.join(workspace, '.drafts', 'generate.js'))).toBe(true)
      expect(existsSync(path.join(workspace, '.drafts', 'package.json'))).toBe(true)
      expect(existsSync(path.join(workspace, 'package.json'))).toBe(false)
    })
  })
})
