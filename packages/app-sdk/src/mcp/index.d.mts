import type { AppHostApi } from '../index.mjs'
import type { McpHostInputMap, McpHostOutputMap } from '../../../host-contracts/src/generated.mjs'
export type { McpConfig, McpTool, McpConnectionCheck, McpServer, McpCatalog, McpHostInputMap, McpHostOutputMap } from '../../../host-contracts/src/generated.mjs'
export const MOSS_MCP_PROTOCOL: 'moss.mcp/v1'
export const MCP_HOST_METHODS: readonly (keyof McpHostInputMap)[]
export function validateMcpHostInput(method: string, input: unknown): Record<string, unknown>
export function validateMcpHostOutput(method: string, output: unknown): unknown
export function createMcpProtocolDefinition(): { protocol: string; methods: Record<string, { permission: string; validateInput(input: unknown): unknown; validateOutput(output: unknown): unknown }> }
export function createMcpClient(host: Pick<AppHostApi, 'request'>): {
  request<Method extends keyof McpHostInputMap>(method: Method, input: McpHostInputMap[Method], options?: Parameters<AppHostApi['request']>[3]): Promise<McpHostOutputMap[Method]>
}
