import {
  MOSS_REMOTE_PROTOCOL,
  REMOTE_HOST_METHOD_PERMISSIONS,
  validateRemoteHostInput,
} from '../../../app-sdk/src/index.mjs'

export function createRemoteProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_REMOTE_PROTOCOL,
    methods: Object.fromEntries(Object.entries(REMOTE_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (input) => validateRemoteHostInput(name, input),
    }])),
    events: {},
    handleRequest: options.handleRequest,
  }
}
