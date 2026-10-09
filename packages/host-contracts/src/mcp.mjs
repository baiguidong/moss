const text = { type: 'string' }, count = { type: 'integer', minimum: 0 }
const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false })
const strings = { type: 'array', items: text }
const stringMap = { type: 'object', additionalProperties: text }
const name = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' }
const config = object({ type: { enum: ['stdio', 'http', 'sse'] }, command: text, args: strings, env: stringMap, url: text, headers: stringMap, disabledTools: strings,
  oauth: object({ clientName: text, clientId: text, redirectUri: text, authorizationServerOrigin: text, resourceMetadataUrl: text, authServerMetadataUrl: text, callbackPort: { type: 'integer', minimum: 1, maximum: 65535 }, omitRegistrationScope: { type: 'boolean' }, xaa: { type: 'boolean' } }),
}, ['type'])
const inputConfig = { ...config, required: [] }
const tool = object({ name: text, description: text, disabled: { type: 'boolean' } }, ['name', 'description', 'disabled'])
const check = object({ state: { enum: ['connected', 'needs-auth', 'authorized', 'unchecked', 'failed'] }, tools: { type: 'array', items: tool }, checkedAt: count, durationMs: { type: 'number', minimum: 0 }, truncated: { type: 'boolean' }, error: text, serverInfo: object({ name: text, version: text }, ['name', 'version']) }, ['state', 'tools', 'checkedAt'])
const server = object({ name, enabled: { type: 'boolean' }, config, updatedAt: count, credentialsMissing: { type: 'boolean' }, check: { anyOf: [check, { type: 'null' }] } }, ['name', 'enabled', 'config', 'updatedAt', 'credentialsMissing', 'check'])
const catalog = object({ servers: { type: 'array', maxItems: 100, items: server }, resetSessionCount: count, skippedBusySessionCount: count }, ['servers'])
export const mcpLimits = Object.freeze({ servers: 100, configBytes: 64 * 1024 })
export const mcpTypes = { McpConfig: config, McpTool: tool, McpConnectionCheck: check, McpServer: server, McpCatalog: catalog }
export const mcpContracts = { 'moss.mcp/v1': { types: 'Mcp', methods: Object.fromEntries([
  ['servers.list', 'mcp:read', object({})],
  ['servers.save', 'mcp:manage', object({ name, previousName: name, enabled: { type: 'boolean' }, config: inputConfig }, ['name', 'enabled', 'config'])],
  ['servers.remove', 'mcp:manage', object({ name }, ['name'])],
  ['servers.set-enabled', 'mcp:manage', object({ name, enabled: { type: 'boolean' } }, ['name', 'enabled'])],
  ['servers.inspect', 'mcp:connect', object({ name }, ['name'])],
  ['auth.start', 'mcp:auth', object({ name }, ['name'])],
  ['auth.clear', 'mcp:auth', object({ name }, ['name'])],
].map(([name, permission, input]) => [name, { permission, input, output: catalog, surfaces: ['ui', 'backend'], limits: mcpLimits, errors: ['APP_INVALID_ACTION_INPUT', 'APP_PERMISSION_DENIED', 'APP_NOT_FOUND', 'APP_CONFLICT', 'APP_RESOURCE_EXHAUSTED', 'APP_ACTION_CANCELED', 'APP_HOST_TIMEOUT'] }])), events: {} } }
