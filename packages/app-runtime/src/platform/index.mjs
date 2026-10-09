import { contractDefinition } from '../../../app-sdk/src/host/contracts.mjs'
export function createPlatformProtocolDefinition(options = {}) {
  return { ...contractDefinition('moss.platform/v1'), handleRequest: options.handleRequest }
}
