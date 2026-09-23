import {
  ACCOUNT_BACKEND_EVENT_PERMISSIONS,
  ACCOUNT_HOST_METHOD_PERMISSIONS,
  MOSS_ACCOUNT_PROTOCOL,
  validateAccountBackendEventData,
  validateAccountHostInput,
  validateAccountHostOutput,
} from '../../../app-sdk/src/index.mjs'

export function createAccountProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_ACCOUNT_PROTOCOL,
    methods: Object.fromEntries(Object.entries(ACCOUNT_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (input) => validateAccountHostInput(name, input),
      validateOutput: (output) => validateAccountHostOutput(name, output),
    }])),
    events: Object.fromEntries(Object.entries(ACCOUNT_BACKEND_EVENT_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (data) => validateAccountBackendEventData(name, data),
    }])),
    handleRequest: options.handleRequest,
  }
}
