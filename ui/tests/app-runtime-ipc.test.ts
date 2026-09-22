import { describe, expect, it } from 'bun:test'
import { registerAppRuntimeIpc } from '../src/apps/app-runtime-ipc.mjs'

function createFixture({ response = 1, currentGrants = [] as string[] } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const registrations: Array<{ appId: string; version: string; options: { grants: string[] } }> = []
  const prompts: any[] = []
  let packageInstallCount = 0
  const runtime = {
    installations: {
      list: () => currentGrants.length ? [{ appId: 'example.app', grants: currentGrants }] : [],
    },
    registerInstalled: async (appId: string, version: string, options: { grants: string[] }) => {
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
    installArchivePackage: async () => {
      packageInstallCount += 1
      return { id: 'example.app', currentVersion: '1.0.0' }
    },
    installArchive: async (_runtime: unknown, _archivePath: string, options: any) => (
      options.installPackage('/tmp/example-package')
    ),
    validatePackage: async () => ({
      manifest: {
        id: 'example.app',
        version: '1.0.0',
        displayName: '示例 App',
        permissions: ['desktop:files', 'agent:turns:write'],
      },
    }),
    remote: {},
  })
  return {
    install: () => handlers.get('app:install-archive')?.({}),
    registrations,
    prompts,
    packageInstallCount: () => packageInstallCount,
  }
}

describe('local App archive installation', () => {
  it('asks for declared permissions and persists the approved grants', async () => {
    const fixture = createFixture()

    const result = await fixture.install()

    expect(result.ok).toBe(true)
    expect(fixture.prompts).toHaveLength(1)
    expect(fixture.prompts[0].detail).toContain('desktop:files')
    expect(fixture.registrations).toEqual([{
      appId: 'example.app',
      version: '1.0.0',
      options: { grants: ['desktop:files', 'agent:turns:write'] },
    }])
    expect(fixture.packageInstallCount()).toBe(1)
  })

  it('requests only newly added permissions when reinstalling an App', async () => {
    const fixture = createFixture({ currentGrants: ['desktop:files', 'agent:catalog:read'] })

    await fixture.install()

    expect(fixture.prompts[0].detail).not.toContain('desktop:files')
    expect(fixture.prompts[0].detail).toContain('agent:turns:write')
    expect(fixture.registrations[0].options.grants).toEqual(['desktop:files', 'agent:turns:write'])
  })

  it('does not install or grant permissions when approval is canceled', async () => {
    const fixture = createFixture({ response: 0 })

    const result = await fixture.install()

    expect(result).toEqual({ ok: false, canceled: true })
    expect(fixture.packageInstallCount()).toBe(0)
    expect(fixture.registrations).toHaveLength(0)
  })
})
