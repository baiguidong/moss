import { text, boolean, nullable, array, record, method } from './shared.mjs'
const limits = { type: 'object', additionalProperties: { type: 'number' } }
const capability = record({ protocol: text(100), method: text(128), supported: boolean, allowed: boolean, available: boolean, reason: nullable(text()), permission: nullable(text()), limits, surfaces: array({ enum: ['ui','backend'] }, 2) })
export const hostTypes = { HostCapability: capability }
export const hostContracts = { 'moss.host/v1': { types: 'Host', methods: {
  'capabilities.get': method(null, record({ protocols: array(text(100), 100) }, []), record({ capabilities: array(capability, 1000) })),
}, events: {} } }
