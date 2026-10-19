// Display metadata never grants execution, account or filesystem access.
export const APP_DISCOVERY_GROUPS = Object.freeze([
  { id: 'local', label: '本地应用' },
  { id: 'online', label: '在线服务' },
])
export const APP_AUTH_METHODS = Object.freeze([
  { id: 'browser', label: '浏览器 / 扫码' },
  { id: 'api-key', label: 'API Key' },
  { id: 'credentials', label: '账号凭据' },
  { id: 'moss-session', label: 'Moss 登录态' },
  { id: 'none', label: '无需认证' },
])

// Compatibility metadata for published packages that predate discovery fields.
// Unknown Apps remain unclassified and discoverable in All/search.
const localApps = new Set(['moss.app-builder', 'moss.audit', 'moss.browser-use', 'moss.buddy', 'moss.code-map',
  'moss.computer-use', 'moss.database', 'moss.devtools', 'moss.document-converter', 'moss.drawio', 'moss.excel',
  'moss.file-cleaner', 'moss.filesystem', 'moss.git', 'moss.image-tools', 'moss.knowledge-rag', 'moss.library',
  'moss.markitdown', 'moss.mcp', 'moss.memory', 'moss.pdf-tools', 'moss.self-test', 'moss.sequential-thinking',
  'moss.takt', 'moss.trace', 'moss.transcription', 'moss.workflow'])
const onlineApps = new Set(['moss.drive', 'moss.feishu', 'moss.openim'])

export function normalizeAppDiscovery(value) {
  if (!value || !['local', 'online'].includes(value.group)) return undefined
  const authMethods = Array.isArray(value.authMethods)
    ? [...new Set(value.authMethods.filter(method => APP_AUTH_METHODS.some(item => item.id === method)))] : []
  return { group: value.group, ...(authMethods.length ? { authMethods } : {}) }
}

export function getAppDiscovery(app) {
  const declared = normalizeAppDiscovery(app?.discovery)
  if (declared) return declared
  const id = app?.id || app?.name
  if (localApps.has(id)) return { group: 'local' }
  if (onlineApps.has(id) || app?.connectorApp) return { group: 'online' }
  return { group: 'unknown' }
}

export function connectorIdFromApp(app) {
  const id = app?.connectorApp?.id
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_.-]{0,64}$/.test(id) ? id : null
}
