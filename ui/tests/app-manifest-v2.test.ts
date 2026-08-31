import { describe, expect, it } from 'bun:test'
import { AppBackendClient, createEnvelope, validateAppManifest } from '../../packages/app-sdk/src/index.mjs'

const valid = {
  schemaVersion: 2,
  id: 'example.app',
  version: '1.2.3',
  displayName: 'Example',
  hostApi: '^1.0.0',
  ui: { entry: 'dist/ui/index.html' },
  permissions: [],
}

describe('App manifest V2', () => {
  it('normalizes a UI-only manifest without inventing a Backend', () => {
    const manifest = validateAppManifest(valid)
    expect(manifest.ui?.window).toEqual({ width: 1100, height: 760, resizable: true })
    expect(manifest.backend).toBeUndefined()
  })

  it('rejects traversal, incompatible Host APIs, and duplicate actions', () => {
    expect(() => validateAppManifest({ ...valid, ui: { entry: '../escape.html' } })).toThrow()
    expect(() => validateAppManifest({ ...valid, ui: { entry: '..\\escape.html' } })).toThrow()
    expect(() => validateAppManifest({ ...valid, ui: { entry: 'C:\\escape.html' } })).toThrow()
    expect(() => validateAppManifest({ ...valid, displayName: '   ' })).toThrow()
    expect(() => validateAppManifest({ ...valid, hostApi: '^2.0.0' })).toThrow()
    expect(() => validateAppManifest({
      ...valid,
      ui: undefined,
      backend: {
        entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
        lifecycle: 'persistent', instanceMode: 'single', targets: ['desktop'],
        actions: [{ name: 'same' }, { name: 'same' }],
      },
    })).toThrow(/Duplicate Backend action/)
  })

  it('reports Backend initialization failures instead of leaving an unhandled rejection', async () => {
    const received: any[] = []
    let receive: ((message: any) => void) | null = null
    let fatalError: Error | null = null
    new AppBackendClient({
      send: (message: any) => received.push(message),
      onMessage: (handler: (message: any) => void) => { receive = handler },
      onInitialize: async () => { throw new Error('initialization failed') },
      onFatalError: (error: Error) => { fatalError = error },
    }).start()
    receive?.(createEnvelope('service.init', { generation: 1, launchToken: 'test' }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fatalError?.message).toBe('initialization failed')
    expect(received.at(-1)).toMatchObject({ type: 'service.status', payload: { state: 'error' } })
  })
})
