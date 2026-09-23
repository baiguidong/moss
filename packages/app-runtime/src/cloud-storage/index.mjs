import { MOSS_CLOUD_STORAGE_PROTOCOL, CLOUD_STORAGE_HOST_METHOD_PERMISSIONS, CLOUD_STORAGE_EVENTS, validateCloudStorageHostInput, validateCloudStorageHostOutput } from '../../../app-sdk/src/index.mjs'
export function createCloudStorageProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_CLOUD_STORAGE_PROTOCOL,
    methods: Object.fromEntries(Object.entries(CLOUD_STORAGE_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission, validateInput: input => validateCloudStorageHostInput(name, input), validateOutput: output => validateCloudStorageHostOutput(name, output),
    }])),
    events: Object.fromEntries(CLOUD_STORAGE_EVENTS.map(name => [name, { permission: 'cloud-storage:read' }])),
    handleRequest: options.handleRequest,
  }
}
