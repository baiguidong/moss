import {
  MOSS_OPENIM_PROTOCOL,
  OPENIM_HOST_METHOD_PERMISSIONS,
  validateOpenIMHostInput,
  validateOpenIMHostOutput,
} from '../../../app-sdk/src/index.mjs'

export function createOpenIMProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_OPENIM_PROTOCOL,
    methods: Object.fromEntries(Object.entries(OPENIM_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: input => validateOpenIMHostInput(name, input),
      validateOutput: output => validateOpenIMHostOutput(name, output),
    }])),
    events: {},
    handleRequest: options.handleRequest,
  }
}
