import { text, count, boolean, nullable, array, record, method } from './shared.mjs'
const limits = { type: 'object', additionalProperties: { type: 'number' } }
const capability = record({ protocol: text(100), method: text(128), supported: boolean, allowed: boolean, available: boolean, reason: nullable(text()), permission: nullable(text()), limits, surfaces: array({ enum: ['ui','backend'] }, 2) })
export const hostTypes = { HostCapability: capability }
export const hostContracts = { 'moss.host/v1': { types: 'Host', methods: {
  'capabilities.get': method(null, record({ protocols: array(text(100), 100) }, []), record({ capabilities: array(capability, 1000) })),
  'info.get': method(null, record({}), record({ hostApiVersion: text(100), sdkVersion: text(100), manifestSchemaVersion: count, contractHash: text(64), sdkHash: text(64) })),
  'contracts.list': method(null, record({ kind: text(32), offset: count, limit: { ...count, minimum: 1, maximum: 100 } }, []), record({ contractHash: text(64), items: array(record({ kind: text(32), member: text(256) }), 100), nextOffset: nullable(count) })),
  'contracts.get': method(null, record({ kind: text(32), member: text(256), contractHash: text(64) }), record({ kind: text(32), member: text(256), contractHash: text(64), document: { type: 'object', additionalProperties: true } }), { limits: { responseBytes: 256 * 1024 } }),
  'sdk.export': method('apps:author', record({ projectRef: text(160), sdkHash: text(64) }), record({ projectRef: text(160), path: text(), sdkHash: text(64), contractHash: text(64) }), { surfaces: ['backend'] }),
}, events: {} } }
