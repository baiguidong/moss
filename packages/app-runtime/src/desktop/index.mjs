import {
  DESKTOP_HOST_METHOD_PERMISSIONS,
  MOSS_DESKTOP_PROTOCOL,
  validateDesktopHostInput,
} from '../../../app-sdk/src/index.mjs'

export function createDesktopProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_DESKTOP_PROTOCOL,
    methods: Object.fromEntries(Object.entries(DESKTOP_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (input) => validateDesktopHostInput(name, input),
    }])),
    events: {},
    handleRequest: options.handleRequest,
  }
}
