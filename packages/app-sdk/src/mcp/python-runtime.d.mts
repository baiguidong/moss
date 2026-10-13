import type { McpConfig } from './index.mjs'
export function prepareMcpPython(config: Pick<McpConfig, 'command' | 'python'> & { command: string }, options?: { env?: NodeJS.ProcessEnv; signal?: AbortSignal; cacheRoot?: string }): Promise<string>
