import {
  MOSS_OPENIM_PROTOCOL,
  OPENIM_BACKEND_EVENT_PERMISSIONS,
  OPENIM_HOST_METHOD_PERMISSIONS,
  validateOpenIMBackendEventData,
  validateOpenIMHostInput,
} from '../../../app-sdk/src/index.mjs'

export function createOpenIMProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_OPENIM_PROTOCOL,
    methods: Object.fromEntries(Object.entries(OPENIM_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (input) => validateOpenIMHostInput(name, input),
    }])),
    events: Object.fromEntries(Object.entries(OPENIM_BACKEND_EVENT_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (data) => validateOpenIMBackendEventData(name, data),
    }])),
    handleRequest: options.handleRequest,
  }
}
