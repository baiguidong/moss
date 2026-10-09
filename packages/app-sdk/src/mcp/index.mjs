import { contracts } from '../../../host-contracts/src/index.mjs'
import { validateContract, contractDefinition } from '../host/contracts.mjs'
export const MOSS_MCP_PROTOCOL = 'moss.mcp/v1'
export const MCP_HOST_METHODS = Object.freeze(Object.keys(contracts[MOSS_MCP_PROTOCOL].methods))
export function validateMcpHostInput(method, input) { return validateContract(MOSS_MCP_PROTOCOL, method, 'input', input) }
export function validateMcpHostOutput(method, output) { return validateContract(MOSS_MCP_PROTOCOL, method, 'output', output) }
export function createMcpProtocolDefinition() { return contractDefinition(MOSS_MCP_PROTOCOL) }
export function createMcpClient(host) {
  return { async request(method, input = {}, options) {
    return validateMcpHostOutput(method, await host.request(MOSS_MCP_PROTOCOL, method, validateMcpHostInput(method, input), options))
  } }
}
