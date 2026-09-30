import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalAppHostHandlers, createLocalFilesProtocolDefinition, createRuntimesProtocolDefinition, LOCAL_FILES_PROTOCOL, RUNTIMES_PROTOCOL } from '../src/apps/app-local-host.mjs'

test('Generic local Host picks files/directories and confines open/reveal to the caller App data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-app-local-'))
  try {
    const dataDir = join(root, 'app'); await mkdir(dataDir)
    const file = join(dataDir, '文档.md'), outside = join(root, 'outside.md')
    await writeFile(file, 'managed'); await writeFile(outside, 'outside')
    await symlink(outside, join(dataDir, 'escape.md'))
    const dialogs: unknown[] = [], opened: string[] = []
    const handlers = createLocalAppHostHandlers({ dialog: { async showOpenDialog(options: unknown) { dialogs.push(options); return { canceled: false, filePaths: [root] } } }, shell: { async openPath(p: string) { opened.push(p); return '' }, showItemInFolder(p: string) { opened.push(p) } }, getManagedRuntimeStatus: () => ({ python: { installed: true, path: '/managed/python' } }) })
    const local = handlers[LOCAL_FILES_PROTOCOL]
    expect(await local.pick({ kind: 'directory', multiple: false })).toEqual({ paths: [root] })
    expect(dialogs[0]).toEqual({ properties: ['openDirectory'] })
    expect(await local.open({ path: file }, { dataDir })).toEqual({ opened: true })
    expect(await local.reveal({ path: file }, { dataDir })).toEqual({ revealed: true })
    expect(opened.length).toBe(2)
    await expect(local.open({ path: outside }, { dataDir })).rejects.toThrow('outside')
    await expect(local.open({ path: join(dataDir, 'escape.md') }, { dataDir })).rejects.toThrow('outside')
    expect(handlers[RUNTIMES_PROTOCOL]['python.get']()).toEqual({ available: true, path: '/managed/python', version: null })
    const definition = createLocalFilesProtocolDefinition()
    expect(() => definition.methods.pick.validateInput({ kind: 'wrong' })).toThrow()
    expect(() => definition.methods.open.validateInput({ path: 'relative' })).toThrow()
    expect(() => createRuntimesProtocolDefinition().methods['python.get'].validateInput({ sessionId: 'x' })).toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})
