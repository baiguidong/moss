import { describe, expect, it } from 'bun:test'
import { registerAppRuntimeIpc } from '../src/apps/app-runtime-ipc.mjs'

function createFixture({ response = 1, currentGrants = [] as string[] } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>()
  const registrations: Array<{ appId: string; version: string; options: { grants: string[] } }> = []
  const prompts: any[] = []
  let packageInstallCount = 0
  const runtime = {
    installations: {
      list: () => currentGrants.length ? [{ appId: 'moss.openim', grants: currentGrants }] : [],
    },
    registerInstalled: async (appId: string, version: string, options: { grants: string[] }) => {
      registrations.push({ appId, version, options })
    },
  }
  registerAppRuntimeIpc({
    ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) },
    dialog: {
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/moss.openim.zip'] }),
      showMessageBox: async (options: any) => {
        prompts.push(options)
        return { response }
      },
    },
    getRuntime: () => runtime,
    emitChanged: async () => {},
    installArchivePackage: async () => {
      packageInstallCount += 1
      return { id: 'moss.openim', currentVersion: '0.1.0' }
    },
    installArchive: async (_runtime: unknown, _archivePath: string, options: any) => (
      options.installPackage('/tmp/openim-package')
    ),
    validatePackage: async () => ({
      manifest: {
        id: 'moss.openim',
        version: '0.1.0',
        displayName: '即时消息',
        permissions: ['openim:client', 'openim:messages'],
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
    expect(fixture.prompts[0].detail).toContain('openim:client')
    expect(fixture.registrations).toEqual([{
      appId: 'moss.openim',
      version: '0.1.0',
      options: { grants: ['openim:client', 'openim:messages'] },
    }])
    expect(fixture.packageInstallCount()).toBe(1)
  })

  it('requests only newly added permissions when reinstalling an App', async () => {
    const fixture = createFixture({ currentGrants: ['openim:client'] })

    await fixture.install()

    expect(fixture.prompts[0].detail).not.toContain('openim:client')
    expect(fixture.prompts[0].detail).toContain('openim:messages')
    expect(fixture.registrations[0].options.grants).toEqual(['openim:client', 'openim:messages'])
  })

  it('does not install or grant permissions when approval is canceled', async () => {
    const fixture = createFixture({ response: 0 })

    const result = await fixture.install()

    expect(result).toEqual({ ok: false, canceled: true })
    expect(fixture.packageInstallCount()).toBe(0)
    expect(fixture.registrations).toHaveLength(0)
  })
})
