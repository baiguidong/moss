/** Display-only ownership, separate from the tool name and model content. */
export function normalizeToolSource(value) {
  if (!value || !['app', 'mcp', 'builtin'].includes(value.kind)) return undefined
  const source = { kind: value.kind }
  for (const key of ['appId', 'appName', 'serverName', 'contributionId']) {
    const item = typeof value[key] === 'string' ? value[key].trim().slice(0, 256) : ''
    if (item) source[key] = item
  }
  if (source.kind === 'app' && !source.appId) return undefined
  if (source.kind === 'mcp' && !source.serverName) return undefined
  return source
}

export function toolSourceMetadata(message) {
  const sources = Object.fromEntries(Object.entries(message?.tool_sources || {}).flatMap(([id, value]) => {
    const source = normalizeToolSource(value)
    return source ? [[id, source]] : []
  }))
  return Object.keys(sources).length ? { tool_sources: sources } : {}
}

export function toolSourceLabel(value) {
  const source = normalizeToolSource(value)
  if (!source) return '来源未记录'
  if (source.kind === 'builtin') return 'Moss 内置'
  return `${source.appName || source.appId || source.serverName} · ${source.kind === 'app' ? 'App' : 'MCP'}`
}
