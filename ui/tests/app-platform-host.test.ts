import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { validatePlatformHostInput } from '../../packages/app-sdk/src/index.mjs'
import {
  createAppPlatformHandlers,
  isAllowedAppMediaPermission,
} from '../src/apps/app-platform-host.mjs'

const roots: string[] = []

afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))))

describe('App platform Host', () => {
  it('materializes large files in bounded chunks', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-file-'))
    roots.push(dataDir)
    const handlers = createAppPlatformHandlers({
      desktopCapturer: {}, dialog: {}, nativeImage: {}, screen: {}, shell: {}, systemPreferences: {},
    })
    const first = handlers['file.materialize']({
      fileName: 'sample.txt',
      dataBase64: Buffer.from('hello').toString('base64'),
      transferId: 'transfer-1',
      offset: 0,
      complete: false,
    }, { dataDir })
    expect(first).toEqual({ transferId: 'transfer-1', complete: false, size: 5 })
    const completed = handlers['file.materialize']({
      fileName: 'sample.txt',
      dataBase64: Buffer.from(' world').toString('base64'),
      transferId: 'transfer-1',
      offset: 5,
      complete: true,
    }, { dataDir })
    expect(await fs.readFile(completed.path, 'utf8')).toBe('hello world')
  })

  it('keeps each inline transfer request below the App IPC envelope limit', () => {
    expect(() => validatePlatformHostInput('file.materialize', {
      fileName: 'large.bin',
      dataBase64: 'A'.repeat(512 * 1024 + 1),
    })).toThrow(/dataBase64/)
  })

  it('denies media access when every App instance is disabled', () => {
    const state: any = {
      id: 'example.app',
      manifest: { permissions: ['platform:media'] },
      source: { mode: 'installed' },
    }
    const runtime = {
      installations: { get: () => ({ enabled: true, grants: ['platform:media'] }) },
      instances: { list: () => [{ id: 'default', enabled: false }] },
    }
    state.runtime = runtime
    expect(isAllowedAppMediaPermission({ state, runtime, permission: 'media', mediaTypes: ['audio'] })).toBe(false)
    runtime.instances.list = () => [{ id: 'default', enabled: true }]
    expect(isAllowedAppMediaPermission({ state, runtime, permission: 'media', mediaTypes: ['audio'] })).toBe(true)
  })
})
