import {
  PLATFORM_HOST_METHOD_PERMISSIONS,
  MOSS_PLATFORM_PROTOCOL,
  validatePlatformHostInput,
  validatePlatformHostOutput,
} from '../../../app-sdk/src/index.mjs'

export function createPlatformProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_PLATFORM_PROTOCOL,
    methods: Object.fromEntries(Object.entries(PLATFORM_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (input) => validatePlatformHostInput(name, input),
      validateOutput: (output) => validatePlatformHostOutput(name, output),
    }])),
    events: {},
    handleRequest: options.handleRequest,
  }
}
