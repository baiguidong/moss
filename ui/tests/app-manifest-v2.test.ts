import { describe, expect, it } from 'bun:test'
import Ajv2020 from 'ajv/dist/2020.js'
import {
  APP_HOST_API_VERSION,
  APP_MANIFEST_SCHEMA,
  AppBackendClient,
  createEnvelope,
  compileJsonSchema,
  resolveAppProtocols,
  validateAppManifest,
} from '../../packages/app-sdk/src/index.mjs'

const valid = {
  schemaVersion: 2,
  id: 'example.app',
  version: '1.2.3',
  displayName: 'Example',
  hostApi: '^3.0.0',
  ui: { entry: 'dist/ui/index.html' },
  permissions: [],
}

describe('App manifest V2', () => {
  it('validates draft-07 MCP schemas and 2020-12 App schemas without changing input data', () => {
    const legacy = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', items: [{ type: 'string' }, { type: 'number' }], additionalItems: false }
    const current = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false }
    for (const schema of [legacy, { ...legacy, $schema: 'https://json-schema.org/draft-07/schema' }, current]) {
      const before = JSON.stringify(schema), validate = compileJsonSchema(schema)
      expect(validate(['task', 1])).toBe(true)
      expect(validate(['task', 'wrong'])).toBe(false)
      expect(validate(['task', 1, 'extra'])).toBe(false)
      expect(JSON.stringify(schema)).toBe(before)
    }
  })

  it('preserves one category and search keywords through normalization while accepting legacy Apps', () => {
    const source = { ...valid, category: 'automation', keywords: ['Chrome', ' 网页 ', '网页'] };
    expect(validateAppManifest(source)).toMatchObject({ category: 'automation', keywords: ['Chrome', '网页'] });
    expect(source.keywords).toEqual(['Chrome', ' 网页 ', '网页']);
    expect(validateAppManifest(valid)).toMatchObject({ category: 'other', keywords: [] });
    for (const category of ['效率', 'unknown', '', ['automation'], null]) {
      expect(() => validateAppManifest({ ...valid, category })).toThrow();
    }
    for (const keywords of [[' '], ['x'.repeat(41)], Array.from({ length: 21 }, (_, i) => String(i)), 'Chrome']) {
      expect(() => validateAppManifest({ ...valid, keywords })).toThrow();
    }
  })

  it('advertises Host API 3 and rejects unpublished older contracts', () => {
    expect(APP_HOST_API_VERSION).toBe('3.22.0')
    expect(validateAppManifest(valid).hostApi).toBe('^3.0.0')
    expect(() => validateAppManifest({ ...valid, hostApi: '^2.9.0' })).toThrow(/Host API/)
    expect(() => validateAppManifest({ ...valid, hostApi: '^3.23.0' })).toThrow(/Host API/)
  })

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
    expect(() => validateAppManifest({ ...valid, hostApi: '^4.0.0' })).toThrow()
    expect(() => validateAppManifest({ ...valid, permissions: ['Invalid Permission'] })).toThrow(/permissions/)
    expect(() => validateAppManifest({
      ...valid,
      ui: undefined,
      backend: {
        entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
        lifecycle: 'persistent',
        actions: [{ name: 'same' }, { name: 'same' }],
      },
    })).toThrow(/Duplicate Backend action/)
  })

  it('keeps UI presence independent from a Backend', () => {
    const backend = {
      entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
      lifecycle: 'persistent',
      actions: [{ name: 'serve' }],
    }
    expect(validateAppManifest({ ...valid, ui: undefined, backend }).backend).toMatchObject(backend)
    expect(validateAppManifest({ ...valid, backend }).backend).toMatchObject(backend)
    const validateSchema = new Ajv2020({ strict: false }).compile(APP_MANIFEST_SCHEMA)
    expect(validateSchema({ ...valid, backend })).toBe(true)
  })

  it('uses one Backend and accepts the legacy single declaration without retaining it', () => {
    const backend = {
      entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
      lifecycle: 'persistent', actions: [],
    }
    expect(validateAppManifest({ ...valid, backend }).backend).not.toHaveProperty('instanceMode')
    expect(validateAppManifest({ ...valid, backend: { ...backend, instanceMode: 'single' } }).backend)
      .not.toHaveProperty('instanceMode')
    expect(() => validateAppManifest({ ...valid, backend: { ...backend, instanceMode: 'multiple' } }))
      .toThrow(/instanceMode/)
  })

  it('retains only fields defined by the current manifest schema', () => {
    const manifest = validateAppManifest({
      ...valid,
      obsoleteRootField: true,
      backend: {
        entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
        lifecycle: 'persistent', obsoleteBackendField: true, actions: [],
      },
    })
    expect(manifest).not.toHaveProperty('obsoleteRootField')
    expect(manifest.backend).not.toHaveProperty('obsoleteBackendField')
  })

  it('supports versioned Host protocols without coupling manifests to a product integration', () => {
    const backend = {
      entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
      lifecycle: 'persistent',
      actions: [],
    }
    expect(validateAppManifest({
      ...valid,
      ui: undefined,
      backend,
      host: { protocols: ['moss.agent/v1'] },
      permissions: ['agent:turns:write'],
    }).host?.protocols).toEqual(['moss.agent/v1'])
    expect(resolveAppProtocols({ host: { protocols: ['moss.agent/v1'] } })).toEqual(['moss.host/v1', 'moss.agent/v1'])
    expect(validateAppManifest({
      ...valid,
      ui: undefined,
      backend: { ...backend, lifecycle: 'on-demand' },
      permissions: ['agent:turns:write'],
    }).backend?.lifecycle).toBe('on-demand')
    expect(validateAppManifest({
      ...valid,
      ui: undefined,
      host: { protocols: ['moss.unknown/v1'] },
backend: { ...backend, },
      permissions: ['unknown:read'],
    }).host?.protocols).toEqual(['moss.unknown/v1'])
    expect(() => validateAppManifest({
      ...valid,
      ui: undefined,
      host: { protocols: ['Moss Unknown'] },
backend: { ...backend, },
      permissions: [],
    })).toThrow(/protocols/)

    expect(() => validateAppManifest({
      ...valid,
      ui: undefined,
      host: { protocols: { invalid: ['moss.agent/v1'] } },
backend: { ...backend, },
    })).toThrow(/protocols/)
  })

  it('discards legacy view placement while retaining routes and leaving source manifests intact', () => {
    for (const location of ['more', 'sidebar', 'hidden']) {
      const view = { id: 'home', title: 'Home', route: '#/home', location }
      const manifest = validateAppManifest({ ...valid, contributes: { views: [view] } })
      expect(manifest.contributes?.views[0]).not.toHaveProperty('location')
      expect(manifest.contributes?.views[0].route).toBe('#/home')
      expect(view.location).toBe(location)
    }
  })

  it('normalizes contribution points and rejects dangling or ungranted references', () => {
    const contributed = {
      ...valid,
      permissions: ['catalog:read'],
      backend: {
        entry: 'dist/backend.mjs', runtime: 'node', apiVersion: 1,
        lifecycle: 'on-demand',
        actions: [{ name: 'catalog.search', inputSchema: 'schemas/search.json' }],
      },
      contributes: {
        views: [{ id: 'catalog', title: 'Catalog', route: '#/catalog' }],
        settings: [{ id: 'catalog-settings', title: 'Catalog settings', viewId: 'catalog' }],
        commands: [{ id: 'catalog-search-command', title: 'Search', action: 'catalog.search' }],
        tools: [{
          id: 'catalog-search-tool', title: 'Search', description: 'Search the catalog', action: 'catalog.search',
          inputSchema: 'schemas/search.json', effect: 'read', permission: 'catalog:read',
        }],
        resourceProviders: [{ id: 'catalog-provider', schemes: ['catalog'], title: 'Catalog', listAction: 'catalog.search', resolveAction: 'catalog.search' }],
        widgets: [{ id: 'status', title: 'Status', viewId: 'catalog', placement: 'status' }],
      },
    }
    const manifest = validateAppManifest(contributed)
    expect(manifest.contributes?.resourceProviders[0]).toMatchObject({title: 'Catalog', listAction: 'catalog.search'})
    expect(() => validateAppManifest({...contributed, contributes: {resourceProviders: [{...contributed.contributes.resourceProviders[0], listAction:'missing'}]}})).toThrow(/unknown Backend action/)
    expect(manifest.contributes?.views[0]).toMatchObject({ route: '#/catalog', order: 0 })
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

  it('validates one App-wide scope and requires a host that understands explicit declarations', () => {
    expect(validateAppManifest(valid).toolScope ?? 'session').toBe('session')
    expect(validateAppManifest({ ...valid, hostApi: '^3.1.0', toolScope: 'global' }).toolScope).toBe('global')
    expect(validateAppManifest({ ...valid, hostApi: '^3.1.0', toolScope: 'session' }).toolScope).toBe('session')
    expect(() => validateAppManifest({ ...valid, toolScope: 'session' })).toThrow(/hostApi/)
    expect(() => validateAppManifest({ ...valid, hostApi: '^3.1.0', toolScope: 'always' })).toThrow()
    expect(() => validateAppManifest(validateAppManifest(valid))).not.toThrow()
  })

describe('host-managed Connector App contract', () => {
  const connector = {
    schemaVersion: 2, id: 'moss.example', version: '1.0.0', displayName: 'Example service',
    hostApi: '^3.15.0', permissions: ['connector:use'], toolScope: 'session', navigation: { location: 'none' },
    connectorApp: { id: 'example', capabilities: ['cli'] }, discovery: { group: 'online', authMethods: ['browser'] },
  }
  it('retains discovery and capabilities without inventing a Backend or UI', () => {
    const manifest = validateAppManifest(connector)
    expect(manifest.connectorApp).toEqual(connector.connectorApp)
    expect(manifest.discovery).toEqual(connector.discovery)
    expect(manifest.backend).toBeUndefined()
    expect(manifest.ui).toBeUndefined()
    expect(validateAppManifest(manifest)).toEqual(manifest)
  })
  it('allows independent App identity while rejecting additional privileges and older host support', () => {
    expect(validateAppManifest({ ...connector, id: 'other.team-chat' }).connectorApp.id).toBe('example')
    for (const patch of [
      { id: 'invalid/app' }, { hostApi: '^3.14.0' }, { permissions: [] }, { toolScope: 'global' },
      { permissions: ['connector:use', 'filesystem:read'] }, { ui: { entry: 'dist/index.html' } },
      { discovery: { group: 'mcp' } }, { connectorApp: { id: '../escape', capabilities: ['cli'] } },
    ]) expect(() => validateAppManifest({ ...connector, ...patch })).toThrow()
  })
})
