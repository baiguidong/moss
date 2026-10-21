import { describe, expect, it } from 'bun:test'
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs'

const protocol = 'moss.dataset/v1'
const readMethod = { name: 'describe', action: 'describe', permission: 'dataset:read', effect: 'read' }
const manifest = {
  schemaVersion: 2,
  id: 'fixture.capability-contract',
  version: '1.0.0',
  displayName: 'Capability contract',
  hostApi: '^3.18.0',
  permissions: ['dataset:read', 'dataset:result:read'],
  backend: {
    entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand',
    actions: [
      { name: 'describe', inputSchema: 'describe-input.json', outputSchema: 'describe-output.json' },
      { name: 'query', inputSchema: 'query-input.json', outputSchema: 'query-output.json' },
      { name: 'result.read', inputSchema: 'read-input.json', outputSchema: 'read-output.json' },
    ],
  },
  appCapabilities: { provides: [{ protocol, methods: [readMethod] }] },
} as const

describe('cross-App manifest contract', () => {
  it('accepts UI discovery with a declared dependency and Host grant', () => {
    const consumer = validateAppManifest({
      schemaVersion: 2, id: 'fixture.capability-consumer', version: '1.0.0', displayName: 'Consumer',
      hostApi: '^3.18.0', ui: { entry: 'index.html' },
      host: { protocols: ['moss.app-capabilities/v1'] }, permissions: ['apps:invoke'],
      appCapabilities: { requires: [{ protocol }] },
    })
    expect(consumer.backend).toBeUndefined()
    expect(consumer.appCapabilities?.requires).toEqual([{ protocol, optional: false }])
  })

  it('requires an exclusively 3.18+ Host range', () => {
    expect(() => validateAppManifest({ ...manifest, hostApi: '>=3.17.0 <4.0.0' })).toThrow(/hostApi >=3\.18\.0/)
    expect(validateAppManifest(manifest).appCapabilities?.provides?.[0].protocol).toBe(protocol)
  })

  it('requires an explicit target and exact tool names for Host tool calls', () => {
    const consumer = {
      schemaVersion: 2, id: 'fixture.tool-consumer', version: '1.0.0', displayName: 'Tool consumer',
      hostApi: '^3.19.0', ui: { entry: 'index.html' },
      host: { protocols: ['moss.app-capabilities/v1'] }, permissions: ['apps:invoke'],
      appCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['search_objects', 'execute_sql'] }] },
    }
    expect(validateAppManifest(consumer).appCapabilities?.usesTools)
      .toEqual([{ appId: 'moss.database', tools: ['search_objects', 'execute_sql'] }])
    expect(() => validateAppManifest({ ...consumer, hostApi: '^3.18.0' })).toThrow(/hostApi >=3\.19\.0/)
    expect(() => validateAppManifest({ ...consumer, permissions: [] })).toThrow(/consumers require/)
    expect(() => validateAppManifest({ ...consumer, appCapabilities: { usesTools: [{ appId: consumer.id, tools: ['execute_sql'] }] } }))
      .toThrow(/own tools/)
    expect(() => validateAppManifest({ ...consumer, appCapabilities: { usesTools: [
      { appId: 'moss.database', tools: ['execute_sql'] }, { appId: 'moss.database', tools: ['search_objects'] },
    ] } })).toThrow(/Duplicate cross-App tool target/)
    expect(() => validateAppManifest({ ...consumer, appCapabilities: { usesTools: [{ appId: 'moss.database', tools: ['*'] }] } }))
      .toThrow(/Invalid appCapabilities declaration/)
  })

  it('rejects unknown capability fields before normalization can strip them', () => {
    expect(() => validateAppManifest({
      ...manifest,
      appCapabilities: { ...manifest.appCapabilities, require: [{ protocol }] },
    })).toThrow(/Invalid appCapabilities declaration/)
    expect(() => validateAppManifest({
      ...manifest,
      appCapabilities: { provides: [{ protocol, methods: [{ ...readMethod, resourceReadMetod: 'result.read' }] }] },
    })).toThrow(/Invalid appCapabilities declaration/)
  })

  it('requires a result reader to retain the invoking method permission', () => {
    const methods = [
      { name: 'query', action: 'query', permission: 'dataset:read', effect: 'read', resourceReadMethod: 'result.read' },
      { name: 'result.read', action: 'result.read', permission: 'dataset:result:read', effect: 'read' },
    ]
    expect(() => validateAppManifest({
      ...manifest, appCapabilities: { provides: [{ protocol, methods }] },
    })).toThrow(/same permission/)
    expect(validateAppManifest({
      ...manifest, appCapabilities: { provides: [{ protocol, methods: [methods[0], { ...methods[1], permission: 'dataset:read' }] }] },
    }).appCapabilities?.provides?.[0].methods).toHaveLength(2)
  })
})
