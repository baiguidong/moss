import type { AppDiscovery } from './index.mjs'
export const APP_DISCOVERY_GROUPS: readonly { id: 'local' | 'online'; label: string }[]
export const APP_AUTH_METHODS: readonly { id: string; label: string }[]
export function normalizeAppDiscovery(value: unknown): AppDiscovery | undefined
export function getAppDiscovery(app: { id?: string; name?: string; discovery?: AppDiscovery | { group: 'unknown' }; connectorApp?: unknown }): AppDiscovery | { group: 'unknown'; authMethods?: never }
export function connectorIdFromApp(app: unknown): string | null
