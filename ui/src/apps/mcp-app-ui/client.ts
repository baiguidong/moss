import { createAppClient } from '../../../../packages/app-sdk/src/ui/index.mjs'
import type { AppUiApi } from '../../../../packages/app-sdk/src/index.mjs'
import type { McpHostInputMap } from '../../../../packages/app-sdk/src/mcp/index.mjs'

declare global { interface Window { mossApp?: AppUiApi } }
export const client = window.mossApp ? createAppClient(window.mossApp) : null
export function request<K extends keyof McpHostInputMap>(method: K, input: McpHostInputMap[K]) {
  if (!client) throw new Error('请在 Moss 中打开此应用。')
  return client.host.request('moss.mcp/v1', method, input, { timeoutMs: method === 'auth.start' ? 300_000 : 65_000 })
}
