import { describe, expect, it } from 'bun:test'
import { registerAppRuntimeIpc } from '../src/apps/app-runtime-ipc.mjs'

function createFixture({ response = 1, currentGrants = [] as string[], activationError = '' } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const registrations: Array<{ appId: string; version: string; options: { grants: string[] } }> = []
  const prompts: any[] = []
  const progress: any[] = []
  let packageInstallCount = 0
  const runtime = {
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
    emitChanged: async () => {},
    emitProgress: (value: unknown) => progress.push(value),
    installArchivePackage: async () => {
      packageInstallCount += 1
      return { id: 'example.app', currentVersion: '1.0.0' }
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
        permissions: ['platform:files', 'agent:turns:write'],
      },
    }),
    remote: {},
  })
  return {
    handlers,
    install: () => handlers.get('app:install-archive')?.({}),
    registrations,
    prompts,
    progress,
    packageInstallCount: () => packageInstallCount,
  }
}

describe('App archive installation', () => {
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
})
