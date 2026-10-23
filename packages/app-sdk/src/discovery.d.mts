import type { AppDiscovery } from './index.mjs'
export const APP_DISCOVERY_GROUPS: readonly { id: 'local' | 'online'; label: string }[]
export const APP_AUTH_METHODS: readonly { id: string; label: string }[]
export const APP_KINDS: readonly { id: 'app' | 'tool'; label: string }[]
export const APP_TOOL_CAPABILITIES: readonly { id: 'mcp' | 'cli' | 'skills'; label: string }[]
export type AppDiscoveryMetadata = Omit<AppDiscovery, 'group'> & { group: 'local' | 'online' | 'unknown' }
export function normalizeAppDiscovery(value: unknown): AppDiscoveryMetadata | undefined
export function getAppDiscovery(app: { id?: string; name?: string; discovery?: AppDiscoveryMetadata; connectorApp?: unknown }): AppDiscoveryMetadata
export function connectorIdFromApp(app: unknown): string | null
export function getAppKind(app: unknown): 'app' | 'tool'
export function getAppToolCapabilities(app: unknown): Array<'mcp' | 'cli' | 'skills'>
export function getAppCatalogDiscovery(app: Parameters<typeof getAppDiscovery>[0]): ReturnType<typeof getAppDiscovery> & { kind?: 'app' | 'tool'; capabilities?: Array<'mcp' | 'cli' | 'skills'> }
