import { APP_ERROR_CODES, AppServiceError } from '../protocol/index.mjs'
import { validateContract, contractDefinition } from '../host/contracts.mjs'
import { executionLimits } from '../../../host-contracts/src/index.mjs'
export const MOSS_AGENT_EXECUTION_PROTOCOL = 'moss.agent-execution/v1'
export const MOSS_TASKS_PROTOCOL = 'moss.tasks/v1'
export function validateExecutionHostInput(protocol, method, input) {
  validateContract(protocol, method, 'input', input)
  if (input.result !== undefined && new TextEncoder().encode(JSON.stringify(input.result)).length > executionLimits.resultPreviewBytes) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Task result exceeds the preview limit')
  }
  return input
}
export function validateExecutionHostOutput(protocol, method, output) { return validateContract(protocol, method, 'output', output) }
export function validateExecutionHostEvent(protocol, name, data) { return validateContract(protocol, name, 'event', data) }
export function createExecutionProtocolDefinitions() {
  return [MOSS_TASKS_PROTOCOL, MOSS_AGENT_EXECUTION_PROTOCOL].map(protocol => {
    const definition = contractDefinition(protocol)
    for (const [method, value] of Object.entries(definition.methods)) value.validateInput = input => validateExecutionHostInput(protocol, method, input)
    return definition
  })
}

function createClient(host, protocol) {
  return Object.freeze({
    async request(method, input = {}, options) {
      const result = await host.request(protocol, method, validateExecutionHostInput(protocol, method, input), options)
      return validateExecutionHostOutput(protocol, method, result)
    },
    on(name, handler) {
      const expected = protocol === MOSS_TASKS_PROTOCOL ? 'task.changed' : 'execution.changed'
      if (name !== expected) throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `Unsupported ${protocol} event: ${name}`)
      return host.on(protocol, name, (data, context) => handler(validateExecutionHostEvent(protocol, name, data), context))
    },
  })
}

export function createExecutionClient(host) { return createClient(host, MOSS_AGENT_EXECUTION_PROTOCOL) }
export function createTasksClient(host) { return createClient(host, MOSS_TASKS_PROTOCOL) }

export { ExecutionWatcher, DEFAULT_EXECUTION_REFRESH_MS } from './watcher.mjs'
