/**
 * The Messages SDK appends /v1/messages. Desktop settings can include /v1,
 * so normalize the request base consistently for CLI and embedded sessions.
 * Keep the persisted URL unchanged so both clients share the same settings.
 */
export function normalizeMossBaseUrl(value: string | undefined): string | undefined {
  if (!value) return value
  const trimmed = value.trim()
  if (!trimmed) return undefined

  try {
    const url = new URL(trimmed)
    const normalizedPath = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '')
    return `${url.origin}${normalizedPath}${url.search}${url.hash}`
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\/v1$/, '')
  }
}
