import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createAppMarketplaceService,
  normalizeMarketplaceIndex,
} from '../src/apps/app-marketplace.mjs'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

function version(archive: Buffer, versionNumber = '1.2.0') {
  return {
    version: versionNumber,
    hostApi: '^2.0.0',
    platforms: ['darwin-arm64', 'win32-x64'],
    permissions: ['agent:turns:write'],
    publishedAt: '2026-09-21T00:00:00.000Z',
    releaseNotes: 'First marketplace release.',
    artifact: {
      fileName: `example.app-${versionNumber}.zip`,
      downloadUrl: `https://github.com/example/apps/releases/download/example.app-v${versionNumber}/example.app-${versionNumber}.zip`,
      sha256: createHash('sha256').update(archive).digest('hex'),
      size: archive.length,
      signed: true,
      publisherId: 'moss',
      keyId: 'release-1',
    },
  }
}

function catalog(latest: ReturnType<typeof version>) {
  return {
    schemaVersion: 1,
    catalogId: 'moss-official',
    displayName: 'Moss 应用市场',
    generatedAt: '2026-09-21T00:00:00.000Z',
    apps: [{
      id: 'example.app',
      displayName: 'Example',
      summary: 'Example App',
      publisher: { id: 'moss', name: 'Moss' },
      categories: ['效率'],
      featured: true,
      iconUrl: 'https://example.com/icon.svg',
      detailUrl: 'https://example.com/example.app.json',
      latestVersion: latest.version,
      latest,
    }],
  }
}

function detail(latest: ReturnType<typeof version>) {
  return {
    schemaVersion: 1,
    id: 'example.app',
    displayName: 'Example',
    summary: 'Example App',
    description: 'Example detail',
    publisher: { id: 'moss', name: 'Moss' },
    categories: ['效率'],
    keywords: ['example'],
    homepage: 'https://example.com',
    repository: 'https://github.com/example/apps',
    license: 'MIT',
    featured: true,
    iconUrl: 'https://example.com/icon.svg',
    latestVersion: latest.version,
    versions: [latest],
  }
}

describe('App marketplace', () => {
  it('normalizes catalog URLs and rejects unsafe artifact metadata', () => {
    const archive = Buffer.from('app')
    const normalized = normalizeMarketplaceIndex(catalog(version(archive)), 'https://example.com/v1/index.json')
    expect(normalized.apps[0].latest.artifact.downloadUrl).toContain('github.com/example/apps')
    expect(() => normalizeMarketplaceIndex(catalog({
      ...version(archive),
      artifact: { ...version(archive).artifact, sha256: 'bad' },
    }), 'https://example.com/v1/index.json')).toThrow('Invalid App artifact SHA-256')
    expect(() => normalizeMarketplaceIndex(catalog({
      ...version(archive),
      artifact: { ...version(archive).artifact, fileName: '../app.zip' },
    }), 'https://example.com/v1/index.json')).toThrow('Invalid App artifact filename')
    expect(() => normalizeMarketplaceIndex(catalog({
      ...version(archive),
      artifact: { ...version(archive).artifact, size: 0 },
    }), 'https://example.com/v1/index.json')).toThrow('Invalid App artifact size')
  })

  it('restores the package registry when activating an update fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-rollback-'))
    roots.push(root)
    const archive = Buffer.from('signed update')
    const latest = version(archive)
    const responses = new Map([
      ['https://example.com/index.json', Buffer.from(JSON.stringify(catalog(latest)))],
      ['https://example.com/example.app.json', Buffer.from(JSON.stringify(detail(latest)))],
      [latest.artifact.downloadUrl, archive],
    ])
    const rollbacks: unknown[] = []
    const progress: any[] = []
    const runtime = {
      getInstallation: () => ({ activeVersion: '1.1.0', grants: ['agent:turns:write'] }),
      registerInstalled: async () => { throw new Error('backend did not start') },
    }
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json',
      cachePath: path.join(root, 'catalog.json'),
      platform: 'darwin-arm64',
      trustedPublishers: { moss: { keys: { 'release-1': 'public key' } } },
      getInstalledApps: async () => [{ id: 'example.app', currentVersion: '1.1.0' }],
      getRuntime: () => runtime,
      download: async (url: string) => {
        const response = responses.get(url)
        if (!response) throw new Error(`Unexpected URL: ${url}`)
        return response
      },
      installArchive: async (_runtime: unknown, _archivePath: string, options: { installPackage: (root: string) => Promise<unknown> }) => {
        return options.installPackage('/verified-package')
      },
      validatePackage: async () => ({
        manifest: { id: 'example.app', version: '1.2.0' },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }),
      installPackage: async () => ({ id: 'example.app', currentVersion: '1.2.0' }),
      rollbackPackage: async (input: unknown) => { rollbacks.push(input) },
      emitProgress: (value: unknown) => progress.push(value),
    })

    await expect(service.install({ appId: 'example.app' })).rejects.toThrow('backend did not start')
    expect(rollbacks).toEqual([{
      appId: 'example.app',
      previousVersion: '1.1.0',
      failedVersion: '1.2.0',
    }])
    expect(progress.slice(-3).map((value) => value.phase)).toEqual(['activating', 'rolling-back', 'error'])
    expect(progress.at(-1).error).toBe('backend did not start')
    expect(progress.some((value) => value.phase === 'completed')).toBe(false)
  })

  it('loads the catalog, asks for new permissions, then installs the selected signed version', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-'))
    roots.push(root)
    const archive = Buffer.from('signed zip bytes')
    const latest = version(archive)
    const responses = new Map([
      ['https://example.com/index.json', Buffer.from(JSON.stringify(catalog(latest)))],
      ['https://example.com/example.app.json', Buffer.from(JSON.stringify(detail(latest)))],
      [latest.artifact.downloadUrl, archive],
    ])
    const calls: Array<{ version: string; grants: string[] }> = []
    const progress: any[] = []
    const runtime = {
      getInstallation: () => null,
      registerInstalled: async (_appId: string, installedVersion: string, options: { grants: string[] }) => {
        expect(progress.at(-1).phase).toBe('activating')
        calls.push({ version: installedVersion, grants: options.grants })
      },
    }
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json',
      cachePath: path.join(root, 'catalog.json'),
      platform: 'darwin-arm64',
      trustedPublishers: { moss: { keys: { 'release-1': 'public key' } } },
      getInstalledApps: async () => [],
      getRuntime: () => runtime,
      emitProgress: (value: unknown) => progress.push(value),
      download: async (url: string, options: { onProgress?: (value: unknown) => void }) => {
        const response = responses.get(url)
        if (!response) throw new Error(`Unexpected URL: ${url}`)
        if (url === latest.artifact.downloadUrl) options.onProgress?.({ receivedBytes: 5, totalBytes: null })
        return response
      },
      installArchive: async (_runtime: unknown, _archivePath: string, options: { onProgress: (value: unknown) => void; installPackage: (root: string) => Promise<unknown> }) => {
        options.onProgress({ phase: 'extracting' })
        return options.installPackage('/verified-package')
      },
      validatePackage: async () => ({
        manifest: { id: 'example.app', version: '1.2.0' },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }),
      installPackage: async () => ({ id: 'example.app', name: 'example.app', currentVersion: '1.2.0' }),
    })

    const listing = await service.list({ forceRefresh: true })
    expect(listing.apps[0]).toMatchObject({ id: 'example.app', installedVersion: null, platformCompatible: true, hostCompatible: true })
    expect(await service.install({ appId: 'example.app' })).toMatchObject({
      ok: false,
      requiresPermissionApproval: true,
      permissions: ['agent:turns:write'],
    })
    expect(progress).toHaveLength(0)
    expect(await service.install({ appId: 'example.app', acceptPermissions: true })).toMatchObject({ ok: true, version: '1.2.0' })
    expect(calls).toEqual([{ version: '1.2.0', grants: ['agent:turns:write'] }])
    expect(progress.map((value) => value.phase)).toEqual([
      'downloading', 'downloading', 'verifying', 'extracting', 'validating', 'installing', 'activating', 'completed',
    ])
    // The catalog supplies the total even when HTTP has no Content-Length.
    expect(progress[1]).toMatchObject({ appId: 'example.app', version: '1.2.0', receivedBytes: 5, totalBytes: archive.length })
    expect(progress.at(-1)).toMatchObject({ phase: 'completed', source: 'marketplace', receivedBytes: archive.length })
  })

  it('installs a compatible update without loading an incompatible active package', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-incompatible-update-'))
    roots.push(root)
    const archive = Buffer.from('host api 2 update')
    const latest = version(archive, '2.0.0')
    const responses = new Map([
      ['https://example.com/index.json', Buffer.from(JSON.stringify(catalog(latest)))],
      ['https://example.com/example.app.json', Buffer.from(JSON.stringify(detail(latest)))],
      [latest.artifact.downloadUrl, archive],
    ])
    const registered: string[] = []
    const runtime = {
      getInstallation: () => ({ activeVersion: '1.3.0', grants: ['agent:turns:write'] }),
      getApp: async () => { throw new Error('App requires Host API ^1.3.0; this Host provides 2.0.0') },
      registerInstalled: async (_appId: string, installedVersion: string) => { registered.push(installedVersion) },
    }
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json',
      cachePath: path.join(root, 'catalog.json'),
      platform: 'darwin-arm64',
      trustedPublishers: { moss: { keys: { 'release-1': 'public key' } } },
      getInstalledApps: async () => [{ id: 'example.app', currentVersion: '1.3.0', packageStatus: 'incompatible' }],
      getRuntime: () => runtime,
      download: async (url: string) => {
        const response = responses.get(url)
        if (!response) throw new Error(`Unexpected URL: ${url}`)
        return response
      },
      installArchive: async (_runtime: unknown, _archivePath: string, options: { installPackage: (root: string) => Promise<unknown> }) => {
        return options.installPackage('/verified-package')
      },
      validatePackage: async () => ({
        manifest: { id: 'example.app', version: '2.0.0' },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }),
      installPackage: async () => ({ id: 'example.app', currentVersion: '2.0.0' }),
    })

    expect((await service.list({ forceRefresh: true })).apps[0]).toMatchObject({
      installedVersion: '1.3.0',
      updateAvailable: true,
    })
    expect(await service.install({ appId: 'example.app' })).toMatchObject({ ok: true, version: '2.0.0' })
    expect(registered).toEqual(['2.0.0'])
  })

  it('drops permissions removed by a newer marketplace version', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-permissions-'))
    roots.push(root)
    const archive = Buffer.from('signed permission update')
    const latest = {
      ...version(archive),
      permissions: ['agent:turns:write', 'account:identity:read'],
    }
    const responses = new Map([
      ['https://example.com/index.json', Buffer.from(JSON.stringify(catalog(latest)))],
      ['https://example.com/example.app.json', Buffer.from(JSON.stringify(detail(latest)))],
      [latest.artifact.downloadUrl, archive],
    ])
    const calls: Array<{ version: string; grants: string[] }> = []
    const runtime = {
      getInstallation: () => ({
        activeVersion: '1.1.0',
        grants: ['agent:turns:write', 'platform:files'],
      }),
      registerInstalled: async (_appId: string, installedVersion: string, options: { grants: string[] }) => {
        calls.push({ version: installedVersion, grants: options.grants })
      },
    }
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json',
      cachePath: path.join(root, 'catalog.json'),
      platform: 'darwin-arm64',
      trustedPublishers: { moss: { keys: { 'release-1': 'public key' } } },
      getInstalledApps: async () => [{ id: 'example.app', currentVersion: '1.1.0' }],
      getRuntime: () => runtime,
      download: async (url: string) => {
        const response = responses.get(url)
        if (!response) throw new Error(`Unexpected URL: ${url}`)
        return response
      },
      installArchive: async (_runtime: unknown, _archivePath: string, options: { installPackage: (root: string) => Promise<unknown> }) => {
        return options.installPackage('/verified-package')
      },
      validatePackage: async () => ({
        manifest: { id: 'example.app', version: '1.2.0' },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }),
      installPackage: async () => ({ id: 'example.app', currentVersion: '1.2.0' }),
    })

    expect(await service.install({ appId: 'example.app' })).toMatchObject({
      requiresPermissionApproval: true,
      permissions: ['account:identity:read'],
    })
    await service.install({ appId: 'example.app', acceptPermissions: true })

    expect(calls).toEqual([{
      version: '1.2.0',
      grants: ['agent:turns:write', 'account:identity:read'],
    }])
  })

  it('refreshes stale App details when the catalog advertises a newer version', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-version-sync-'))
    roots.push(root)
    const oldArchive = Buffer.from('old signed zip bytes')
    const newArchive = Buffer.from('new signed zip bytes')
    const oldVersion = version(oldArchive, '1.2.0')
    const newVersion = version(newArchive, '1.3.0')
    let activeVersion = oldVersion
    let plainDetailIsStale = false
    const detailRequests: string[] = []
    const registered: string[] = []
    const runtime = {
      getInstallation: () => ({ activeVersion: '1.2.0', grants: ['agent:turns:write'] }),
      registerInstalled: async (_appId: string, installedVersion: string) => { registered.push(installedVersion) },
    }
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json',
      cachePath: path.join(root, 'catalog.json'),
      platform: 'darwin-arm64',
      trustedPublishers: { moss: { keys: { 'release-1': 'public key' } } },
      getInstalledApps: async () => [{ id: 'example.app', currentVersion: '1.2.0' }],
      getRuntime: () => runtime,
      download: async (url: string) => {
        if (url === 'https://example.com/index.json') return Buffer.from(JSON.stringify(catalog(activeVersion)))
        if (url.startsWith('https://example.com/example.app.json')) {
          detailRequests.push(url)
          const requestedFreshVersion = new URL(url).searchParams.get('_moss_version')
          const responseVersion = plainDetailIsStale && !requestedFreshVersion ? oldVersion : activeVersion
          return Buffer.from(JSON.stringify(detail(responseVersion)))
        }
        if (url === newVersion.artifact.downloadUrl) return newArchive
        throw new Error(`Unexpected URL: ${url}`)
      },
      installArchive: async (_runtime: unknown, _archivePath: string, options: { installPackage: (root: string) => Promise<unknown> }) => {
        return options.installPackage('/verified-package')
      },
      validatePackage: async () => ({
        manifest: { id: 'example.app', version: '1.3.0' },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }),
      installPackage: async () => ({ id: 'example.app', currentVersion: '1.3.0' }),
    })

    await service.list({ forceRefresh: true })
    expect((await service.getDetails('example.app')).latestVersion).toBe('1.2.0')

    activeVersion = newVersion
    plainDetailIsStale = true
    await service.list({ forceRefresh: true })
    expect(await service.install({ appId: 'example.app', version: '1.3.0' })).toMatchObject({ ok: true, version: '1.3.0' })
    expect(registered).toEqual(['1.3.0'])
    expect(detailRequests.at(-1)).toContain('_moss_version=1.3.0')
  })

  it('falls back to a previously cached catalog when refresh fails', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-cache-'))
    roots.push(root)
    const latest = version(Buffer.from('app'))
    let online = true
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json',
      cachePath: path.join(root, 'catalog.json'),
      platform: 'win32-x64',
      getInstalledApps: async () => [],
      getRuntime: () => ({}),
      installPackage: async () => ({}),
      download: async () => {
        if (!online) throw new Error('offline')
        return Buffer.from(JSON.stringify(catalog(latest)))
      },
    })
    await service.list({ forceRefresh: true })
    online = false
    const cached = await service.list({ forceRefresh: true })
    expect(cached.cached).toBe(true)
    expect(cached.warning).toContain('正在显示缓存')
  })
})
