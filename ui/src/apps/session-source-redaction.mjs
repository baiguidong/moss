/** Remove credentials before a session leaves the Host. */
export function redactSessionSource(value, key = '', seen = new WeakSet()) {
  if (/token|secret|password|authorization|cookie|api[_-]?key/i.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return value
    .replace(/([?&](?:access_token|refresh_token|token|code|client_secret|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(\b(?:authorization|cookie)\b\s*[:=]\s*)[^\r\n,;]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  const result = Array.isArray(value) ? value.map(item => redactSessionSource(item, '', seen))
    : Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactSessionSource(item, name, seen)]))
  seen.delete(value)
  return result
}
