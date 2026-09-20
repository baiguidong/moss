import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, rename, rm, stat, symlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import JSZip from 'jszip'

import {
  getSkillSyncStatus,
  installSkillArchive,
  listProfileMemory,
  readProfileMemory,
  readSessionMemory,
} from '../profileResources.js'
import type { SessionRecord } from '../types.js'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(entry => rm(entry, { recursive: true, force: true })))
})

describe('server profile resources', () => {
  test('lists and reads profile and session memory within their roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-profile-resources-'))
    cleanup.push(root)
    const profileDir = join(root, 'profile')
    await mkdir(join(profileDir, 'memory', 'topics'), { recursive: true })
    await writeFile(join(profileDir, 'memory', 'MEMORY.md'), '- [Preference](topics/preference.md)')
    await writeFile(join(profileDir, 'memory', 'topics', 'preference.md'), [
      '---',
      'name: Remote preference',
      'type: feedback',
      '---',
      'Prefer concise answers.',
    ].join('\n'))

    const files = await listProfileMemory(profileDir)
    expect(files).toContainEqual(expect.objectContaining({
      path: 'topics/preference.md',
      title: 'Remote preference',
      indexed: true,
    }))
    await expect(readProfileMemory(profileDir, 'topics/preference.md'))
      .resolves.toMatchObject({ content: expect.stringContaining('Prefer concise answers.') })
    await expect(readProfileMemory(profileDir, '../outside.md')).rejects.toThrow('Invalid memory path')

    const transcriptDir = join(root, 'transcripts')
    await mkdir(join(transcriptDir, 'engine-1', 'session-memory'), { recursive: true })
    await writeFile(join(transcriptDir, 'engine-1', 'session-memory', 'summary.md'), '# Summary')
    const session = {
      transcriptSessionId: 'engine-1',
      runtime: { transcriptDir },
    } as SessionRecord
    await expect(readSessionMemory(session)).resolves.toMatchObject({
      exists: true,
      content: '# Summary',
    })
  })

  test('rejects profile-memory symlinks and reports oversized session memory as unreadable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-profile-memory-safety-'))
    cleanup.push(root)
    const profileDir = join(root, 'profile')
    const outsideDir = join(root, 'outside')
    await mkdir(profileDir, { recursive: true })
    await mkdir(outsideDir, { recursive: true })
    await writeFile(join(outsideDir, 'secret.md'), 'outside')
    await symlink(outsideDir, join(profileDir, 'memory'))

    await expect(listProfileMemory(profileDir)).rejects.toThrow('not a safe directory')
    await expect(readProfileMemory(profileDir, 'secret.md')).rejects.toThrow('not a safe directory')

    const transcriptDir = join(root, 'transcripts')
    const summaryDir = join(transcriptDir, 'engine-1', 'session-memory')
    await mkdir(summaryDir, { recursive: true })
    await writeFile(join(summaryDir, 'summary.md'), Buffer.alloc(512 * 1024 + 1))
    const session = {
      transcriptSessionId: 'engine-1',
      runtime: { transcriptDir },
    } as SessionRecord
    await expect(readSessionMemory(session)).resolves.toMatchObject({
      exists: true,
      readable: false,
      bytes: 512 * 1024 + 1,
      content: '',
    })
  })

  test('does not follow an oversized or escaping MEMORY index while listing', async () => {
    if (process.platform === 'win32') return
    const root = await mkdtemp(join(tmpdir(), 'moss-profile-memory-index-safety-'))
    cleanup.push(root)
    const profileDir = join(root, 'profile')
    const memoryDir = join(profileDir, 'memory')
    const outsideIndex = join(root, 'outside-index.md')
    await mkdir(memoryDir, { recursive: true })
    await writeFile(join(memoryDir, 'preference.md'), '# Preference')
    await writeFile(outsideIndex, '- [Preference](preference.md)')
    await symlink(outsideIndex, join(memoryDir, 'MEMORY.md'))

    const escaped = await listProfileMemory(profileDir)
    expect(escaped).toContainEqual(expect.objectContaining({
      path: 'preference.md',
      indexed: false,
    }))

    await rm(join(memoryDir, 'MEMORY.md'))
    await writeFile(
      join(memoryDir, 'MEMORY.md'),
      Buffer.concat([
        Buffer.from('- [Preference](preference.md)\n'),
        Buffer.alloc(512 * 1024, 32),
      ]),
    )
    const oversized = await listProfileMemory(profileDir)
    expect(oversized).toContainEqual(expect.objectContaining({
      path: 'MEMORY.md',
      readable: false,
    }))
    expect(oversized).toContainEqual(expect.objectContaining({
      path: 'preference.md',
      indexed: false,
    }))
  })

  test('replaces only files managed by desktop skill synchronization', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-profile-skills-'))
    cleanup.push(root)
    const profileDir = join(root, 'profile')
    const first = new JSZip()
    first.file('demo/SKILL.md', '# First', { unixPermissions: 0o600 })
    first.file('demo/old.txt', 'old')
    const firstArchive = await first.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
    await installSkillArchive(profileDir, firstArchive)
    await writeFile(join(profileDir, 'skills', 'server-only.txt'), 'keep')

    const second = new JSZip()
    second.file('demo/SKILL.md', '# Second', { unixPermissions: 0o600 })
    second.file('demo/run.sh', '#!/bin/sh\n', { unixPermissions: 0o700 })
    const secondArchive = await second.generateAsync({ type: 'nodebuffer', platform: 'UNIX' })
    const result = await installSkillArchive(profileDir, secondArchive)

    expect(result.unchanged).toBe(false)
    expect(await readFile(join(profileDir, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe('# Second')
    expect(await readFile(join(profileDir, 'skills', 'server-only.txt'), 'utf8')).toBe('keep')
    await expect(readFile(join(profileDir, 'skills', 'demo', 'old.txt'))).rejects.toThrow()
    expect((await stat(join(profileDir, 'skills', 'demo', 'run.sh'))).mode & 0o700).toBe(0o700)
    await expect(getSkillSyncStatus(profileDir)).resolves.toMatchObject({ fileCount: 2 })

    const outsideManifest = join(root, 'outside-manifest.json')
    await writeFile(outsideManifest, 'do not overwrite')
    await rename(
      join(profileDir, '.desktop-skills-sync.json'),
      join(profileDir, '.desktop-skills-sync.previous.json'),
    )
    await symlink(outsideManifest, join(profileDir, '.desktop-skills-sync.json'))
    const third = new JSZip()
    third.file('demo/SKILL.md', '# Third')
    await installSkillArchive(
      profileDir,
      await third.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
    )
    expect(await readFile(outsideManifest, 'utf8')).toBe('do not overwrite')
    expect(await readFile(join(profileDir, 'skills', 'demo', 'SKILL.md'), 'utf8')).toBe('# Third')
  })

  test('supports managed skill paths changing between directories and files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-profile-skills-shape-'))
    cleanup.push(root)
    const profileDir = join(root, 'profile')
    const first = new JSZip()
    first.file('demo/tool/config.json', '{}')
    await installSkillArchive(
      profileDir,
      await first.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
    )

    const second = new JSZip()
    second.file('demo/tool', 'executable')
    await installSkillArchive(
      profileDir,
      await second.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
    )
    expect(await readFile(join(profileDir, 'skills', 'demo', 'tool'), 'utf8'))
      .toBe('executable')

    const third = new JSZip()
    third.file('demo/tool/config.json', '{"restored":true}')
    await installSkillArchive(
      profileDir,
      await third.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
    )
    expect(await readFile(join(profileDir, 'skills', 'demo', 'tool', 'config.json'), 'utf8'))
      .toBe('{"restored":true}')
  })

  test('ignores unsafe paths in a corrupted managed-skill manifest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-profile-skills-manifest-'))
    cleanup.push(root)
    const profileDir = join(root, 'profile')
    const outside = join(root, 'outside.txt')
    await mkdir(join(profileDir, 'skills'), { recursive: true })
    await writeFile(outside, 'keep')
    await writeFile(join(profileDir, '.desktop-skills-sync.json'), JSON.stringify({
      revision: 'sha256:old',
      files: ['../../outside.txt', 'demo/old.txt'],
    }))
    await mkdir(join(profileDir, 'skills', 'demo'), { recursive: true })
    await writeFile(join(profileDir, 'skills', 'demo', 'old.txt'), 'old')

    const archive = new JSZip()
    archive.file('demo/SKILL.md', '# Safe')
    await installSkillArchive(
      profileDir,
      await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
    )

    expect(await readFile(outside, 'utf8')).toBe('keep')
    await expect(readFile(join(profileDir, 'skills', 'demo', 'old.txt'))).rejects.toThrow()
  })

  test('rejects a symlinked skills root without writing outside the profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'moss-profile-skills-safety-'))
    cleanup.push(root)
    const profileDir = join(root, 'profile')
    const outsideDir = join(root, 'outside')
    await mkdir(profileDir, { recursive: true })
    await mkdir(outsideDir, { recursive: true })
    await symlink(outsideDir, join(profileDir, 'skills'))
    const archive = new JSZip()
    archive.file('demo/SKILL.md', '# Unsafe')

    await expect(installSkillArchive(
      profileDir,
      await archive.generateAsync({ type: 'nodebuffer', platform: 'UNIX' }),
    )).rejects.toThrow('not a safe directory')
    await expect(readFile(join(outsideDir, 'demo', 'SKILL.md'))).rejects.toThrow()
  })
})
