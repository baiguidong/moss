export function normalizeHubApiBaseUrl(rawValue: unknown): string {
  const trimmed = String(rawValue || '')
    .trim()
    .replace(/\/+$/, '')
  if (!trimmed) return ''
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`
}

const DEFAULT_HUB_API_BASE_URL = 'https://sudoclawhub.sudoprivacy.com/api'

let _resolvedBaseUrl: string | undefined
let _resolvedAuth: string | undefined

export function initHubConfig(config?: {
  hubApiBaseUrl?: string
  hubAuthorization?: string
}): void {
  _resolvedBaseUrl = resolveHubApiBaseUrl(config?.hubApiBaseUrl)
  _resolvedAuth = resolveHubAuthorization(config?.hubAuthorization)
  console.info(
    `[HubConfig] API base URL: ${_resolvedBaseUrl}`,
  )
}

export function resolveHubApiBaseUrl(serverConfigBaseUrl?: string): string {
  const configured = normalizeHubApiBaseUrl(serverConfigBaseUrl || '')
  if (configured) return configured

  const fromEnv = normalizeHubApiBaseUrl(
    process.env.MOSS_HUB_API_BASE_URL || process.env.MOSS_HUB_BASE_URL || '',
  )
  return fromEnv || DEFAULT_HUB_API_BASE_URL
}

export function resolveHubAuthorization(serverConfigAuth?: string): string {
  return (
    String(
      serverConfigAuth || process.env.MOSS_HUB_AUTHORIZATION || 'sud0@sudo',
    )
      .trim() || 'sud0@sudo'
  )
}

export function getHubApiBaseUrl(): string {
  return _resolvedBaseUrl ?? resolveHubApiBaseUrl()
}

export function getHubAuthorization(): string {
  return _resolvedAuth ?? resolveHubAuthorization()
}
