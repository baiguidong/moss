import type { McpConfig } from './index.mjs'
type Config = Partial<McpConfig>
export function mcpLocalEnvironment(config: Config, inherited?: NodeJS.ProcessEnv): NodeJS.ProcessEnv
export function validateMcpPathSettings(config: Config): Promise<void>
export function installMcpPathBindings(client: { request: (...args: any[]) => Promise<any> }, config: Config, workspace?: string, environment?: NodeJS.ProcessEnv): void
