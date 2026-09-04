function isValidMcpServerName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name);
}

function assertStringRecord(value, label) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new Error(`${label}.${key} must be a string.`);
    }
    result[key] = item;
  }
  return result;
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
    : [];
}

function normalizeMcpOAuthConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const key of ['clientName', 'clientId', 'redirectUri', 'authorizationServerOrigin', 'resourceMetadataUrl', 'authServerMetadataUrl']) {
    const text = typeof value[key] === 'string' ? value[key].trim() : '';
    if (text) result[key] = text;
  }
  if (Number.isInteger(value.callbackPort) && value.callbackPort > 0) {
    result.callbackPort = value.callbackPort;
  }
  if (typeof value.omitRegistrationScope === 'boolean') {
    result.omitRegistrationScope = value.omitRegistrationScope;
  }
  if (typeof value.xaa === 'boolean') {
    result.xaa = value.xaa;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeMcpServerType(value, config) {
  if (value === undefined || value === null || value === '') {
    if (typeof config?.command === 'string' && config.command.trim()) return 'stdio';
    if (typeof config?.url === 'string' && config.url.trim()) return 'http';
    return 'stdio';
  }
  if (typeof value !== 'string') return value;
  const type = value.trim().toLowerCase();
  if (!type) return normalizeMcpServerType(undefined, config);
  if (type === 'streamable-http' || type === 'streamable_http' || type === 'streamablehttp') {
    return 'http';
  }
  return type;
}

export function validateMcpServerConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('MCP server config must be an object.');
  }

  const type = normalizeMcpServerType(input.type, input);
  if (type === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim()) {
      throw new Error('stdio MCP server requires command.');
    }
    const args = input.args === undefined ? [] : input.args;
    if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) {
      throw new Error('stdio MCP server args must be an array of strings.');
    }
    return {
      type: 'stdio',
      command: input.command.trim(),
      args,
      ...(input.env ? { env: assertStringRecord(input.env, 'env') } : {}),
      ...(normalizeStringList(input.disabledTools).length > 0
        ? { disabledTools: normalizeStringList(input.disabledTools) }
        : {}),
    };
  }

  if (type === 'http' || type === 'sse') {
    if (typeof input.url !== 'string' || !input.url.trim()) {
      throw new Error(`${type} MCP server requires url.`);
    }
    try {
      const parsed = new URL(input.url.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('URL must use http or https.');
      }
    } catch (error) {
      throw new Error(error?.message || 'Invalid MCP server url.');
    }
    const oauth = normalizeMcpOAuthConfig(input.oauth);
    return {
      type,
      url: input.url.trim(),
      ...(input.headers ? { headers: assertStringRecord(input.headers, 'headers') } : {}),
      ...(normalizeStringList(input.disabledTools).length > 0
        ? { disabledTools: normalizeStringList(input.disabledTools) }
        : {}),
      ...(oauth ? { oauth } : {}),
    };
  }

  throw new Error('MCP server type must be stdio, http, streamable-http, or sse.');
}

export function normalizeMcpStore(raw, now = Date.now()) {
  const servers = {};
  const sourceServers = raw && typeof raw === 'object' && raw.servers && typeof raw.servers === 'object'
    ? raw.servers
    : {};

  for (const [name, entry] of Object.entries(sourceServers)) {
    if (!isValidMcpServerName(name)) continue;
    if (!entry || typeof entry !== 'object') continue;
    try {
      const config = validateMcpServerConfig(entry.config);
      servers[name] = {
        enabled: Boolean(entry.enabled),
        config,
        updatedAt: Number.isFinite(entry.updatedAt) ? entry.updatedAt : now,
      };
    } catch {
      // One malformed draft must not make the complete desktop settings unreadable.
    }
  }

  return { version: 1, servers };
}

export { isValidMcpServerName };
