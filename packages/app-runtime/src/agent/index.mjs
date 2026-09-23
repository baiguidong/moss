import {
  AGENT_BACKEND_EVENT_PERMISSIONS,
  AGENT_HOST_METHOD_PERMISSIONS,
  MOSS_AGENT_PROTOCOL,
  validateAgentBackendEventData,
  validateAgentHostInput,
  validateAgentHostOutput,
} from '../../../app-sdk/src/index.mjs'

export function createAgentProtocolDefinition(options = {}) {
  return {
    protocol: MOSS_AGENT_PROTOCOL,
    methods: Object.fromEntries(Object.entries(AGENT_HOST_METHOD_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (input) => validateAgentHostInput(name, input),
      validateOutput: (output) => validateAgentHostOutput(name, output),
    }])),
    events: Object.fromEntries(Object.entries(AGENT_BACKEND_EVENT_PERMISSIONS).map(([name, permission]) => [name, {
      permission,
      validateInput: (data) => validateAgentBackendEventData(name, data),
    }])),
    handleRequest: options.handleRequest,
  }
}
