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
  { response, acceptPermissions: true, permissions: ['agent:turns:write'], tools: [] },
]))('confirms verified marketplace tools even with no pending permissions (%o)', async ({ response, acceptPermissions, permissions, tools = [{ id: 'lookup', title: '查询记录', description: '搜索应用记录', effect: 'read' }] }) => {
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
        manifest: { id: 'example.app', version: latest.version, displayName: 'Example', permissions, contributes: { tools } },
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
  if (tools.length) { expect(prompts[0].detail).toContain('查询记录（lookup） · 只读'); expect(prompts[0].detail).toContain('搜索应用记录') }
  expect(prompts[0].detail.includes('agent:turns:write')).toBe(permissions.length > 0)
  expect(installs).toBe(response)
  expect(registrations).toBe(response)
  expect(result.ok).toBe(response === 1)
  expect(progress.at(-1).phase).toBe(response ? 'completed' : 'canceled')
  if (!response) expect(result.canceled).toBe(true)
})

it.each([
  {
    change: 'adding a protocol', previousManifest: {},
    nextCapabilities: { requires: [{ protocol: 'moss.dataset/v1' }] },
    expectedDetail: 'moss.dataset/v1', expectedPreviousDetail: '',
  },
  {
    change: 'removing the final protocol',
    previousManifest: { appCapabilities: { requires: [{ protocol: 'moss.dataset/v1' }] } },
    nextCapabilities: null, expectedDetail: '原版本的跨 App 能力声明', expectedPreviousDetail: 'moss.dataset/v1',
  },
  {
    change: 'keeping target tool access',
    previousManifest: { appCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['execute_sql'] }] } },
    nextCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['execute_sql'] }] },
    expectedDetail: 'execute_sql', expectedPreviousDetail: '',
  },
  {
    change: 'adding target tool access',
    previousManifest: { appCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['search_objects'] }] } },
    nextCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['search_objects', 'execute_sql'] }] },
    expectedDetail: 'execute_sql', expectedPreviousDetail: 'search_objects',
  },
  {
    change: 'removing target tool access',
    previousManifest: { appCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['execute_sql'] }] } },
    nextCapabilities: null,
    expectedDetail: '原版本的跨 App 能力声明', expectedPreviousDetail: 'execute_sql',
  },
  {
    change: 'replacing an unreadable package', previousManifest: null,
    nextCapabilities: null, expectedDetail: '无法读取原版本的跨 App 能力声明', expectedPreviousDetail: '',
  },
])('reviews cross-App declarations when $change with an existing grant', async ({ previousManifest, nextCapabilities, expectedDetail, expectedPreviousDetail }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-market-capabilities-'))
  roots.push(root)
  const archive = Buffer.from('verified cross-App package')
  const latest = { ...version(archive), permissions: ['apps:invoke'] }
  const responses = new Map([
    ['https://example.com/index.json', Buffer.from(JSON.stringify(catalog(latest)))],
    ['https://example.com/example.app.json', Buffer.from(JSON.stringify(detail(latest)))],
    [latest.artifact.downloadUrl, archive],
  ])
  const prompts: any[] = []
  let installs = 0
  const service = createAppMarketplaceService({
    indexUrl: 'https://example.com/index.json', cachePath: path.join(root, 'catalog.json'), platform: 'darwin-arm64',
    getInstalledApps: async () => [{ id: 'example.app', currentVersion: '1.1.0', manifest: previousManifest }],
    getRuntime: () => ({ getInstallation: () => ({ activeVersion: '1.1.0', grants: ['apps:invoke'] }), registerInstalled: async () => {} }),
    download: async (url: string) => responses.get(url),
    installArchive: async (_runtime: unknown, _archive: string, options: any) => options.installPackage('/verified-package'),
    validatePackage: async () => ({
      manifest: { id: 'example.app', version: latest.version, displayName: 'Example', permissions: ['apps:invoke'],
        ...(nextCapabilities ? { appCapabilities: nextCapabilities } : {}) },
      trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
    }),
    confirmInstallation: (manifest: any, permissions: string[], details: string) => confirmAppInstallation({
      showMessageBox: async (prompt: any) => { prompts.push(prompt); return { response: 0 } },
    }, manifest, permissions, details),
    installPackage: async () => { installs++; return { id: 'example.app' } },
  })
  const result = await service.install({ appId: 'example.app', acceptPermissions: true })
  expect(result).toMatchObject({ ok: false, canceled: true })
  expect(prompts).toHaveLength(1)
  expect(prompts[0].detail).toContain(expectedDetail)
  if (expectedPreviousDetail) expect(prompts[0].detail).toContain(expectedPreviousDetail)
  if (nextCapabilities?.usesTools?.length) {
    expect(prompts[0].detail).toContain('moss.database')
    expect(prompts[0].detail).toContain('可能读取或修改目标 App 可访问的数据')
  }
  expect(installs).toBe(0)
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
    revision: 7,
    installs: [] as any[], registrations: [] as any[], rollbacks: [] as any[], prompts: [] as any[], progress: [] as any[],
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
    getInstallationRevision: () => state.revision,
    getRuntime: () => ({
      getInstallation: () => ({ activeVersion: localVersion, grants: [] }),
      registerInstalled: async (...args: any[]) => { state.registrations.push(args) },
    }),
    emitProgress: (value: any) => { state.progress.push(value) },
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
    installPackage: async (_root: string, options: any) => {
      state.installs.push(options)
      state.revision += 1
      state.entry = { ...state.entry, currentVersion: latest.version, localModification: null }
      options.onCommit?.({ installationRevision: state.revision })
      return { id: 'example.app' }
    },
    rollbackPackage: async (options: any) => { state.rollbacks.push(options); return true },
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

it('does not roll back a package failure before this install commits', async () => {
  let attempts = 0
  const { service, state } = await localVersionFixture({
    installPackage: async () => { attempts += 1; throw new Error('staging failed') },
  })
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('staging failed')
  expect(attempts).toBe(1)
  expect(state.entry.currentVersion).toBe('1.2.0-local.20261012')
  expect(state.revision).toBe(7)
  expect(state.rollbacks).toHaveLength(0)
  expect(state.progress.at(-1).phase).toBe('error')
  expect(state.progress.some(value => value.phase === 'rolling-back')).toBe(false)
})

it.each([
  { change: 'revision', currentRevision: 9, currentVersion: '1.2.0' },
  { change: 'version', currentRevision: 8, currentVersion: '1.3.0' },
])('does not roll back a concurrent $change after this install commits', async ({ currentRevision, currentVersion }) => {
  let fixtureState: any
  const { service, state } = await localVersionFixture({
    installPackage: async (_root: string, options: any) => {
      fixtureState.revision = 8
      fixtureState.entry = { ...fixtureState.entry, currentVersion: '1.2.0', localModification: null }
      options.onCommit({ installationRevision: 8 })
      fixtureState.revision = currentRevision
      fixtureState.entry = { ...fixtureState.entry, currentVersion }
      throw new Error('failure after a concurrent install')
    },
  })
  fixtureState = state
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('failure after a concurrent install')
  expect(state.entry.currentVersion).toBe(currentVersion)
  expect(state.revision).toBe(currentRevision)
  expect(state.rollbacks).toHaveLength(0)
  expect(state.progress.at(-1).phase).toBe('error')
  expect(state.progress.some(value => value.phase === 'rolling-back')).toBe(false)
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
  expect(state.rollbacks).toEqual([{ appId: 'example.app', previousVersion: localVersion, failedVersion: '1.2.0', expectedInstallationRevision: 8 }])
  expect(state.progress.some(value => value.phase === 'rolling-back')).toBe(true)
})

it('does not restore Runtime after a newer install commits before the Runtime lock', async () => {
  let fixtureState: any
  let runtimeVersion = '1.2.0-local.20261012'
  let runtimeRestores = 0
  const changed: any[] = []
  const { service, state } = await localVersionFixture({
    getRuntime: () => ({
      getInstallation: () => ({ activeVersion: runtimeVersion, grants: [] }),
      registerInstalled: async () => { runtimeVersion = '1.2.0'; throw new Error('activation failed') },
      registerInstalledNow: async () => { runtimeRestores += 1 },
      transitionApp: async (_appId: string, operation: () => Promise<unknown>) => {
        fixtureState.revision = 10
        fixtureState.entry = { ...fixtureState.entry, currentVersion: '1.3.0' }
        runtimeVersion = '1.3.0'
        return operation()
      },
    }),
    rollbackPackage: async (input: any) => {
      fixtureState.rollbacks.push(input)
      fixtureState.revision = 9
      fixtureState.entry = { ...fixtureState.entry, currentVersion: '1.2.0-local.20261012' }
      return true
    },
    emitChanged: async (value: any) => { changed.push(value) },
  })
  fixtureState = state
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('activation failed')
  expect(state.rollbacks).toHaveLength(1)
  expect(state.entry.currentVersion).toBe('1.3.0')
  expect(state.revision).toBe(10)
  expect(runtimeVersion).toBe('1.3.0')
  expect(runtimeRestores).toBe(0)
  expect(changed).toHaveLength(0)
})

it('lets Runtime filter edited grants against the restored version', async () => {
  let fixtureState: any
  let runtimeVersion = '1.2.0-local.20261012'
  let runtimeGrants = ['apps:invoke']
  const restoreCalls: any[] = []
  const { service, state, localVersion } = await localVersionFixture({
    getRuntime: () => ({
      getInstallation: () => ({ activeVersion: runtimeVersion, grants: runtimeGrants }),
      registerInstalled: async () => {
        runtimeVersion = '1.2.0'
        runtimeGrants = ['agent:catalog:read']
        throw new Error('activation failed')
      },
      registerInstalledNow: async (_appId: string, version: string, options: any) => {
        restoreCalls.push({ version, options })
        runtimeVersion = version
      },
      transitionApp: async (_appId: string, operation: () => Promise<unknown>) => operation(),
    }),
    rollbackPackage: async (input: any) => {
      fixtureState.rollbacks.push(input)
      fixtureState.revision = 9
      fixtureState.entry = { ...fixtureState.entry, currentVersion: localVersion }
      return true
    },
  })
  fixtureState = state
  await expect(service.install({ appId: 'example.app' })).rejects.toThrow('activation failed')
  expect(restoreCalls).toEqual([{ version: localVersion, options: {} }])
  expect(runtimeVersion).toBe(localVersion)
})

describe('App marketplace', () => {
  it('filters listings by Host OS and architecture without losing entries from the catalog cache', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-market-platform-'))
    roots.push(root)
    const base = catalog(version(Buffer.from('app')))
    const entry = (id: string, platforms: string[], hostApi = '^3.0.0') => ({
      ...base.apps[0], id, latest: { ...base.apps[0].latest, platforms, hostApi },
    })
    const index = { ...base, apps: [
      entry('mac.app', ['darwin-arm64']),
      entry('linux.app', ['linux-x64']),
      entry('arm.app', ['linux-arm64']),
      entry('future.app', ['linux-x64'], '>=99.0.0'),
    ] }
    const options = {
      indexUrl: 'https://example.com/index.json', cachePath: path.join(root, 'catalog.json'),
      getInstalledApps: async () => [{ id: 'mac.app', currentVersion: '1.2.0' }],
      download: async () => Buffer.from(JSON.stringify(index)),
    }
    const linux = createAppMarketplaceService({ ...options, platform: 'linux-x64' })
    for (const listing of [await linux.list(), await linux.list()]) {
      expect(listing.platform).toBe('linux-x64')
      expect(listing.apps.map(app => app.id)).toEqual(['linux.app', 'future.app'])
      expect(listing.apps[1].hostCompatible).toBe(false)
    }
    const cached = JSON.parse(await fs.readFile(options.cachePath, 'utf8'))
    expect(cached.index.apps).toHaveLength(4)
    const mac = createAppMarketplaceService({ ...options, platform: 'darwin-arm64' })
    expect((await mac.list()).apps.map(app => app.id)).toEqual(['mac.app'])
    await expect(linux.install({ appId: 'mac.app' })).rejects.toThrow()
  })

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

  it('restores distinct registry and Runtime versions when activating an update fails', async () => {
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
    const recoveryOrder: string[] = []
    let currentVersion = '1.1.0'
    let runtimeVersion = '1.0.0'
    let runtimeGrants = ['agent:turns:write', 'platform:files']
    let revision = 7
    const runtime = {
      getInstallation: () => ({ activeVersion: runtimeVersion, grants: runtimeGrants }),
      registerInstalled: async (_appId: string, _version: string, options: { grants: string[] }) => {
        runtimeVersion = '1.2.0'; runtimeGrants = options.grants
        throw new Error('backend did not start')
      },
      registerInstalledNow: async (_appId: string, version: string, options: { grants: string[] }) => {
        runtimeVersion = version; runtimeGrants = options.grants
      },
      transitionApp: async (_appId: string, operation: () => Promise<unknown>) => {
        recoveryOrder.push('runtime-lock')
        return operation()
      },
    }
    const service = createAppMarketplaceService({
      indexUrl: 'https://example.com/index.json',
      cachePath: path.join(root, 'catalog.json'),
      platform: 'darwin-arm64',
      trustedPublishers: { moss: { keys: { 'release-1': 'public key' } } },
      getInstalledApps: async () => [{ id: 'example.app', currentVersion, manifest: {} }],
      getInstallationRevision: () => revision,
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
        manifest: { id: 'example.app', version: '1.2.0', permissions: latest.permissions },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }),
      installPackage: async (_root: string, options: any) => {
        currentVersion = '1.2.0'
        revision = 8
        options.onCommit({ installationRevision: revision })
        return { id: 'example.app', currentVersion }
      },
      rollbackPackage: async (input: any) => {
        recoveryOrder.push('package-rollback')
        rollbacks.push(input); currentVersion = input.previousVersion; revision = 9; return true
      },
      emitProgress: (value: unknown) => progress.push(value),
    })

    await expect(service.install({ appId: 'example.app' })).rejects.toThrow('backend did not start')
    expect(rollbacks).toEqual([{
      appId: 'example.app',
      previousVersion: '1.1.0',
      failedVersion: '1.2.0',
      expectedInstallationRevision: 8,
    }])
    expect(progress.slice(-3).map((value) => value.phase)).toEqual(['activating', 'rolling-back', 'error'])
    expect(progress.at(-1).error).toBe('backend did not start')
    expect(progress.some((value) => value.phase === 'completed')).toBe(false)
    expect(currentVersion).toBe('1.1.0')
    expect(runtimeVersion).toBe('1.0.0')
    expect(runtimeGrants).toEqual(['agent:turns:write', 'platform:files'])
    expect(recoveryOrder).toEqual(['package-rollback', 'runtime-lock'])
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
    const changes: any[] = []
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
      emitChanged: async (value: any) => { changes.push(value) },
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
        manifest: { id: 'example.app', version: '1.2.0', permissions: latest.permissions },
        trust: { status: 'trusted', publisherId: 'moss', keyId: 'release-1' },
      }),
      installPackage: async (_root: string, options: any) => {
        const app = { id: 'example.app', name: 'example.app', currentVersion: '1.2.0' }
        await options.activateInstallation(app)
        return app
      },
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
    expect(changes).toEqual([
      { action: 'install', app: { id: 'example.app', name: 'example.app', currentVersion: '1.2.0' }, grants: ['agent:turns:write'] },
      { action: 'marketplace-installed', appId: 'example.app' },
    ])
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
    let confirmations = 0
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
      confirmInstallation: async () => { confirmations += 1; return true },
      download: async (url: string) => {
        const response = responses.get(url)
        if (!response) throw new Error(`Unexpected URL: ${url}`)
        return response
      },
      installArchive: async (_runtime: unknown, _archivePath: string, options: { installPackage: (root: string) => Promise<unknown> }) => {
        return options.installPackage('/verified-package')
      },
      validatePackage: async () => ({
        manifest: { id: 'example.app', version: '2.0.0', permissions: latest.permissions },
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
    expect(confirmations).toBe(1)
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
      getInstalledApps: async () => [{ id: 'example.app', currentVersion: '1.1.0', manifest: {} }],
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
        manifest: { id: 'example.app', version: '1.2.0', permissions: latest.permissions },
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
      getInstalledApps: async () => [{ id: 'example.app', currentVersion: '1.2.0', manifest: {} }],
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
        manifest: { id: 'example.app', version: '1.3.0', permissions: newVersion.permissions },
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
      return { manifest: { id: 'example.app', version: latest.version, platforms: [declaredPlatform], permissions: latest.permissions }, trust: { publisherId: 'moss', keyId: 'release-1' } }
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
