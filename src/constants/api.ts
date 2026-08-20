export function getApiBaseUrl(): string {
  const baseUrl = process.env.MOSS_MODEL_BASE_URL?.trim()
  if (!baseUrl) {
    throw new Error('MOSS_MODEL_BASE_URL must be configured for model API requests')
  }
  return baseUrl.replace(/\/+$/, '')
}

function normalizeOptionalBaseUrl(value: string | undefined): string | null {
  const baseUrl = value?.trim()
  return baseUrl ? baseUrl.replace(/\/+$/, '') : null
}

export function getMossWebOrigin(): string | null {
  return normalizeOptionalBaseUrl(process.env.MOSS_WEB_BASE_URL)
}
