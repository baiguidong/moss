import { afterEach, describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { confirmAppInstallation } from '../src/apps/app-tool-disclosure.mjs'
import {
  createAppMarketplaceService,
  normalizeMarketplaceIndex,
  normalizeMarketplaceDetail,
} from '../src/apps/app-marketplace.mjs'

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))))

it.each([0, 1].flatMap(response => [
  { response, acceptPermissions: false, permissions: ['agent:turns:write'] },
  { response, acceptPermissions: true, permissions: ['agent:turns:write'] },
  { response, acceptPermissions: false, permissions: [] },
]))('confirms verified marketplace tools even with no pending permissions (%o)', async ({ response, acceptPermissions, permissions }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-market-tools-'))
  roots.push(root)
  const archive = Buffer.from('verified package with tools')
  const latest = { ...version(archive), permissions }
  const responses = new Map([
    ['https://example.com/index.json', Buffer.from(JSON.stringify(catalog(latest)))],
    ['https://example.com/example.app.json', Buffer.from(JSON.stringify(detail(latest)))],
    [latest.artifact.downloadUrl, archive],
  ])
  let validated = false
  let installs = 0
  let registrations = 0
  const prompts: any[] = []
  const progress: any[] = []
  const service = createAppMarketplaceService({
    indexUrl: 'https://example.com/index.json', cachePath: path.join(root, 'catalog.json'), platform: 'darwin-arm64',
    getInstalledApps: async () => [],
    getRuntime: () => ({ getInstallation: () => null, registerInstalled: async () => { registrations++ } }),
    download: async (url: string) => responses.get(url),
    emitProgress: (value: any) => progress.push(value),
    installArchive: async (_runtime: unknown, _archive: string, options: any) => options.installPackage('/verified-package'),
    validatePackage: async () => {
      validated = true
      return {
        manifest: { id: 'example.app', version: latest.version, displayName: 'Example', permissions, contributes: { tools: [{ id: 'lookup', title: '查询记录', description: '搜索应用记录', effect: 'read' }] } },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }
    },
    confirmInstallation: async (manifest: any, permissions: string[]) => {
      expect(validated).toBe(true)
      expect(installs).toBe(0)
      expect(registrations).toBe(0)
      return confirmAppInstallation({ showMessageBox: async (prompt: any) => { prompts.push(prompt); return { response } } }, manifest, permissions)
    },
    installPackage: async () => { installs++; return { id: 'example.app', currentVersion: latest.version } },
  })
  const result = await service.install({ appId: 'example.app', acceptPermissions })
  expect(prompts).toHaveLength(1)
  expect(prompts[0].detail).toContain('查询记录（lookup） · 只读')
  expect(prompts[0].detail).toContain('搜索应用记录')
  expect(prompts[0].detail.includes('agent:turns:write')).toBe(permissions.length > 0 && !acceptPermissions)
  expect(installs).toBe(response)
  expect(registrations).toBe(response)
  expect(result.ok).toBe(response === 1)
  expect(progress.at(-1).phase).toBe(response ? 'completed' : 'canceled')
  if (!response) expect(result.canceled).toBe(true)
})

function version(archive: Buffer, versionNumber = '1.2.0') {
  return {
    version: versionNumber,
    hostApi: '^3.0.0',
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

async function localVersionFixture(overrides: Record<string, any> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-market-local-'))
  roots.push(root)
  const archive = Buffer.from('signed market replacement')
  const latest = { ...version(archive), permissions: [] }
  const localVersion = '1.2.0-local.20261012'
  const state = {
    entry: { id: 'example.app', currentVersion: localVersion, localModification: { sourceHash: 'local-source' } } as any,
    installs: [] as any[], registrations: [] as any[], rollbacks: [] as any[], prompts: [] as any[],
    validated: false,
  }
  const responses = new Map([
    ['https://example.com/index.json', Buffer.from(JSON.stringify(catalog(latest)))],
    ['https://example.com/example.app.json', Buffer.from(JSON.stringify(detail(latest)))],
    [latest.artifact.downloadUrl, archive],
  ])
  const service = createAppMarketplaceService({
    indexUrl: 'https://example.com/index.json', cachePath: path.join(root, 'catalog.json'), platform: 'darwin-arm64',
    getInstalledApps: async () => state.entry ? [state.entry] : [],
    getInstallationRevision: () => 7,
    getRuntime: () => ({
      getInstallation: () => ({ activeVersion: localVersion, grants: [] }),
      registerInstalled: async (...args: any[]) => { state.registrations.push(args) },
    }),
    download: async (url: string) => responses.get(url),
    installArchive: async (_runtime: unknown, _archive: string, options: any) => options.installPackage('/verified-package'),
    validatePackage: async () => {
      state.validated = true
      return {
        manifest: { id: 'example.app', version: latest.version, displayName: 'Example', permissions: [] },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }
    },
    confirmInstallation: async (...args: any[]) => { state.prompts.push(args); return true },
    installPackage: async (_root: string, options: any) => { state.installs.push(options); return { id: 'example.app' } },
    rollbackPackage: async (options: any) => { state.rollbacks.push(options) },
    ...overrides,
  })
  return { service, state, localVersion }
}

it.each([0, 1].flatMap(response => [false, true].map(acceptPermissions => ({ response, acceptPermissions }))))(
  'confirms a local replacement after verification even without tools or new permissions (%o)',
  async ({ response, acceptPermissions }) => {
    const { service, state, localVersion } = await localVersionFixture({
      confirmInstallation: async (manifest: any, permissions: string[], details: string) => {
        expect(state.validated).toBe(true)
        expect(state.installs).toHaveLength(0)
        return confirmAppInstallation({ showMessageBox: async (prompt: any) => { state.prompts.push(prompt); return { response } } }, manifest, permissions, details)
      },
    })
    expect((await service.list()).apps[0].localModification).toBe(true)
    const result = await service.install({ appId: 'example.app', acceptPermissions })
    expect(result.ok).toBe(response === 1)
    expect(state.prompts).toHaveLength(1)
    expect(state.prompts[0].detail).toContain(localVersion)
    expect(state.prompts[0].detail).toContain('源码会保留在版本历史')
    expect(state.installs).toHaveLength(response)
    expect(state.registrations).toHaveLength(response)
    expect(state.rollbacks).toHaveLength(0)
    if (response) expect(state.installs[0]).toMatchObject({
      marketplaceSource: { appId: 'example.app', version: '1.2.0' },
      expectedInstallationRevision: 7, expectedBaseVersion: localVersion,
    })
    else expect(result.canceled).toBe(true)
  },
)

it('keeps local versions protected when there is no host confirmation', async () => {
  const { service, state } = await localVersionFixture({ confirmInstallation: undefined })
  await expect(service.install({ appId: 'example.app', acceptPermissions: true })).rejects.toThrow('需要确认')
  expect(state.validated).toBe(false)
  expect(state.installs).toHaveLength(0)
})

it('does not report a conflicting local version as already installed', async () => {
  const { service, state } = await localVersionFixture({
    getRuntime: () => ({ getInstallation: () => ({ activeVersion: '1.2.0', grants: [] }) }),
  })
  state.entry.currentVersion = '1.2.0'
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('版本号冲突')
  expect(state.prompts).toHaveLength(0)
  expect(state.installs).toHaveLength(0)
})

it.each(['download', 'confirmation'])('requires a fresh confirmation if the local version changes during %s', async phase => {
  const { service, state } = await localVersionFixture({
    confirmInstallation: async () => {
      state.prompts.push(true)
      if (phase === 'confirmation') state.entry = { ...state.entry, currentVersion: '1.3.0-local.1' }
      return true
    },
    installArchive: async (_runtime: unknown, _archive: string, options: any) => {
      if (phase === 'download') state.entry = { ...state.entry, currentVersion: '1.3.0-local.1' }
      return options.installPackage('/verified-package')
    },
  })
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('安装状态已变化')
  expect(state.prompts).toHaveLength(phase === 'download' ? 0 : 1)
  expect(state.installs).toHaveLength(0)
  expect(state.rollbacks).toHaveLength(0)
})

it('does not roll back a concurrent installation when the commit guard rejects the replacement', async () => {
  const { service, state } = await localVersionFixture({
    installPackage: async () => { throw Object.assign(new Error('App installation changed before commit'), { code: 'MOSS_APP_INSTALLATION_CHANGED' }) },
  })
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('changed before commit')
  expect(state.rollbacks).toHaveLength(0)
  expect(state.registrations).toHaveLength(0)
})

it('restores the local version when activating the marketplace replacement fails', async () => {
  const { service, state, localVersion } = await localVersionFixture({
    getRuntime: () => ({
      getInstallation: () => ({ activeVersion: '1.2.0-local.20261012', grants: [] }),
      registerInstalled: async () => { throw new Error('activation failed') },
    }),
  })
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('activation failed')
  expect(state.installs).toHaveLength(1)
  expect(state.rollbacks).toEqual([{ appId: 'example.app', previousVersion: localVersion, failedVersion: '1.2.0' }])
})

describe('App marketplace', () => {
  it('retains primary category and searchable keywords, with other as the legacy and future fallback', () => {
    const release = version(Buffer.from('app'));
    const index = catalog(release);
    const apps = [
      { ...index.apps[0], category: 'automation', keywords: ['Chrome', '网页'] },
      { ...index.apps[0], id: 'legacy.app' },
      { ...index.apps[0], id: 'future.app', category: 'future' },
    ];
    const normalized = normalizeMarketplaceIndex({ ...index, apps }, 'https://example.com/index.json');
    expect(normalized.apps.map(app => app.category)).toEqual(['automation', 'other', 'other']);
    expect(normalized.apps[0].keywords).toEqual(['Chrome', '网页']);
    expect(normalizeMarketplaceDetail({ ...detail(release), category: 'automation' }, 'https://example.com/example.app.json', 'example.app').category).toBe('automation');
  })

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
    const fresh = await service.list({ forceRefresh: true })
    online = false
    const cached = await service.list({ forceRefresh: true })
    expect(cached.cached).toBe(true)
    expect(cached.warning).toContain('正在显示缓存')
    expect(cached.warning).toContain('offline')
    expect(cached.fetchedAt).toBe(fresh.fetchedAt)
    online = true
    expect(await service.list({ forceRefresh: true })).toMatchObject({ cached: false, warning: '' })
  })

  it('reports a failed refresh when no cached catalog is available', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-offline-'))
    roots.push(root)
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json', cachePath: path.join(root, 'catalog.json'),
      getInstalledApps: async () => [],
      download: async () => { throw new Error('ECONNRESET') },
    })
    await expect(service.list({ forceRefresh: true })).rejects.toThrow('应用市场请求失败：ECONNRESET')
  })

  it('aborts a stuck catalog request and exposes the timeout instead of waiting indefinitely', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-market-timeout-'))
    roots.push(root)
    let signal: AbortSignal | undefined
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json', cachePath: path.join(root, 'catalog.json'),
      requestTimeoutMs: 20, getInstalledApps: async () => [],
      download: async (_url: string, options: { signal: AbortSignal }) => {
        signal = options.signal
        return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }))
      },
    })
    await expect(service.list({ forceRefresh: true })).rejects.toThrow('应用市场请求超时')
    expect(signal?.aborted).toBe(true)
  }, 2000)
})

it.each(['darwin-arm64', 'win32-x64'])('downloads only the matching signed variant on %s and rejects a mislabeled package', async platform => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-market-variants-')); roots.push(root)
  const mac = Buffer.from('mac package'), windows = Buffer.from('windows package')
  const macArtifact = { ...version(mac).artifact, fileName: 'mac.zip', downloadUrl: 'https://example.com/mac.zip' }
  const winArtifact = { ...version(windows).artifact, fileName: 'windows.zip', downloadUrl: 'https://example.com/windows.zip' }
  const { artifact: _, ...base } = version(mac)
  const latest: any = { ...base, hostApi: '^3.3.0', artifacts: { 'darwin-arm64': macArtifact, 'win32-x64': winArtifact } }
  const downloaded: string[] = []
  let installs = 0, declaredPlatform = platform
  const service = createAppMarketplaceService({ indexUrl: 'https://example.com/index.json', cachePath: path.join(root, 'cache.json'), platform,
    getInstalledApps: async () => [], getRuntime: () => ({ getInstallation: () => null, registerInstalled: async () => {} }),
    download: async (url: string) => {
      if (url.endsWith('index.json')) return Buffer.from(JSON.stringify(catalog(latest)))
      if (url.endsWith('example.app.json')) return Buffer.from(JSON.stringify(detail(latest)))
      downloaded.push(url); return url.endsWith('/mac.zip') ? mac : windows
    },
    installArchive: async (_r: any, _a: any, options: any) => options.installPackage(root),
    validatePackage: async (_root: string, options: any) => {
      expect(options.platform).toBe(platform)
      return { manifest: { id: 'example.app', version: latest.version, platforms: [declaredPlatform], permissions: [] }, trust: { publisherId: 'moss', keyId: 'release-1' } }
    },
    installPackage: async () => { installs++; return {} },
  })
  const selected = (await service.getDetails('example.app')).versions[0]
  expect(selected.artifact.fileName).toBe(platform === 'win32-x64' ? 'windows.zip' : 'mac.zip')
  await service.install({ appId: 'example.app', acceptPermissions: true })
  expect(downloaded).toEqual([latest.artifacts[platform].downloadUrl]); expect(installs).toBe(1)
  declaredPlatform = platform === 'win32-x64' ? 'darwin-arm64' : 'win32-x64'
  await expect(service.install({ appId: 'example.app', acceptPermissions: true })).rejects.toThrow('platform mismatch')
  expect(installs).toBe(1)
})

it('rejects incomplete or ambiguous artifact maps instead of falling back to a different platform', () => {
  const { artifact, ...base } = version(Buffer.from('package'))
  for (const latest of [
    { ...base, artifacts: { 'darwin-arm64': artifact } },
    { ...base, hostApi: '^3.3.0', artifacts: { 'darwin-arm64': artifact }, artifact },
    { ...base, artifacts: { 'darwin-arm64': artifact, 'linux-x64': artifact } },
  ]) expect(() => normalizeMarketplaceIndex(catalog(latest as any), 'https://example.com/index.json')).toThrow()
})

it('reads a catalog with a legacy artifact field while exclusively selecting the platform map', () => {
  const { artifact, ...base } = version(Buffer.from('package'))
  const latest: any = { ...base, hostApi: '^3.3.0', artifact, artifacts: { 'darwin-arm64': artifact, 'win32-x64': { ...artifact, fileName: 'windows.zip' } } }
  const normalized = normalizeMarketplaceIndex(catalog(latest), 'https://example.com/index.json').apps[0].latest
  expect(normalized.artifact).toBeUndefined()
  expect(normalized.artifacts['win32-x64'].fileName).toBe('windows.zip')
})
