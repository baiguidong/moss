// Display metadata never grants execution, account or filesystem access.
export const APP_DISCOVERY_GROUPS = Object.freeze([
  { id: 'local', label: '本地' },
  { id: 'online', label: '在线' },
])
export const APP_KINDS = Object.freeze([
  { id: 'app', label: '应用' },
  { id: 'tool', label: '工具' },
])
export const APP_TOOL_CAPABILITIES = Object.freeze([
  { id: 'mcp', label: 'MCP' },
  { id: 'cli', label: 'CLI' },
  { id: 'skills', label: 'Skills' },
])
export const APP_AUTH_METHODS = Object.freeze([
  { id: 'browser', label: '浏览器 / 扫码' },
  { id: 'api-key', label: 'API Key' },
  { id: 'credentials', label: '账号凭据' },
  { id: 'moss-session', label: 'Moss 登录态' },
  { id: 'none', label: '无需认证' },
])

// Compatibility metadata for published packages that predate discovery fields.
// Unknown delivery shapes remain discoverable in the application section.
const localApps = new Set(['moss.app-builder', 'moss.audit', 'moss.backup', 'moss.browser-use', 'moss.buddy', 'moss.code-map',
  'moss.computer-use', 'moss.data-workbench', 'moss.database', 'moss.devtools', 'moss.document-converter', 'moss.drawio', 'moss.excel',
  'moss.file-cleaner', 'moss.filesystem', 'moss.git', 'moss.image-tools', 'moss.knowledge-rag', 'moss.library',
  'moss.markitdown', 'moss.mcp', 'moss.media-tools', 'moss.memory', 'moss.pdf-tools', 'moss.self-test', 'moss.sequential-thinking',
  'moss.takt', 'moss.trace', 'moss.transcription', 'moss.workflow'])
const onlineApps = new Set(['moss.drive', 'moss.feishu', 'moss.openim'])
const mcpTools = new Set(['moss.dbx', 'moss.drawio', 'moss.excel', 'moss.filesystem', 'moss.git', 'moss.markitdown', 'moss.sequential-thinking'])

export function normalizeAppDiscovery(value) {
  if (!value || !['local', 'online', 'unknown'].includes(value.group)) return undefined
  const authMethods = Array.isArray(value.authMethods)
    ? [...new Set(value.authMethods.filter(method => APP_AUTH_METHODS.some(item => item.id === method)))] : []
  const capabilities = APP_TOOL_CAPABILITIES.map(item => item.id).filter(id => Array.isArray(value.capabilities) && value.capabilities.includes(id))
  return { group: value.group,
    ...(['app', 'tool'].includes(value.kind) ? { kind: value.kind } : {}),
    ...(capabilities.length ? { capabilities } : {}),
    ...(authMethods.length ? { authMethods } : {}) }
}

export function getAppDiscovery(app) {
  const declared = normalizeAppDiscovery(app?.discovery)
  if (declared) return declared
  const id = app?.id || app?.name
  if (localApps.has(id) || mcpTools.has(id)) return { group: 'local' }
  if (onlineApps.has(id) || app?.connectorApp) return { group: 'online' }
  return { group: 'unknown' }
}

export function getAppKind(app) {
  if (['app', 'tool'].includes(app?.discovery?.kind)) return app.discovery.kind
  if (app?.connectorApp || app?.ui?.builtin === 'mcp') return 'tool'
  if (app?.ui?.entry) return 'app'
  if (app?.mcpApp || mcpTools.has(app?.id || app?.name)) return 'tool'
  if (app?.hasUi || app?.hasBackend || app?.backend || localApps.has(app?.id || app?.name) || onlineApps.has(app?.id || app?.name)) return 'app'
  return 'app'
}

export function getAppToolCapabilities(app) {
  const declared = app?.discovery?.capabilities || app?.connectorApp?.capabilities || []
  const capabilities = new Set(Array.isArray(declared) ? declared : [])
  if (app?.mcpApp || app?.ui?.builtin === 'mcp' || mcpTools.has(app?.id || app?.name)) capabilities.add('mcp')
  if (app?.contributes?.skills?.length) capabilities.add('skills')
  return APP_TOOL_CAPABILITIES.map(item => item.id).filter(id => capabilities.has(id))
}

export function getAppCatalogDiscovery(app) {
  const discovery = getAppDiscovery(app)
  const kind = getAppKind(app)
  const capabilities = getAppToolCapabilities(app)
  return { ...discovery, kind, ...(capabilities.length ? { capabilities } : {}) }
}

export function connectorIdFromApp(app) {
  const id = app?.connectorApp?.id
  return typeof id === 'string' && /^[a-z0-9][a-z0-9_.-]{0,64}$/.test(id) ? id : null
}
