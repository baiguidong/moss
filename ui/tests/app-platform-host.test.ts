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

  async function downloadFixture(fetchImpl: typeof fetch, dialog?: any) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-download-'))
    roots.push(directory)
    const filePath = path.join(directory, 'download.txt')
    await fs.writeFile(filePath, 'original')
    const handlers = createAppPlatformHandlers({ fetchImpl,
      dialog: dialog || { showSaveDialog: async () => ({ canceled: false, filePath }) },
    })
    return { directory, filePath, download: (signal?: AbortSignal) => handlers['file.download'](
      { url: 'https://example.invalid/download', fileName: 'download.txt' }, { signal },
    ) }
  }

  it('streams a download and replaces the destination only on success', async () => {
    const f = await downloadFixture((async () => new Response('新文件')) as typeof fetch)
    expect(await f.download()).toEqual({ canceled: false, filePath: f.filePath })
    expect(await fs.readFile(f.filePath, 'utf8')).toBe('新文件')
    expect(await fs.readdir(f.directory)).toEqual(['download.txt'])
  })

  it('cancels a streaming download without changing the destination or leaving temporary files', async () => {
    let receivedSignal: AbortSignal | undefined, cancelled = false
    let started!: () => void
    const ready = new Promise<void>(resolve => { started = resolve })
    const f = await downloadFixture((async (_url, options) => {
      receivedSignal = options?.signal as AbortSignal
      let sent = false
      return { ok: true, headers: new Headers(), body: new ReadableStream({
        pull(controller) { if (!sent) { sent = true; controller.enqueue(new Uint8Array([1, 2, 3])); started() } },
        cancel() { cancelled = true },
      }) }
    }) as typeof fetch)
    const controller = new AbortController()
    const pending = f.download(controller.signal)
    const rejection = pending.catch(error => error)
    await ready
    await new Promise(resolve => setTimeout(resolve, 10))
    controller.abort()
    expect(await rejection).toBeInstanceOf(Error)
    expect(receivedSignal).toBe(controller.signal)
    expect(cancelled).toBe(true)
    expect(await fs.readFile(f.filePath, 'utf8')).toBe('original')
    expect(await fs.readdir(f.directory)).toEqual(['download.txt'])
  })

  it('does not start a download when canceled while the save dialog is open', async () => {
    const controller = new AbortController()
    let fetches = 0
    const f = await downloadFixture((async () => { fetches++; return new Response('unexpected') }) as typeof fetch, {
      showSaveDialog: async () => { controller.abort(); return { filePath: '/unused' } },
    })
    await expect(f.download(controller.signal)).rejects.toThrow()
    expect(fetches).toBe(0)
  })

  it('enforces the byte limit while streaming even without Content-Length', async () => {
    let cancelled = false, chunks = 0
    const chunk = new Uint8Array(1024 * 1024)
    const f = await downloadFixture((async () => ({ ok: true, headers: new Headers(), body: new ReadableStream({
      pull(controller) { chunks++; controller.enqueue(chunk) },
      cancel() { cancelled = true },
    }) })) as typeof fetch)
    await expect(f.download()).rejects.toThrow('100 MB')
    expect(cancelled).toBe(true)
    expect(chunks).toBeLessThan(110)
    expect(await fs.readFile(f.filePath, 'utf8')).toBe('original')
    expect(await fs.readdir(f.directory)).toEqual(['download.txt'])
  })

  it('rejects oversized Content-Length and failed streams without replacing the destination', async () => {
    for (const response of [
      () => new Response('unavailable', { status: 503 }),
      () => new Response('small', { headers: { 'content-length': String(100 * 1024 * 1024 + 1) } }),
      () => ({ ok: true, headers: new Headers(), body: new ReadableStream({ pull(controller) { controller.error(new Error('network failed')) } }) }),
    ]) {
      const f = await downloadFixture((async () => response()) as typeof fetch)
      await expect(f.download()).rejects.toThrow()
      expect(await fs.readFile(f.filePath, 'utf8')).toBe('original')
      expect(await fs.readdir(f.directory)).toEqual(['download.txt'])
    }
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
