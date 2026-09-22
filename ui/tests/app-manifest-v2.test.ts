import { describe, expect, it } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020.js'
import { APP_MANIFEST_SCHEMA, AppBackendClient, createEnvelope, validateAppManifest } from '../../packages/app-sdk/src/index.mjs'

const valid = {
  schemaVersion: 2,
  id: 'example.app',
  version: '1.2.3',
  displayName: 'Example',
  hostApi: '^2.0.0',
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
    expect(() => validateAppManifest({ ...valid, hostApi: '^3.0.0' })).toThrow()
    expect(() => validateAppManifest({ ...valid, permissions: ['Invalid Permission'] })).toThrow(/permissions/)
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

  it('allows Server-only Backend Apps but rejects a UI whose Backend cannot run on Desktop', () => {
    const serverBackend = {
      entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
      lifecycle: 'persistent', instanceMode: 'single', targets: ['server'],
      actions: [{ name: 'serve' }],
    }
    expect(validateAppManifest({ ...valid, ui: undefined, backend: serverBackend }).backend?.targets).toEqual(['server'])
    expect(() => validateAppManifest({ ...valid, backend: serverBackend })).toThrow(
      /Apps with a UI must target desktop/,
    )
    const validateSchema = new Ajv2020({ strict: false }).compile(APP_MANIFEST_SCHEMA)
    expect(validateSchema({ ...valid, backend: serverBackend })).toBe(false)
  })

  it('supports versioned Host protocols without coupling manifests to a product integration', () => {
    const backend = {
      entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
      lifecycle: 'persistent', instanceMode: 'multiple', targets: ['desktop'],
      protocols: ['moss.agent/v1'], actions: [],
    }
    expect(validateAppManifest({
      ...valid,
      ui: undefined,
      backend,
      permissions: ['agent:turns:write'],
    }).backend?.protocols).toEqual(['moss.agent/v1'])
    expect(validateAppManifest({
      ...valid,
      ui: undefined,
      backend: { ...backend, lifecycle: 'on-demand' },
      permissions: ['agent:turns:write'],
    }).backend?.lifecycle).toBe('on-demand')
    expect(validateAppManifest({
      ...valid,
      ui: undefined,
      backend: { ...backend, protocols: ['moss.unknown/v1'] },
      permissions: ['unknown:read'],
    }).backend?.protocols).toEqual(['moss.unknown/v1'])
    expect(() => validateAppManifest({
      ...valid,
      ui: undefined,
      backend: { ...backend, protocols: ['Moss Unknown'] },
      permissions: [],
    })).toThrow(/protocols/)
  })

  it('normalizes contribution points and rejects dangling or ungranted references', () => {
    const contributed = {
      ...valid,
      permissions: ['catalog:read'],
      backend: {
        entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
        lifecycle: 'on-demand', instanceMode: 'single', targets: ['desktop'],
        actions: [{ name: 'catalog.search', inputSchema: 'schemas/search.json' }],
      },
      contributes: {
        views: [{ id: 'catalog', title: 'Catalog', location: 'sidebar', route: '#/catalog' }],
        settings: [{ id: 'catalog-settings', title: 'Catalog settings', viewId: 'catalog' }],
        commands: [{ id: 'catalog-search-command', title: 'Search', action: 'catalog.search' }],
        tools: [{
          id: 'catalog-search-tool', title: 'Search', description: 'Search the catalog', action: 'catalog.search',
          inputSchema: 'schemas/search.json', effect: 'read', permission: 'catalog:read',
        }],
        resourceProviders: [{ id: 'catalog-provider', schemes: ['catalog'], resolveAction: 'catalog.search' }],
        widgets: [{ id: 'status', title: 'Status', viewId: 'catalog', placement: 'status' }],
      },
    }
    const manifest = validateAppManifest(contributed)
    expect(manifest.contributes?.views[0]).toMatchObject({ route: '#/catalog', location: 'sidebar', order: 0 })
    expect(manifest.contributes?.tools[0]).toMatchObject({ id: 'catalog-search-tool', effect: 'read', permission: 'catalog:read' })
    expect(() => validateAppManifest({
      ...contributed,
      contributes: { tools: [{ ...contributed.contributes.tools[0], action: 'missing' }] },
    })).toThrow(/unknown Backend action/)
    expect(() => validateAppManifest({
      ...contributed,
      contributes: { views: [{ id: 'catalog', title: 'Catalog', permission: 'catalog:write' }] },
    })).toThrow(/undeclared permission/)
    expect(() => validateAppManifest({
      ...contributed,
      contributes: { settings: [{ id: 'settings', title: 'Settings', viewId: 'missing' }] },
    })).toThrow(/unknown view/)
    expect(() => validateAppManifest({
      ...contributed,
      contributes: {
        views: [{ id: 'same', title: 'Catalog' }],
        commands: [{ id: 'same', title: 'Search', action: 'catalog.search' }],
      },
    })).toThrow(/Duplicate App contribution id/)
    expect(() => validateAppManifest({
      ...contributed,
      backend: {
        ...contributed.backend,
        actions: [{ name: 'catalog.search' }],
      },
      contributes: {
        commands: [{
          id: 'search', title: 'Search', action: 'catalog.search', inputSchema: 'schemas/search.json',
        }],
      },
    })).toThrow(/inputSchema must match/)
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
