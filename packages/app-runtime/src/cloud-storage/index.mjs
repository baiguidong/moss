import { contractDefinition } from '../../../app-sdk/src/host/contracts.mjs'
export function createCloudStorageProtocolDefinition(options = {}) {
  return { ...contractDefinition('moss.cloud-storage/v1'), handleRequest: options.handleRequest }
}
