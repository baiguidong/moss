import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isWorkspaceTrustedByDirectories } from '../workspaceTrust.js'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'moss-trust-'))
  roots.push(root)
  for (const name of ['project', 'project/child', 'project-other']) mkdirSync(join(root, name))
  return root
}

describe('explicit directory trust', () => {
  it('trusts only the requested directory or its children, including relative paths', () => {
    const root = fixture()
    const project = join(root, 'project')
    expect(isWorkspaceTrustedByDirectories(project, [project])).toBe(true)
    expect(isWorkspaceTrustedByDirectories(join(project, 'child'), ['..'])).toBe(true)
    expect(isWorkspaceTrustedByDirectories(join(root, 'project-other'), [project])).toBe(false)
    expect(isWorkspaceTrustedByDirectories(root, [project])).toBe(false)
    expect(isWorkspaceTrustedByDirectories(project, [])).toBe(false)
    expect(isWorkspaceTrustedByDirectories(project, [join(root, 'project-other'), project])).toBe(true)
  })

  it('resolves symlinks so a linked directory cannot escape the trusted root', () => {
    const root = fixture()
    const project = join(root, 'project')
    symlinkSync(join(root, 'project-other'), join(project, 'external'), 'dir')
    symlinkSync(project, join(root, 'alias'), 'dir')
    expect(isWorkspaceTrustedByDirectories(join(project, 'external'), [project])).toBe(false)
    expect(isWorkspaceTrustedByDirectories(join(root, 'alias'), [project])).toBe(true)
  })

  it('rejects invalid trust paths', () => {
    const root = fixture()
    const file = join(root, 'file')
    writeFileSync(file, '')
    expect(() => isWorkspaceTrustedByDirectories(root, [file])).toThrow('Not a directory')
    expect(() => isWorkspaceTrustedByDirectories(root, [join(root, 'missing')])).toThrow()
  })
})
