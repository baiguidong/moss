export const PRODUCT_URL = ''

// Remote session Web URLs. Vendor-hosted Web endpoints are intentionally not
// defaulted here; deployments that provide a compatible Web UI must opt in.
export const REMOTE_SESSION_WEB_BASE_URL = ''
export const REMOTE_SESSION_LOCAL_WEB_BASE_URL = 'http://localhost:4000'

function normalizeOptionalBaseUrl(value: string | undefined): string | null {
  const baseUrl = value?.trim()
  return baseUrl ? baseUrl.replace(/\/+$/, '') : null
}

export function getConfiguredRemoteSessionBaseUrl(): string | null {
  return (
    normalizeOptionalBaseUrl(process.env.MOSS_REMOTE_SESSION_BASE_URL) ||
    normalizeOptionalBaseUrl(process.env.MOSS_WEB_BASE_URL)
  )
}

/**
 * Determine if we're in a staging environment for remote sessions.
 * Checks session ID format and ingress URL.
 */
export function isRemoteSessionStaging(
  sessionId?: string,
  ingressUrl?: string,
): boolean {
  return (
    sessionId?.includes('_staging_') === true ||
    ingressUrl?.includes('staging') === true
  )
}

/**
 * Determine if we're in a local-dev environment for remote sessions.
 * Checks session ID format (e.g. `session_local_...`) and ingress URL.
 */
export function isRemoteSessionLocal(
  sessionId?: string,
  ingressUrl?: string,
): boolean {
  return (
    sessionId?.includes('_local_') === true ||
    ingressUrl?.includes('localhost') === true
  )
}

/**
 * Get the configured Web base URL for remote-session links.
 */
export function getRemoteSessionBaseUrl(
  sessionId?: string,
  ingressUrl?: string,
): string {
  if (isRemoteSessionLocal(sessionId, ingressUrl)) {
    return REMOTE_SESSION_LOCAL_WEB_BASE_URL
  }
  return getConfiguredRemoteSessionBaseUrl() ?? REMOTE_SESSION_WEB_BASE_URL
}

/**
 * Get the full session URL for a remote session.
 *
 * Worker APIs may return `cse_*` IDs while compatible frontends route on
 * `session_*`. Preserve that compatibility conversion without defaulting to
 * any vendor-hosted Web service.
 */
export function getRemoteSessionUrl(
  sessionId: string,
  ingressUrl?: string,
): string {
  const compatId = sessionId.startsWith('cse_')
    ? `session_${sessionId.slice('cse_'.length)}`
    : sessionId
  const baseUrl = getRemoteSessionBaseUrl(compatId, ingressUrl)
  return baseUrl ? `${baseUrl}/code/${compatId}` : compatId
}
