import type { McpConfig } from '../../../packages/app-sdk/src/mcp/index.mjs'

export { expandMcpHomePath } from '../../../packages/app-sdk/src/mcp/directories.mjs'
export function resolveMcpLaunchConfig<Config extends Partial<McpConfig>>(config: Config, options?: { workspace?: string }): Config
export function usesElectronAsNode(command: string | undefined, executable?: string, electron?: boolean): boolean
