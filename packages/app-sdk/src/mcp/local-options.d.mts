import type { McpConfig } from './index.mjs'
export function normalizeMcpLocalOptions(config: Partial<McpConfig>): Pick<McpConfig, 'python' | 'pathBindings'>
export function mcpMinimumHostVersion(config: Partial<McpConfig>): string
