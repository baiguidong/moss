import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CloudStorageHost } from '../src/apps/cloud-storage.mjs'
import { createEnvelope, validateEnvelope, validateCloudStorageHostInput, validateCloudStorageHostOutput } from '../../packages/app-sdk/src/index.mjs'

const context = { appId: 'example.cloud-storage', instanceId: 'default' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
const unsupportedLink = async () => { throw Object.assign(new Error('No hard links'), { code: 'ENOTSUP' }) }

async function fixture(overrides: Record<string, any> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'moss-cloud-regression-'))
  const settings = { remoteEnabled: true, remoteDirect: { serverUrl: 'http://server.test', credentialMode: 'api-key', apiKey: 'old-key' } }
  const identity = { serverUrl: 'http://server.test', orgId: 'org', userId: 'alice' }
  const options = {
    directory: join(root, 'transfers'), getSettings: () => settings,
    resolveConnection: async () => ({ ...identity, authToken: `${settings.remoteDirect.apiKey}-token` }),
    fetchImpl: async () => { throw new Error('Unexpected network request') },
    pickFiles: async () => [], pickDestination: async () => null, authorizeApp: async () => true,
    ...overrides,
  }
  const host = new CloudStorageHost(options)
  const binding = host.binding(await host.connection())
  function task(extra: Record<string, any> = {}) {
    const t: any = {
      id: 'task-1', binding: { ...binding }, context, direction: 'upload', permission: 'cloud-storage:write',
      name: 'file.bin', fileId: 'file-1', uploadId: 'upload-1', uploadAttempted: true,
      state: 'paused', size: 4, transferred: 0, createdAt: 1, updatedAt: 1,
      ...extra,
    }
    host.tasks.set(t.id, t)
    return t
  }
  return { host, root, settings, identity, options, task, close: async () => { await host.close(); await rm(root, { recursive: true, force: true }) } }
}

test('completion winning cancellation is reported as completed, without deleting the file', async () => {
  const requests: string[] = []
  const f = await fixture({ fetchImpl: async (url: string, init: any) => {
    requests.push(`${init.method} ${url}`)
    return json({ error: { code: 'UPLOAD_COMPLETED', message: 'Already completed' } }, 409)
  } })
  try {
    const t = f.task()
    const pending = await f.host.handle('transfers.cancel', { transferId: t.id }, context)
    expect(pending.state).toBe('paused')
    expect(pending.error).toBe('CANCEL_PENDING')
    await f.host.cancellations.get(t.id)?.done
    expect(t.state).toBe('completed')
    expect(t.transferred).toBe(t.size)
    expect(requests).toEqual(['DELETE http://server.test/api/v1/cloud-storage/uploads/upload-1'])
  } finally { await f.close() }
})

test('failed cancellation persists its intent across restart and can be retried', async () => {
  let reject = true
  const f = await fixture({ fetchImpl: async () => reject
    ? json({ error: { code: 'FORBIDDEN', message: 'Revoked' } }, 403) : json({ ok: true }) })
  let restored: CloudStorageHost | undefined
  try {
    const t = f.task()
    await f.host.handle('transfers.cancel', { transferId: t.id }, context)
    await f.host.cancellations.get(t.id)?.done
    expect(t.state).toBe('paused')
    expect(t.error).toBe('FORBIDDEN')
    expect(t.cancelRequested).toBe(true)
    await f.host.close()
    restored = new CloudStorageHost(f.options)
    expect((await restored.handle('transfers.get', { transferId: t.id }, context)).error).toBe('CANCEL_PENDING')
    reject = false
    await restored.handle('transfers.resume', { transferId: t.id }, context)
    await restored.cancellations.get(t.id)?.done
    expect((await restored.handle('transfers.get', { transferId: t.id }, context)).state).toBe('cancelled')
  } finally { await restored?.close(); await f.close() }
})

test('an active transfer that commits while cancellation is stopping it stays completed', async () => {
  const f = await fixture()
  let release!: () => void, started!: () => void
  const committing = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { started = resolve })
  try {
    const t = f.task({ state: 'queued' })
    f.host.upload = async () => { started(); await committing; return true }
    f.host.launch(t)
    await entered
    await f.host.handle('transfers.cancel', { transferId: t.id }, context)
    release()
    await f.host.cancellations.get(t.id)?.done
    expect(t.state).toBe('completed')
    expect(t.cancelRequested).toBe(false)
  } finally { release(); await f.close() }
})

test('lost initialization response is recovered by requestKey without allocating another upload', async () => {
  const methods: string[] = []
  const f = await fixture({ fetchImpl: async (url: string, init: any) => {
    methods.push(init.method || 'GET')
    if (url.endsWith('/uploads?requestKey=task-1')) return json({ id: 'recovered', fileId: 'recovered-file' })
    expect(url.endsWith('/uploads/recovered')).toBe(true)
    return json({ ok: true })
  } })
  try {
    const t = f.task({ uploadId: null, fileId: null })
    await f.host.handle('transfers.cancel', { transferId: t.id }, context)
    await f.host.cancellations.get(t.id)?.done
    expect(t.state).toBe('cancelled')
    expect(methods).toEqual(['GET', 'DELETE'])
  } finally { await f.close() }
})

test('missing initialization remains unconfirmed while the server may still be creating it', async () => {
  const f = await fixture({ fetchImpl: async () => json({ error: { code: 'UPLOAD_NOT_FOUND' } }, 404) })
  try {
    const t = f.task({ uploadId: null })
    await f.host.handle('transfers.cancel', { transferId: t.id }, context)
    await f.host.cancellations.get(t.id)?.done
    expect(t.state).toBe('paused')
    expect(t.error).toBe('CANCEL_NOT_CONFIRMED')
  } finally { await f.close() }
})

test('credential rotation preserves same-account tasks and another account cannot access them', async () => {
  const tokens: string[] = []
  const f = await fixture({ fetchImpl: async (_url: string, init: any) => {
    tokens.push(init.headers.authorization)
    return json({ id: 'upload-1', fileId: 'file-1', state: 'completed' })
  } })
  try {
    const t = f.task({ sourcePath: join(f.root, 'removed-source') })
    const oldBinding = t.binding
    f.settings.remoteDirect.apiKey = 'rotated-key'
    f.host.invalidate()
    await expect(f.host.connection(oldBinding)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' })
    expect((await f.host.handle('transfers.list', {}, context)).transfers.map((v: any) => v.id)).toEqual([t.id])
    expect(t.binding).toBe(oldBinding) // Listing must not rewrite a running request's binding.
    await f.host.handle('transfers.resume', { transferId: t.id }, context)
    await f.host.running.get(t.id)?.done
    expect(t.state).toBe('completed')
    expect(t.binding.settingsKey).toBe(f.host.fingerprint())
    expect(tokens).toEqual(['Bearer rotated-key-token'])
    f.identity.userId = 'bob'
    f.settings.remoteDirect.apiKey = 'bob-key'
    f.host.invalidate()
    expect((await f.host.handle('transfers.list', {}, context)).transfers).toEqual([])
    await expect(f.host.handle('transfers.get', { transferId: t.id }, context)).rejects.toMatchObject({ code: 'TRANSFER_NOT_FOUND' })
    await expect(f.host.handle('transfers.resume', { transferId: t.id }, context)).rejects.toMatchObject({ code: 'TRANSFER_NOT_FOUND' })
  } finally { await f.close() }
})

test('transfer history is paginated below the Host envelope limit without duplicates', async () => {
  const f = await fixture()
  try {
    for (let i = 0; i < 2600; i++) f.task({ id: `task-${String(i).padStart(6, '0')}`, name: 'x'.repeat(250), state: 'completed' })
    const ids = new Set<string>()
    let cursor: string | null = null
    do {
      const input: any = { limit: 200, ...(cursor ? { cursor } : {}) }
      validateCloudStorageHostInput('transfers.list', input)
      const page = await f.host.handle('transfers.list', input, context)
      validateCloudStorageHostOutput('transfers.list', page)
      validateEnvelope(createEnvelope('host.response', { result: page }))
      for (const t of page.transfers) { expect(ids.has(t.id)).toBe(false); ids.add(t.id) }
      cursor = page.nextCursor
    } while (cursor)
    expect(ids.size).toBe(2600)
    expect(() => validateCloudStorageHostInput('transfers.list', { limit: 201 })).toThrow()
  } finally { await f.close() }
})

async function downloadTask(f: Awaited<ReturnType<typeof fixture>>) {
  const temporary = join(f.root, 'file.part'), destination = join(f.root, 'file.bin')
  await writeFile(temporary, 'file')
  const s = await stat(temporary)
  return f.task({ direction: 'download', permission: 'cloud-storage:read', revision: 'rev', temporary, destination,
    finalizing: true, tempIdentity: { ino: s.ino, dev: s.dev, birthtimeMs: s.birthtimeMs } })
}

test('download completes without hard-link support and publication is recognized after restart', async () => {
  const f = await fixture({ linkFile: unsupportedLink, fetchImpl: async () => json({ revision: 'rev', size: 4 }) })
  let restored: CloudStorageHost | undefined
  try {
    const t = await downloadTask(f)
    expect(await f.host.download(t, new AbortController().signal)).toBe(true)
    expect(await readFile(t.destination, 'utf8')).toBe('file')
    expect(t.copyDestination.complete).toBe(true)
    await expect(stat(t.temporary)).rejects.toMatchObject({ code: 'ENOENT' })
    await f.host.close()
    restored = new CloudStorageHost(f.options)
    expect(await restored.download(restored.tasks.get(t.id), new AbortController().signal)).toBe(true)
    expect(await readFile(t.destination, 'utf8')).toBe('file')
  } finally { await restored?.close(); await f.close() }
})

test('fallback publication never overwrites an existing destination', async () => {
  const f = await fixture({ linkFile: unsupportedLink })
  try {
    const t = await downloadTask(f)
    await writeFile(t.destination, 'keep this file')
    await expect(f.host.publishDownload(t, new AbortController().signal)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(t.destination, 'utf8')).toBe('keep this file')
    expect(await readFile(t.temporary, 'utf8')).toBe('file')
  } finally { await f.close() }
})

test('interrupted fallback copy can resume, and a replaced destination is never overwritten or removed', async () => {
  const f = await fixture({ linkFile: unsupportedLink })
  try {
    const t = await downloadTask(f), controller = new AbortController()
    controller.abort()
    await expect(f.host.publishDownload(t, controller.signal)).rejects.toThrow()
    expect(t.copyDestination.complete).toBe(false)
    expect(await f.host.publishDownload(t, new AbortController().signal)).toBe(true)
    expect(await readFile(t.destination, 'utf8')).toBe('file')

    const other = await downloadTask(f)
    await rm(other.destination)
    await expect(f.host.publishDownload(other, controller.signal)).rejects.toThrow()
    const replacement = join(f.root, 'replacement')
    await writeFile(replacement, 'keep replacement')
    await rename(replacement, other.destination)
    await expect(f.host.publishDownload(other, new AbortController().signal)).rejects.toMatchObject({ code: 'DESTINATION_CHANGED' })
    await expect(f.host.cleanup(other, new AbortController().signal)).rejects.toMatchObject({ code: 'DESTINATION_CHANGED' })
    expect(await readFile(other.destination, 'utf8')).toBe('keep replacement')
  } finally { await f.close() }
})

test('cancelling an unfinished fallback copy cleans only its own local files while remote is disabled', async () => {
  const f = await fixture({ linkFile: unsupportedLink })
  try {
    const t = await downloadTask(f), controller = new AbortController()
    controller.abort()
    await expect(f.host.publishDownload(t, controller.signal)).rejects.toThrow()
    f.settings.remoteEnabled = false
    await f.host.handle('transfers.cancel', { transferId: t.id }, context)
    await f.host.cancellations.get(t.id)?.done
    expect(t.state).toBe('cancelled')
    await expect(stat(t.destination)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(t.temporary)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await f.close() }
})
