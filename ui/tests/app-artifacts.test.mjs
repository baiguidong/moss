import { test, expect } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { AppRuntimeHost, defaultInstanceId, writePackageChecksums } from '../../packages/app-runtime/src/index.mjs'
import { createAppArtifactProtocolDefinition, createAppArtifactUrls } from '../src/apps/app-artifacts.mjs'
import { createWebResources } from '../src/web/resources.mjs'

test('Host artifact URL survives Backend idling, supports ranges and revokes with App state', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-outside-'))
  const artifacts = createAppArtifactUrls()
  let enabled = true
  try {
    await fs.writeFile(path.join(root, 'result.pdf'), Buffer.from('0123456789'))
    await fs.writeFile(path.join(root, 'workspace.json'), 'private workspace state')
    await fs.writeFile(path.join(outside, 'other.pdf'), 'outside')
    await fs.symlink(path.join(outside, 'other.pdf'), path.join(root, 'link.pdf'))
    const context = { owner: { key: 'host' }, appId: 'test.pdf', instanceId: 'test.pdf--default', generation: 1,
      dataDir: root, assertCurrent() { if (!enabled) throw new Error('App disabled') } }
    await expect(artifacts.url({ relativePath: '../other.pdf' }, context)).rejects.toThrow(/Invalid App artifact path/)
    await expect(artifacts.url({ relativePath: 'link.pdf' }, context)).rejects.toThrow(/outside the App data directory/)
    const first = await artifacts.url({ relativePath: 'result.pdf' }, context)
    expect((await artifacts.url({ relativePath: 'result.pdf' }, context)).url).toBe(first.url)
    const response = await fetch(first.url, { headers: { Range: 'bytes=2-5' } })
    expect(response.status).toBe(206)
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self' moss-app:")
    expect(await response.text()).toBe('2345')
    const otherFile = new URL(first.url)
    otherFile.pathname = otherFile.pathname.replace(/result\.pdf$/, 'workspace.json')
    expect((await fetch(otherFile)).status).toBe(404)
    enabled = false
    expect((await fetch(first.url)).status).toBe(404)
  } finally { await artifacts.close(); await fs.rm(root, { recursive: true, force: true }); await fs.rm(outside, { recursive: true, force: true }) }
})

test('Host artifact URLs share a scoped Web resource and bind signatures to each file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-web-'))
  const resources = createWebResources({ env: {}, maxEntries: 1 })
  const artifacts = createAppArtifactUrls({ web: true, getWebResources: () => resources })
  const server = http.createServer((req, res) => {
    void resources.serve(req, res, new URL(req.url, 'http://local')).catch(() => {
      if (!res.headersSent) res.writeHead(403)
      res.end()
    })
  })
  try {
    const files = [
      ['record.wav', 'audio/wav'], ['record.mp3', 'audio/mpeg'], ['record.m4a', 'audio/mp4'],
      ['record.aac', 'audio/aac'], ['record.ogg', 'audio/ogg'], ['record.flac', 'audio/flac'],
      ['record.aif', 'audio/aiff'], ['record.aiff', 'audio/aiff'], ['record.opus', 'audio/opus'],
      ['clip.mp4', 'video/mp4'], ['clip.mov', 'video/quicktime'], ['clip.webm', 'video/webm'], ['clip.mkv', 'video/x-matroska'],
      ['image.avif', 'image/avif'], ['image.tiff', 'image/tiff'],
      ['subtitle.srt', 'text/plain; charset=utf-8'], ['subtitle.vtt', 'text/vtt; charset=utf-8'], ['transcript.txt', 'text/plain; charset=utf-8'],
      ['nested folder/研究%?#.pdf', 'application/pdf'],
    ]
    await fs.mkdir(path.join(root, 'nested folder'))
    await Promise.all(files.map(([name]) => fs.writeFile(path.join(root, name), '0123456789')))
    await fs.writeFile(path.join(root, 'private.txt'), 'private')
    await fs.writeFile(path.join(root, 'empty.txt'), '')
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    let generation = 1
    const context = current => ({ owner: { key: 'user:org:one' }, appId: 'test.media', instanceId: 'test.media--default',
      version: '1.0.0', generation: current, dataDir: root,
      assertCurrent() { if (current !== generation) throw new Error('App generation changed') } })
    const firstContext = context(1)
    const urls = await Promise.all(files.map(([name]) => artifacts.url({ relativePath: name }, firstContext).then(result => result.url)))
    expect(new Set(urls.map(value => new URL(value, base).pathname.split('/')[3])).size).toBe(1)
    expect((await artifacts.url({ relativePath: files[0][0] }, firstContext)).url).toBe(urls[0])
    for (const [index, [, type]] of files.entries()) {
      const response = await fetch(new URL(urls[index], base), { headers: { Range: 'bytes=2-5' } })
      expect(response.status).toBe(206)
      expect(response.headers.get('content-type')).toBe(type)
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'self';")
      expect(await response.text()).toBe('2345')
    }
    const empty = await artifacts.url({ relativePath: 'empty.txt' }, firstContext)
    const emptyResponse = await fetch(new URL(empty.url, base))
    expect(emptyResponse.status).toBe(200)
    expect(emptyResponse.headers.get('content-length')).toBe('0')
    const emptyRange = await fetch(new URL(empty.url, base), { headers: { Range: 'bytes=0-0' } })
    expect(emptyRange.status).toBe(416)
    expect(emptyRange.headers.get('content-range')).toBe('bytes */0')
    expect(emptyRange.headers.get('access-control-allow-origin')).toBe('*')
    const rewritten = new URL(urls[0], base)
    rewritten.pathname = rewritten.pathname.replace(/record\.wav$/, 'private.txt')
    expect((await fetch(rewritten)).status).toBe(403)
    const altered = new URL(urls[0], base)
    altered.searchParams.set('sig', 'A'.repeat(43))
    expect((await fetch(altered)).status).toBe(403)
    const noncanonical = new URL(urls[0], base)
    noncanonical.pathname = noncanonical.pathname.replace('record.wav', '%72ecord.wav')
    expect((await fetch(noncanonical)).status).toBe(403)
    await expect(resources.create({ root, entryPath: path.join(root, 'private.txt') })).rejects.toThrow(/预览过多/)
    generation = 2
    const replacement = await artifacts.url({ relativePath: files[0][0] }, context(2))
    expect(new URL(replacement.url, base).pathname.split('/')[3]).not.toBe(new URL(urls[0], base).pathname.split('/')[3])
    expect((await fetch(new URL(urls[0], base))).status).toBe(403)
    expect((await fetch(new URL(replacement.url, base))).status).toBe(200)
    const crossScope = new URL(replacement.url, base)
    crossScope.search = new URL(urls[0], base).search
    expect((await fetch(crossScope)).status).toBe(403)
  } finally {
    await artifacts.close()
    resources.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('scoped artifact token rotation keeps old URLs until expiry and shares one new token', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-rotation-'))
  let time = Date.now()
  const now = () => time
  const resources = createWebResources({ env: {}, now, maxEntries: 2 })
  let creations = 0
  const provider = { create: async options => { creations++; return resources.create(options) } }
  const artifacts = createAppArtifactUrls({ web: true, getWebResources: () => provider, now })
  const server = http.createServer((req, res) => {
    void resources.serve(req, res, new URL(req.url, 'http://local')).catch(() => {
      if (!res.headersSent) res.writeHead(403)
      res.end()
    })
  })
  try {
    await Promise.all(['old.pdf', 'new-a.pdf', 'new-b.pdf'].map(name => fs.writeFile(path.join(root, name), name)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const context = { owner: { key: 'host' }, appId: 'test.rotate', instanceId: 'test.rotate--default',
      generation: 1, version: '1.0.0', dataDir: root, assertCurrent() {}, assertAppCurrent() {} }
    const old = await artifacts.url({ relativePath: 'old.pdf' }, context)
    time += 12 * 3600_000 + 1
    const [newA, newB] = await Promise.all(['new-a.pdf', 'new-b.pdf'].map(relativePath => artifacts.url({ relativePath }, context)))
    const token = value => new URL(value, base).pathname.split('/')[3]
    expect(token(newA.url)).toBe(token(newB.url))
    expect(token(newA.url)).not.toBe(token(old.url))
    expect(creations).toBe(2)
    expect(await (await fetch(new URL(old.url, base))).text()).toBe('old.pdf')
    expect(await (await fetch(new URL(newA.url, base))).text()).toBe('new-a.pdf')
    await expect(resources.create({ root, entryPath: path.join(root, 'old.pdf') })).rejects.toThrow(/预览过多/)
    await artifacts.close()
    expect((await fetch(new URL(old.url, base))).status).toBe(403)
    expect((await fetch(new URL(newB.url, base))).status).toBe(403)
    expect((await resources.create({ root, entryPath: path.join(root, 'old.pdf') })).active()).toBe(true)
  } finally {
    await artifacts.close()
    resources.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Host artifact URLs retain App context and are revoked on Web logout', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-owner-'))
  const ownerContext = new AsyncLocalStorage()
  const resources = createWebResources({ env: {} })
  const artifacts = createAppArtifactUrls({ web: true, getWebResources: () => resources, webOwnerId: 'alice' })
  const server = http.createServer((req, res) => {
    void resources.serve(req, res, new URL(req.url, 'http://local')).catch(() => {
      if (!res.headersSent) res.writeHead(403)
      res.end()
    })
  })
  try {
    await fs.writeFile(path.join(root, 'result.pdf'), 'owner-scoped')
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const context = { owner: { key: 'host' }, appId: 'test.owner', instanceId: 'test.owner--default',
      generation: 1, version: '1.0.0', dataDir: root,
      assertCurrent() { if (ownerContext.getStore() !== 'owner') throw new Error('Wrong App owner') } }
    const result = await ownerContext.run('owner', () => artifacts.url({ relativePath: 'result.pdf' }, context))
    const base = `http://127.0.0.1:${server.address().port}`
    const response = await fetch(`${base}${result.url}`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('owner-scoped')
    resources.revokeOwner('alice')
    expect((await fetch(`${base}${result.url}`)).status).toBe(403)
    const renewed = await ownerContext.run('owner', () => artifacts.url({ relativePath: 'result.pdf' }, context))
    expect(renewed.url).not.toBe(result.url)
    expect((await fetch(`${base}${renewed.url}`)).status).toBe(200)
  } finally {
    await artifacts.close()
    resources.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('artifact authorization survives a completed Host request for a user-owned App', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-host-'))
  const artifacts = createAppArtifactUrls()
  let runtime
  try {
    const appId = 'test.owner-artifact'
    const source = path.join(root, 'source')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'index.html'), '<!doctype html><title>Artifact</title>')
    await fs.writeFile(path.join(source, 'app.moss.json'), JSON.stringify({ schemaVersion: 2, id: appId,
      displayName: 'Artifact', version: '1.0.0', hostApi: '^3.17.0', ui: { entry: 'index.html' },
      host: { protocols: ['moss.artifacts/v1'] }, permissions: [] }))
    await writePackageChecksums(source)
    runtime = await new AppRuntimeHost({ rootDir: path.join(root, 'host'),
      defaultOwner: { scope: 'user', orgId: 'org', userId: 'alice' } }).initialize()
    runtime.registerHostProtocol(createAppArtifactProtocolDefinition())
    runtime.registerHostHandler('moss.artifacts/v1', 'url.get', (input, context) => artifacts.url(input, context))
    await runtime.installFromDirectory(source)
    const instanceId = defaultInstanceId(appId)
    const dataDir = runtime.appDataPath(runtime.dataDir, appId, 'instances', instanceId)
    await fs.mkdir(dataDir, { recursive: true })
    await fs.writeFile(path.join(dataDir, 'result.pdf'), 'user artifact')
    const issue = () => {
      const current = runtime.runtimeForInstance(appId, instanceId)
      return runtime.dispatchHostRequest({ appId, instanceId, key: current.key,
        generation: current.generation, version: '1.0.0', owner: runtime.currentOwner(),
        surface: 'backend', protocol: 'moss.artifacts/v1', method: 'url.get', input: { relativePath: 'result.pdf' } })
    }
    const result = await issue()
    const response = await fetch(result.url)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('user artifact')
    await runtime.setAppEnabled(appId, false)
    expect((await fetch(result.url)).status).toBe(404)
    await runtime.setAppEnabled(appId, true)
    expect((await fetch(result.url)).status).toBe(404)
    const afterEnable = await issue()
    expect(afterEnable.url).not.toBe(result.url)
    expect((await fetch(afterEnable.url)).status).toBe(200)

    await runtime.setInstanceEnabled(appId, instanceId, false)
    await runtime.setInstanceEnabled(appId, instanceId, true)
    expect((await fetch(afterEnable.url)).status).toBe(404)
    const beforeUninstall = await issue()
    expect((await fetch(beforeUninstall.url)).status).toBe(200)
    await runtime.uninstall(appId)
    await runtime.installFromDirectory(source)
    expect((await fetch(beforeUninstall.url)).status).toBe(404)
    const afterReinstall = await issue()
    expect(afterReinstall.url).not.toBe(beforeUninstall.url)
    expect((await fetch(afterReinstall.url)).status).toBe(200)
  } finally {
    await artifacts.close()
    await runtime?.shutdown()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('Web resource capacity includes concurrent creations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-resource-capacity-'))
  const resources = createWebResources({ env: {}, maxEntries: 1 })
  try {
    const file = path.join(root, 'index.html')
    await fs.writeFile(file, 'preview')
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => resources.create({ root, entryPath: file })))
    const created = results.filter(result => result.status === 'fulfilled')
    expect(created).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(7)
    created[0].value.revoke()
    expect((await resources.create({ root, entryPath: file })).active()).toBe(true)
  } finally { resources.close(); await fs.rm(root, { recursive: true, force: true }) }
})

test('canceling one Host request leaves other scoped artifact URLs valid', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-artifact-cancel-'))
  const resources = createWebResources({ env: {}, maxEntries: 1 })
  let canceled = false
  const provider = { create: async options => {
    const handle = await resources.create(options)
    return { ...handle, async urlFor(file) {
      const url = await handle.urlFor(file)
      if (path.basename(file) === 'canceled.pdf') canceled = true
      return url
    } }
  } }
  const artifacts = createAppArtifactUrls({ web: true, getWebResources: () => provider })
  const server = http.createServer((req, res) => {
    void resources.serve(req, res, new URL(req.url, 'http://local')).catch(() => {
      if (!res.headersSent) res.writeHead(403)
      res.end()
    })
  })
  try {
    await Promise.all(['kept.pdf', 'canceled.pdf', 'second.pdf'].map(name => fs.writeFile(path.join(root, name), name)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    let firstRequestAborted = false
    let appGeneration = 1
    let enabled = true
    const context = { owner: { key: 'host' }, appId: 'test.cancel', instanceId: 'test.cancel--default',
      generation: 1, version: '1.0.0', dataDir: root,
      assertAppCurrent() { if (!enabled || this.generation !== appGeneration) throw new Error('App changed') },
      assertCurrent() { this.assertAppCurrent() } }
    const firstContext = { ...context, assertCurrent() { if (firstRequestAborted) throw new Error('First Host request canceled'); this.assertAppCurrent() } }
    const canceledContext = { ...context, assertCurrent() { if (canceled) throw new Error('Host request canceled'); this.assertAppCurrent() } }
    const kept = await artifacts.url({ relativePath: 'kept.pdf' }, firstContext)
    firstRequestAborted = true
    const [failed, second] = await Promise.allSettled([
      artifacts.url({ relativePath: 'canceled.pdf' }, canceledContext),
      artifacts.url({ relativePath: 'second.pdf' }, context),
    ])
    expect(failed.status).toBe('rejected')
    expect(second.status).toBe('fulfilled')
    const base = `http://127.0.0.1:${server.address().port}`
    expect(await (await fetch(new URL(kept.url, base))).text()).toBe('kept.pdf')
    expect(await (await fetch(new URL(second.value.url, base))).text()).toBe('second.pdf')
    enabled = false
    expect((await fetch(new URL(kept.url, base))).status).toBe(403)
    enabled = true; appGeneration = 2
    expect((await fetch(new URL(second.value.url, base))).status).toBe(403)
  } finally {
    await artifacts.close()
    resources.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await fs.rm(root, { recursive: true, force: true })
  }
})
