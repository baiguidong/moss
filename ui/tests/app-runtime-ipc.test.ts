import { describe, expect, it } from 'bun:test'
import { registerAppRuntimeIpc } from '../src/apps/app-runtime-ipc.mjs'

function createFixture({ response = 1, currentGrants = [] as string[], activationError = '', permissions = ['platform:files', 'agent:turns:write'], tools = [] as any[], appCapabilities = undefined as any, previousManifest = null as any, installedVersion = '' } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const registrations: Array<{ appId: string; version: string; options: { grants: string[] } }> = []
  const changes: any[] = []
  const prompts: any[] = []
  const progress: any[] = []
  let packageInstallCount = 0
  const runtime = {
    getApp: async () => previousManifest ? { manifest: previousManifest } : null,
    installations: {
      list: () => currentGrants.length ? [{ appId: 'example.app', grants: currentGrants }] : [],
    },
    registerInstalled: async (appId: string, version: string, options: { grants: string[] }) => {
      if (activationError) throw new Error(activationError)
      registrations.push({ appId, version, options })
    },
  }
  registerAppRuntimeIpc({
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/example.app.zip'] }),
      showMessageBox: async (options: any) => {
        prompts.push(options)
        return { response }
      },
    },
    getRuntime: () => runtime,
    ...(installedVersion ? { getInstalledApp: () => ({ currentVersion: installedVersion }) } : {}),
    emitChanged: async (change: any) => { changes.push(change) },
    emitProgress: (value: unknown) => progress.push(value),
    installArchivePackage: async (_root: string, options: any) => {
      packageInstallCount += 1
      const app = { id: 'example.app', currentVersion: '1.0.0' }
      await options.activateInstallation?.(app)
      return app
    },
    installArchive: async (_runtime: unknown, _archivePath: string, options: any) => {
      options.onProgress({ phase: 'extracting' })
      return options.installPackage('/tmp/example-package')
    },
    validatePackage: async () => ({
      manifest: {
        id: 'example.app',
        version: '1.0.0',
        displayName: '示例 App',
        permissions,
        contributes: { tools },
        ...(appCapabilities ? { appCapabilities } : {}),
      },
    }),
    remote: {},
  })
  return {
    handlers,
    install: () => handlers.get('app:install-archive')?.({}),
    registrations,
    changes,
    prompts,
    progress,
    packageInstallCount: () => packageInstallCount,
  }
}

describe('App archive installation', () => {
  it.each([0, 1])('discloses tools even without permissions before installing (response %s)', async response => {
    const fixture = createFixture({ response, permissions: [], tools: [{
      id: 'request', title: '发送请求', description: '从本机访问指定服务', effect: 'write', action: 'request.send',
    }] })
    const result = await fixture.install()
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('AI 工具（1 个）')
    expect(fixture.prompts[0].detail).toContain('发送请求（request） · 可修改数据')
    expect(fixture.prompts[0].detail).toContain('从本机访问指定服务')
    expect(fixture.prompts[0].detail).toContain('会话选择此 App 后常驻提供')
    expect(fixture.packageInstallCount()).toBe(response)
    expect(fixture.registrations).toHaveLength(response)
    expect(result.ok).toBe(response === 1)
  })

  it('does not add an approval prompt to Apps with no tools or new permissions', async () => {
    const fixture = createFixture({ permissions: [] })
    expect((await fixture.install()).ok).toBe(true)
    expect(fixture.prompts).toHaveLength(0)
  })

  it('reviews cross-App protocols on reinstall even when the existing grant is retained', async () => {
    const fixture = createFixture({ response: 0, currentGrants: ['apps:invoke'], permissions: ['apps:invoke'],
      appCapabilities: { requires: [{ protocol: 'moss.dataset/v1' }] } })
    expect(await fixture.install()).toEqual({ ok: false, canceled: true })
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('调用其他 App 的能力')
    expect(fixture.prompts[0].detail).toContain('moss.dataset/v1')
    expect(fixture.packageInstallCount()).toBe(0)
  })

  it('discloses exact target App tools on reinstall even when the declaration and grant are unchanged', async () => {
    const appCapabilities = { usesTools: [{ appId: 'moss.database', tools: ['search_objects', 'execute_sql'] }] }
    const fixture = createFixture({ response: 0, currentGrants: ['apps:invoke'], permissions: ['apps:invoke'],
      appCapabilities, previousManifest: { appCapabilities }, installedVersion: '0.9.0' })
    expect(await fixture.install()).toEqual({ ok: false, canceled: true })
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('调用其他 App 的现有工具')
    expect(fixture.prompts[0].detail).toContain('moss.database')
    expect(fixture.prompts[0].detail).toContain('search_objects')
    expect(fixture.prompts[0].detail).toContain('execute_sql')
    expect(fixture.prompts[0].detail).toContain('当前及以后启用的实例和子服务')
    expect(fixture.prompts[0].detail).toContain('可能读取或修改目标 App 可访问的数据')
    expect(fixture.packageInstallCount()).toBe(0)
  })

  it('reviews removal of the last cross-App declaration', async () => {
    const fixture = createFixture({ response: 0, currentGrants: ['apps:invoke'], permissions: [],
      previousManifest: { appCapabilities: { requires: [{ protocol: 'moss.dataset/v1' }] } } })
    expect(await fixture.install()).toEqual({ ok: false, canceled: true })
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('原版本的跨 App 能力声明')
    expect(fixture.prompts[0].detail).toContain('moss.dataset/v1')
    expect(fixture.packageInstallCount()).toBe(0)
  })

  it('shows removed target tools in the previous-version review', async () => {
    const fixture = createFixture({ response: 0, permissions: [], installedVersion: '0.9.0',
      previousManifest: { appCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['execute_sql'] }] } } })
    expect(await fixture.install()).toEqual({ ok: false, canceled: true })
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('原版本的跨 App 能力声明')
    expect(fixture.prompts[0].detail).toContain('moss.database')
    expect(fixture.prompts[0].detail).toContain('execute_sql')
    expect(fixture.packageInstallCount()).toBe(0)
  })

  it('requires review when the installed Manifest is unreadable', async () => {
    const fixture = createFixture({ response: 0, permissions: [], installedVersion: '0.9.0' })
    expect(await fixture.install()).toEqual({ ok: false, canceled: true })
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('无法读取原版本的跨 App 能力声明')
    expect(fixture.packageInstallCount()).toBe(0)
  })

  it('keeps configuration access without exposing Backend creation or deletion', () => {
    const { handlers } = createFixture()
    expect(handlers.has('app:list-instances')).toBe(true)
    expect(handlers.has('app:update-instance')).toBe(true)
    expect(handlers.has('app:create-instance')).toBe(false)
    expect(handlers.has('app:remove-instance')).toBe(false)
  })

  it('asks for declared permissions and persists the approved grants', async () => {
    const fixture = createFixture()

    const result = await fixture.install()

    expect(result.ok).toBe(true)
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('platform:files')
    expect(fixture.registrations).toEqual([{
      appId: 'example.app',
      version: '1.0.0',
      options: { grants: ['platform:files', 'agent:turns:write'] },
    }])
    expect(fixture.changes[0]).toEqual({ action: 'install', app: { id: 'example.app', currentVersion: '1.0.0' },
      grants: ['platform:files', 'agent:turns:write'] })
    expect(fixture.packageInstallCount()).toBe(1)
    expect(fixture.progress.map((value) => value.phase)).toEqual([
      'preparing', 'extracting', 'validating', 'validating', 'awaiting-permission', 'installing', 'activating', 'completed',
    ])
    expect(fixture.progress.at(-1)).toMatchObject({ source: 'local', appId: 'example.app', version: '1.0.0', fileName: 'example.app.zip' })
  })

  it('requests only newly added permissions when reinstalling an App', async () => {
    const fixture = createFixture({ currentGrants: ['platform:files', 'agent:catalog:read'] })

    await fixture.install()

    expect(fixture.prompts[0].detail).not.toContain('platform:files')
    expect(fixture.prompts[0].detail).toContain('agent:turns:write')
    expect(fixture.registrations[0].options.grants).toEqual(['platform:files', 'agent:turns:write'])
  })

  it('does not install or grant permissions when approval is canceled', async () => {
    const fixture = createFixture({ response: 0 })

    const result = await fixture.install()

    expect(result).toEqual({ ok: false, canceled: true })
    expect(fixture.packageInstallCount()).toBe(0)
    expect(fixture.registrations).toHaveLength(0)
    expect(fixture.progress.at(-1).phase).toBe('canceled')
    expect(fixture.progress.some((value) => value.phase === 'completed')).toBe(false)
  })

  it('reports an activation failure instead of leaving the install in progress', async () => {
    const fixture = createFixture({ activationError: 'Unable to start App' })
    await expect(fixture.install()).rejects.toThrow('Unable to start App')
    expect(fixture.progress.at(-1)).toMatchObject({ phase: 'error', error: 'Unable to start App' })
    expect(fixture.progress.some((value) => value.phase === 'completed')).toBe(false)
  })

  it('restores the prior registry and Runtime version when a committed ZIP fails to activate', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    let registryVersion = '0.9.0', runtimeVersion = '0.9.0', revision = 4
    let runtimeGrants = ['legacy:read']
    const rollbacks: any[] = []
    const changes: any[] = []
    const runtime = {
      installations: { list: () => [{ appId: 'example.app', activeVersion: runtimeVersion, grants: runtimeGrants }] },
      getInstallation: () => ({ activeVersion: runtimeVersion, grants: runtimeGrants }),
      getApp: async () => null,
      registerInstalled: async (_appId: string, _version: string, options: any) => {
        runtimeVersion = '1.0.0'; runtimeGrants = options.grants
        throw new Error('activation failed')
      },
      activateVersion: async (_appId: string, version: string, options: any) => {
        runtimeVersion = version; runtimeGrants = options.grants
      },
    }
    registerAppRuntimeIpc({
      ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/example.app.zip'] }) },
      getRuntime: () => runtime,
      confirmInstallation: async () => true,
      emitChanged: async (change: any) => { changes.push(change) },
      getInstallationRevision: () => revision,
      getInstalledApp: () => ({ currentVersion: registryVersion }),
      installArchive: async (_runtime: unknown, _archive: string, options: any) => options.installPackage('/verified-package'),
      installArchivePackage: async (_root: string, options: any) => {
        registryVersion = '1.0.0'; revision = 5
        options.onCommit({ installationRevision: revision })
        return { id: 'example.app', currentVersion: registryVersion }
      },
      validatePackage: async () => ({ manifest: { id: 'example.app', version: '1.0.0', permissions: [] } }),
      rollbackPackage: async (input: any) => {
        rollbacks.push(input)
        registryVersion = '0.9.0'; revision = 6
        return true
      },
    })
    await expect(handlers.get('app:install-archive')?.({})).rejects.toThrow('activation failed')
    expect(rollbacks).toEqual([{ appId: 'example.app', previousVersion: '0.9.0',
      failedVersion: '1.0.0', expectedInstallationRevision: 5 }])
    expect(registryVersion).toBe('0.9.0')
    expect(runtimeVersion).toBe('0.9.0')
    expect(runtimeGrants).toEqual(['legacy:read'])
    expect(changes).toEqual([{ action: 'install-rollback', appId: 'example.app' }])
  })

  it('rolls back a committed ZIP when the publication activation fails', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const changes: string[] = []
    let registryVersion = '0.9.0', revision = 4, runtimeActivated = false
    const runtime = {
      installations: { list: () => [{ appId: 'example.app', activeVersion: '0.9.0', grants: [] }] },
      getInstallation: () => ({ activeVersion: '0.9.0', grants: [] }),
      getApp: async () => null,
      registerInstalled: async () => { runtimeActivated = true },
    }
    registerAppRuntimeIpc({
      ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/example.app.zip'] }) },
      getRuntime: () => runtime,
      getInstallationRevision: () => revision,
      getInstalledApp: () => ({ currentVersion: registryVersion }),
      confirmInstallation: async () => true,
      emitChanged: async (change: any) => {
        changes.push(change.action)
        if (change.action === 'install') throw new Error('publish activation failed')
      },
      installArchive: async (_runtime: unknown, _archive: string, options: any) => options.installPackage('/verified-package'),
      installArchivePackage: async (_root: string, options: any) => {
        registryVersion = '1.0.0'; revision = 5
        options.onCommit({ installationRevision: revision })
        const app = { id: 'example.app', currentVersion: registryVersion }
        await options.activateInstallation(app)
        return app
      },
      validatePackage: async () => ({ manifest: { id: 'example.app', version: '1.0.0', permissions: [] } }),
      rollbackPackage: async () => { registryVersion = '0.9.0'; revision = 6; return true },
    })
    await expect(handlers.get('app:install-archive')?.({})).rejects.toThrow('publish activation failed')
    expect(registryVersion).toBe('0.9.0')
    expect(runtimeActivated).toBe(false)
    expect(changes).toEqual(['install', 'install-rollback'])
  })

  it('restores prior grants when reinstalling the same ZIP version fails after activation', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    let revision = 4
    let runtimeGrants = ['platform:files']
    let restoredGrants: string[] | null = null
    const runtime = {
      installations: { list: () => [{ appId: 'example.app', activeVersion: '1.0.0', grants: runtimeGrants }] },
      getInstallation: () => ({ activeVersion: '1.0.0', grants: runtimeGrants }),
      getApp: async () => null,
      transitionApp: async (_appId: string, operation: () => Promise<void>) => operation(),
      setAppGrantsNow: async (_appId: string, grants: string[]) => {
        restoredGrants = grants; runtimeGrants = grants
      },
    }
    registerAppRuntimeIpc({
      ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/example.app.zip'] }) },
      getRuntime: () => runtime,
      getInstallationRevision: () => revision,
      getInstalledApp: () => ({ currentVersion: '1.0.0' }),
      confirmInstallation: async () => true,
      emitChanged: async (change: any) => {
        if (change.action === 'install') {
          runtimeGrants = change.grants
          throw new Error('refresh failed')
        }
      },
      installArchive: async (_runtime: unknown, _archive: string, options: any) => options.installPackage('/verified-package'),
      installArchivePackage: async (_root: string, options: any) => {
        revision = 5
        options.onCommit({ installationRevision: revision })
        const app = { id: 'example.app', currentVersion: '1.0.0' }
        await options.activateInstallation(app)
        return app
      },
      validatePackage: async () => ({ manifest: { id: 'example.app', version: '1.0.0', permissions: ['platform:files', 'apps:invoke'] } }),
      rollbackPackage: async () => { revision = 6; return true },
    })
    await expect(handlers.get('app:install-archive')?.({})).rejects.toThrow('refresh failed')
    expect(restoredGrants).toEqual(['platform:files'])
    expect(runtimeGrants).toEqual(['platform:files'])
  })

  it('rolls back the package before taking the Runtime lock and leaves a newer install alone', async () => {
    const handlers = new Map<string, (...args: any[]) => any>()
    const steps: string[] = []
    let registryVersion = '0.9.0', runtimeVersion = '0.9.0', revision = 4
    const runtime = {
      installations: { list: () => [{ appId: 'example.app', grants: [] }] },
      getInstallation: () => ({ activeVersion: runtimeVersion }),
      getApp: async () => null,
      registerInstalled: async () => { runtimeVersion = '1.0.0'; throw new Error('activation failed') },
      transitionApp: async (_appId: string, operation: () => Promise<void>) => {
        steps.push('runtime-lock')
        // A second install completed while this rollback waited for Runtime.
        registryVersion = '1.1.0'; runtimeVersion = '1.1.0'; revision = 7
        await operation()
      },
      activateVersionNow: async () => { steps.push('restore-runtime') },
    }
    registerAppRuntimeIpc({
      ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/example.app.zip'] }) },
      getRuntime: () => runtime,
      confirmInstallation: async () => true,
      getInstallationRevision: () => revision,
      getInstalledApp: () => ({ currentVersion: registryVersion }),
      installArchive: async (_runtime: unknown, _archive: string, options: any) => options.installPackage('/verified-package'),
      installArchivePackage: async (_root: string, options: any) => {
        registryVersion = '1.0.0'; revision = 5
        options.onCommit({ installationRevision: revision })
        return { id: 'example.app', currentVersion: registryVersion }
      },
      validatePackage: async () => ({ manifest: { id: 'example.app', version: '1.0.0', permissions: [] } }),
      rollbackPackage: async () => { steps.push('rollback-package'); registryVersion = '0.9.0'; revision = 6; return true },
    })
    await expect(handlers.get('app:install-archive')?.({})).rejects.toThrow('activation failed')
    expect(steps).toEqual(['rollback-package', 'runtime-lock'])
    expect(registryVersion).toBe('1.1.0')
    expect(runtimeVersion).toBe('1.1.0')
  })
})
