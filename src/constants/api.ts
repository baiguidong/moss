export function getApiBaseUrl(): string {
  const baseUrl = process.env.MOSS_MODEL_BASE_URL?.trim()
  if (!baseUrl) {
    throw new Error('MOSS_MODEL_BASE_URL must be configured for model API requests')
  }
  return baseUrl.replace(/\/+$/, '')
}

export function getMossServerBaseUrl(): string | null {
  const baseUrl = process.env.MOSS_SERVER_URL?.trim()
  return baseUrl ? baseUrl.replace(/\/+$/, '') : null
}

export function getMossServerApiUrl(path: string): string | null {
  const baseUrl = getMossServerBaseUrl()
  if (!baseUrl) return null
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`
}

export function getMossServerAuthHeaders(): Record<string, string> {
  const token = process.env.MOSS_SERVER_AUTH_TOKEN?.trim()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export const CLAUDE_AI_ORIGIN = 'https://claude.ai'
