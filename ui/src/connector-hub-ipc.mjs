import electron from 'electron';
const { ipcMain, safeStorage } = electron;
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import semver from 'semver';

const MOSS_HOME = path.join(os.homedir(), '.moss');
const MOSS_CONNECTORS_DIR = path.join(MOSS_HOME, 'connectors');
const CONNECTOR_CATALOG_DIR = path.join(MOSS_CONNECTORS_DIR, 'catalog');
const CONNECTOR_INSTALLED_DIR = path.join(MOSS_CONNECTORS_DIR, 'installed');
const CONNECTOR_STATE_DIR = path.join(MOSS_CONNECTORS_DIR, 'state');
const CONNECTOR_CREDENTIALS_FILE = path.join(MOSS_CONNECTORS_DIR, 'credentials.json');
const CONNECTOR_CATALOG_ZIP_NAME = 'workbuddy-connectors-config.zip';
const CONNECTOR_CLOUD_AUTH_PROVIDERS_FILE_NAME = 'cloud-auth-providers.json';
const CONNECTOR_MCP_OVERRIDES_FILE_NAME = 'connector-mcp-overrides.json';
const CONNECTOR_META_FILE = 'connector.json';
const CONNECTOR_STATE_FILE = 'state.json';
const CONNECTOR_AUTH_FILE = 'auth.json';
const MAX_CONNECTOR_ZIP_BYTES = 80 * 1024 * 1024;
const COMMAND_OUTPUT_LIMIT = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120 * 1000;
const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_AUTH_TIMEOUT_MS = 6 * 60 * 1000;
const CLI_STATUS_REFRESH_TIMEOUT_MS = 15 * 1000;
const AUTH_STATUS_POLL_MS = 3000;
const ICON_MIME_TYPES = Object.freeze({
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
});
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readJsonFileAsync(filePath, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFileAsync(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readConnectorCredentials() {
  const data = readJsonFile(CONNECTOR_CREDENTIALS_FILE, {});
  return isPlainObject(data) ? data : {};
}

async function writeConnectorCredentials(data) {
  await writeJsonFileAsync(CONNECTOR_CREDENTIALS_FILE, isPlainObject(data) ? data : {});
  try {
    await fsp.chmod(CONNECTOR_CREDENTIALS_FILE, 0o600);
  } catch {}
}

function encryptConnectorSecret(secret) {
  const text = String(secret || '');
  if (!text) return null;
  try {
    if (safeStorage?.isEncryptionAvailable?.()) {
      return {
        type: 'safeStorage',
        value: safeStorage.encryptString(text).toString('base64'),
      };
    }
  } catch {}
  return {
    type: 'base64',
    value: Buffer.from(text, 'utf8').toString('base64'),
  };
}

function decryptConnectorSecret(record) {
  if (!isPlainObject(record) || typeof record.value !== 'string') return '';
  try {
    if (record.type === 'safeStorage' && safeStorage?.isEncryptionAvailable?.()) {
      return safeStorage.decryptString(Buffer.from(record.value, 'base64'));
    }
    if (record.type === 'base64') {
      return Buffer.from(record.value, 'base64').toString('utf8');
    }
  } catch {}
  return '';
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = normalizeString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function normalizeConnectorCredentialSchema(input) {
  if (!isPlainObject(input) || !Array.isArray(input.fields)) return null;
  const fields = input.fields
    .map((field) => {
      if (!isPlainObject(field)) return null;
      const key = normalizeString(field.key);
      if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key)) return null;
      const type = normalizeString(field.type).toLowerCase() === 'password' ? 'password' : 'text';
      const defaultValue = type === 'password' ? '' : normalizeString(field.defaultValue);
      return {
        key,
        label: normalizeString(field.label) || key,
        labelEn: normalizeString(field.labelEn || field.label_en),
        placeholder: normalizeString(field.placeholder),
        placeholderEn: normalizeString(field.placeholderEn || field.placeholder_en),
        description: normalizeString(field.description),
        descriptionEn: normalizeString(field.descriptionEn || field.description_en),
        type,
        required: field.required !== false,
        ...(defaultValue ? { defaultValue } : {}),
      };
    })
    .filter(Boolean);
  if (fields.length === 0) return null;
  return {
    title: normalizeString(input.title) || '连接器凭据',
    titleEn: normalizeString(input.titleEn || input.title_en),
    description: normalizeString(input.description),
    descriptionEn: normalizeString(input.descriptionEn || input.description_en),
    docUrl: normalizeString(input.docUrl),
    docLabel: normalizeString(input.docLabel),
    docLabelEn: normalizeString(input.docLabelEn || input.docLabel_en),
    fields,
  };
}

function isValidConnectorId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id);
}

function normalizeConnectorId(id) {
  const normalized = normalizeString(id);
  if (!isValidConnectorId(normalized)) {
    throw new Error('Invalid connector id.');
  }
  return normalized;
}

function isValidMcpServerName(name) {
  return typeof name === 'string' && /^[a-zA-Z0-9_-]+$/.test(name);
}

export function normalizeMcpServerName(name, fallback = 'mcp-server') {
  const normalizePart = (value) => normalizeString(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 128);
  return normalizePart(name) || normalizePart(fallback) || 'mcp-server';
}

function assertStringRecord(value, label) {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
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

function normalizeMcpOAuthConfig(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  for (const key of ['clientName', 'clientId', 'authServerMetadataUrl']) {
    const text = normalizeString(value[key]);
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
    if (normalizeString(config?.command)) return 'stdio';
    if (normalizeString(config?.url)) return 'http';
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
  if (!isPlainObject(input)) {
    throw new Error('MCP server config must be an object.');
  }

  const type = normalizeMcpServerType(input.type, input);
  if (type === 'stdio') {
    if (typeof input.command !== 'string' || !input.command.trim()) {
      throw new Error('stdio MCP server requires command.');
    }
    const args = input.args === undefined ? [] : input.args;
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
      throw new Error('stdio MCP server args must be an array of strings.');
    }
    return {
      type: 'stdio',
      command: input.command.trim(),
      args,
      ...(input.env ? { env: assertStringRecord(input.env, 'env') } : {}),
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
      ...(oauth ? { oauth } : {}),
    };
  }

  throw new Error('MCP server type must be stdio, http, streamable-http, or sse.');
}

export function normalizeMcpConfig(input, { fallbackServerName = 'mcp-server' } = {}) {
  const sourceServers = isPlainObject(input?.mcpServers)
    ? input.mcpServers
    : isPlainObject(input)
      ? input
      : {};
  const mcpServers = {};
  const serverNameAliases = {};
  const usedNames = new Set();
  for (const [serverName, config] of Object.entries(sourceServers)) {
    const baseName = isValidMcpServerName(serverName)
      ? serverName
      : normalizeMcpServerName(serverName, fallbackServerName);
    let safeName = baseName;
    let suffix = 2;
    while (usedNames.has(safeName)) {
      const suffixText = `-${suffix}`;
      safeName = `${baseName.slice(0, 128 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    usedNames.add(safeName);
    mcpServers[safeName] = validateMcpServerConfig(config);
    if (safeName !== serverName) serverNameAliases[safeName] = serverName;
  }
  return {
    mcpServers,
    ...(Object.keys(serverNameAliases).length > 0 ? { serverNameAliases } : {}),
  };
}

function normalizeConnectorMcpOverrides(input) {
  const connectors = isPlainObject(input?.connectors) ? input.connectors : {};
  return { connectors };
}

function readConnectorMcpOverrides() {
  return normalizeConnectorMcpOverrides(readJsonFile(localMcpOverridesPath(), {}));
}

function getConnectorMcpOverride(overrides, connectorId) {
  const connectors = isPlainObject(overrides?.connectors) ? overrides.connectors : {};
  const id = normalizeString(connectorId);
  const override = connectors[id];
  return isPlainObject(override) ? override : null;
}

function mergeMcpServerOAuthOverride(config, override) {
  if (!isPlainObject(override?.oauth)) return config;
  return validateMcpServerConfig({
    ...config,
    oauth: {
      ...(isPlainObject(config.oauth) ? config.oauth : {}),
      ...override.oauth,
    },
  });
}

export function normalizeConnectorMcpConfig(connectorId, input, overrides = readConnectorMcpOverrides()) {
  const normalized = normalizeMcpConfig(input, { fallbackServerName: connectorId });
  const connectorOverride = getConnectorMcpOverride(overrides, connectorId);
  if (!connectorOverride) return normalized;

  const defaultServerOverride = isPlainObject(connectorOverride.mcp)
    ? connectorOverride.mcp
    : isPlainObject(connectorOverride.defaults)
      ? connectorOverride.defaults
      : null;
  const serverOverrides = isPlainObject(connectorOverride.servers) ? connectorOverride.servers : {};

  return {
    ...(normalized.serverNameAliases ? { serverNameAliases: normalized.serverNameAliases } : {}),
    mcpServers: Object.fromEntries(
      Object.entries(normalized.mcpServers).map(([serverName, config]) => [
        serverName,
        config.type === 'http' || config.type === 'sse'
          ? mergeMcpServerOAuthOverride(
              mergeMcpServerOAuthOverride(config, defaultServerOverride),
              serverOverrides[serverName],
            )
          : config,
      ]),
    ),
  };
}

function connectorDir(connectorId) {
  return path.join(CONNECTOR_INSTALLED_DIR, normalizeConnectorId(connectorId));
}

function connectorStatePath(connectorId) {
  return path.join(CONNECTOR_STATE_DIR, `${normalizeConnectorId(connectorId)}.json`);
}

function localCatalogZipPath() {
  return path.join(CONNECTOR_CATALOG_DIR, CONNECTOR_CATALOG_ZIP_NAME);
}

function localCloudAuthProvidersPath() {
  return path.join(CONNECTOR_CATALOG_DIR, CONNECTOR_CLOUD_AUTH_PROVIDERS_FILE_NAME);
}

function localMcpOverridesPath() {
  return path.join(CONNECTOR_CATALOG_DIR, CONNECTOR_MCP_OVERRIDES_FILE_NAME);
}

async function ensureConnectorDirs() {
  await Promise.all([
    fsp.mkdir(CONNECTOR_CATALOG_DIR, { recursive: true }),
    fsp.mkdir(CONNECTOR_INSTALLED_DIR, { recursive: true }),
    fsp.mkdir(CONNECTOR_STATE_DIR, { recursive: true }),
  ]);
}

export async function initializeBundledConnectorCatalog({
  bundledCatalogPath,
  bundledCloudAuthPath,
  bundledMcpOverridesPath,
  log,
} = {}) {
  await ensureConnectorDirs();
  const sourcePath = normalizeString(bundledCatalogPath);
  let catalogCopied = false;
  const targetPath = localCatalogZipPath();

  if (sourcePath && fs.existsSync(sourcePath)) {
    const stat = await fsp.stat(sourcePath);
    if (stat.isFile()) {
      if (stat.size > MAX_CONNECTOR_ZIP_BYTES) {
        throw new Error(`Connector catalog is too large (${stat.size} bytes).`);
      }

      await fsp.copyFile(sourcePath, targetPath);
      catalogCopied = true;
      log?.('info', 'connector', 'Bundled connector catalog initialized', {
        source: sourcePath,
        target: targetPath,
        size: stat.size,
      });
    }
  }

  const authSourcePath = normalizeString(bundledCloudAuthPath);
  let cloudAuthCopied = false;
  if (authSourcePath && fs.existsSync(authSourcePath)) {
    const authStat = await fsp.stat(authSourcePath);
    if (authStat.isFile()) {
      const targetAuthPath = localCloudAuthProvidersPath();
      await fsp.copyFile(authSourcePath, targetAuthPath);
      cloudAuthCopied = true;
      log?.('info', 'connector', 'Bundled connector auth providers initialized', {
        source: authSourcePath,
        target: targetAuthPath,
        size: authStat.size,
      });
    }
  }

  const mcpOverridesSourcePath = normalizeString(bundledMcpOverridesPath);
  let mcpOverridesCopied = false;
  if (mcpOverridesSourcePath && fs.existsSync(mcpOverridesSourcePath)) {
    const overridesStat = await fsp.stat(mcpOverridesSourcePath);
    if (overridesStat.isFile()) {
      const targetOverridesPath = localMcpOverridesPath();
      await fsp.copyFile(mcpOverridesSourcePath, targetOverridesPath);
      mcpOverridesCopied = true;
      log?.('info', 'connector', 'Bundled connector MCP overrides initialized', {
        source: mcpOverridesSourcePath,
        target: targetOverridesPath,
        size: overridesStat.size,
      });
    }
  }

  return {
    copied: catalogCopied,
    catalogPath: targetPath,
    cloudAuthCopied,
    cloudAuthPath: localCloudAuthProvidersPath(),
    mcpOverridesCopied,
    mcpOverridesPath: localMcpOverridesPath(),
  };
}

async function loadCatalogZip() {
  const zipPath = localCatalogZipPath();
  const stat = await fsp.stat(zipPath).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`Connector catalog not found: ${zipPath}`);
  }
  if (stat.size > MAX_CONNECTOR_ZIP_BYTES) {
    throw new Error(`Connector catalog is too large (${stat.size} bytes).`);
  }
  const buffer = await fsp.readFile(zipPath);
  const zip = await JSZip.loadAsync(buffer);
  const manifestEntry = zip.file('.codebuddy-connector/connectors.json');
  if (!manifestEntry) {
    throw new Error('Connector catalog manifest is missing.');
  }
  const manifest = JSON.parse(await manifestEntry.async('string'));
  const connectors = Array.isArray(manifest.connectors) ? manifest.connectors : [];
  return { zip, manifest, connectors, zipPath, updatedAt: stat.mtimeMs };
}

function zipHasEntry(zip, entryPath) {
  return Boolean(zip.file(entryPath));
}

function zipHasPrefix(zip, prefix) {
  return Object.values(zip.files).some((entry) => entry.name.startsWith(prefix) && !entry.dir);
}

function findConnectorIconEntry(zip, connector) {
  const candidates = [connector.id, connector.source, connector.providerId]
    .map((item) => normalizeString(item))
    .filter(Boolean);
  for (const name of candidates) {
    for (const ext of Object.keys(ICON_MIME_TYPES)) {
      const entryPath = `icons/${name}${ext}`;
      const entry = zip.file(entryPath);
      if (entry) return entry;
    }
  }
  return null;
}

async function readConnectorIconDataUrl(zip, connector) {
  const entry = findConnectorIconEntry(zip, connector);
  if (!entry) return '';
  const ext = path.extname(entry.name).toLowerCase();
  const mime = ICON_MIME_TYPES[ext];
  if (!mime) return '';
  const buffer = await entry.async('nodebuffer');
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

async function readZipJson(zip, entryPath, fallback = null) {
  const entry = zip.file(entryPath);
  if (!entry) return fallback;
  return JSON.parse(await entry.async('string'));
}

async function addConnectorIcon(zip, connector) {
  return {
    ...connector,
    icon: await readConnectorIconDataUrl(zip, connector),
  };
}

function normalizeConnectorType(raw, hasMcp, hasCli) {
  const type = normalizeString(raw?.type).toLowerCase();
  if (type === 'mcp' || type === 'cli') return type;
  if (hasMcp) return 'mcp';
  if (hasCli) return 'cli';
  return 'unknown';
}

function normalizeConnectorAuthConfig(...sources) {
  const candidates = [];
  for (const source of sources) {
    if (!isPlainObject(source)) continue;
    candidates.push(source);
    for (const key of ['auth', 'auth_config', 'mcp_auth', 'oauth', 'provider_auth']) {
      if (isPlainObject(source[key])) candidates.push(source[key]);
    }
  }

  for (const candidate of candidates) {
    const authUrl = normalizeString(
      candidate.authUrl ||
      candidate.auth_url ||
      candidate.authorizationUrl ||
      candidate.authorization_url ||
      candidate.oauthUrl ||
      candidate.oauth_url,
    );
    if (!authUrl) continue;

    let parsed;
    try {
      parsed = new URL(authUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
    } catch {
      continue;
    }

    const explicitAllowedHosts = normalizeStringList(
      candidate.allowedHosts ||
      candidate.allowed_hosts ||
      candidate.callbackHosts ||
      candidate.callback_hosts ||
      candidate.captureHosts ||
      candidate.capture_hosts,
    );
    const allowedHosts = explicitAllowedHosts.length > 0 ? explicitAllowedHosts : [parsed.hostname];
    return {
      authUrl,
      tokenParam: normalizeString(
        candidate.tokenParam ||
        candidate.token_param ||
        candidate.accessTokenParam ||
        candidate.access_token_param,
      ) || 'access_token',
      allowedHosts,
    };
  }
  return null;
}

function readCloudAuthProviders() {
  const data = readJsonFile(localCloudAuthProvidersPath(), {});
  const providers = Array.isArray(data?.providers) ? data.providers : [];
  return providers
    .map((entry) => {
      if (!isPlainObject(entry)) return null;
      const authConfig = normalizeConnectorAuthConfig(entry);
      if (!authConfig) return null;
      return {
        ...authConfig,
        providerId: normalizeString(entry.provider_id || entry.providerId || entry.id),
        providerIds: normalizeStringList(entry.provider_ids || entry.providerIds),
        connectorIds: normalizeStringList(entry.connector_ids || entry.connectorIds || entry.connectors),
      };
    })
    .filter(Boolean);
}

function findCloudAuthProvider(connector) {
  const connectorId = normalizeString(connector?.connectorId || connector?.id);
  const providerId = normalizeString(connector?.providerId);
  if (!connectorId && !providerId) return null;
  for (const provider of readCloudAuthProviders()) {
    if (connectorId && provider.connectorIds.includes(connectorId)) return provider;
    if (providerId && provider.providerId === providerId) return provider;
    if (providerId && provider.providerIds.includes(providerId)) return provider;
  }
  return null;
}

function normalizeConnectorManifest(raw, zip) {
  if (!isPlainObject(raw)) return null;
  const id = normalizeString(raw.id || raw.source);
  if (!isValidConnectorId(id)) return null;
  const source = normalizeString(raw.source) || id;
  const prefix = `connectors/${source}/`;
  const hasMcp = zipHasEntry(zip, `${prefix}mcp.json`);
  const hasCli = zipHasEntry(zip, `${prefix}cli.json`);
  const hasSkills = zipHasPrefix(zip, `${prefix}skills/`);
  const hasCredentialSchema = zipHasEntry(zip, `${prefix}token-schema.json`);
  const type = normalizeConnectorType(raw, hasMcp, hasCli);
  const examples = normalizeStringList(raw.examples_zh).length > 0
    ? normalizeStringList(raw.examples_zh)
    : normalizeStringList(raw.examples_en);

  return {
    id,
    source,
    name: normalizeString(raw.name) || id,
    nameEn: normalizeString(raw.name_en),
    description: normalizeString(raw.description_zh || raw.description) || '',
    descriptionEn: normalizeString(raw.description_en),
    type,
    authMode: normalizeString(raw.auth_mode),
    providerId: normalizeString(raw.provider_id),
    authConfig: normalizeConnectorAuthConfig(raw),
    minWorkbuddyVersion: normalizeString(raw.minWorkbuddyVersion),
    visibleIn: normalizeStringList(raw.visible_in),
    examples,
    hasMcp,
    hasCli,
    hasSkills,
    hasCredentialSchema,
  };
}

function parseSkillFrontmatterName(content, fallbackName) {
  const match = /^---\s*\n([\s\S]*?)\n---/.exec(content || '');
  if (!match) return fallbackName;
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const item = /^name:\s*(.+?)\s*$/.exec(line);
    if (!item) continue;
    const value = item[1].trim().replace(/^['"]|['"]$/g, '');
    if (isValidConnectorId(value)) return value;
  }
  return fallbackName;
}

function isPathInsideDir(rootDir, targetPath) {
  const relativePath = path.relative(path.resolve(rootDir), path.resolve(targetPath));
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isUnsafeZipEntryPath(entryPath) {
  if (!entryPath || entryPath === '.') return false;
  if (/^[a-zA-Z]:[\\/]/.test(entryPath)) return true;
  if (entryPath.startsWith('/') || entryPath.startsWith('\\')) return true;
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  return normalized === '..' || normalized.startsWith('../');
}

function resolveSafeZipEntryPath(targetDir, entryPath) {
  if (isUnsafeZipEntryPath(entryPath)) return null;
  const normalized = entryPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized) return null;
  const fullPath = path.resolve(targetDir, normalized);
  return isPathInsideDir(targetDir, fullPath) ? fullPath : null;
}

async function extractZipPrefix(zip, prefix, targetDir) {
  let count = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !entry.name.startsWith(prefix)) continue;
    const relativePath = entry.name.slice(prefix.length);
    const targetPath = resolveSafeZipEntryPath(targetDir, relativePath);
    if (!targetPath) continue;
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    await fsp.writeFile(targetPath, await entry.async('nodebuffer'));
    count += 1;
  }
  return count;
}

async function extractConnectorSkill(zip, connector, targetDir, installedAt) {
  const skillPrefix = `connectors/${connector.source}/skills/`;
  const skillEntries = Object.values(zip.files)
    .filter((entry) => !entry.dir && entry.name.startsWith(skillPrefix) && entry.name.endsWith('/SKILL.md'))
    .sort((a, b) => {
      const rootPath = `${skillPrefix}SKILL.md`;
      if (a.name === rootPath) return -1;
      if (b.name === rootPath) return 1;
      return a.name.localeCompare(b.name);
    });
  if (skillEntries.length === 0) return [];

  const installedSkills = [];
  const usedNames = new Set();
  for (const skillMdEntry of skillEntries) {
    const skillContent = await skillMdEntry.async('string');
    const relativeDir = path.posix.dirname(skillMdEntry.name.slice(skillPrefix.length));
    const fallbackSuffix = relativeDir === '.'
      ? connector.id
      : normalizeMcpServerName(relativeDir.replaceAll('/', '-'), connector.id);
    const baseName = parseSkillFrontmatterName(skillContent, `connector-${fallbackSuffix}`);
    let skillName = baseName;
    let suffix = 2;
    while (usedNames.has(skillName)) {
      skillName = `${baseName}-${suffix}`;
      suffix += 1;
    }
    usedNames.add(skillName);

    const sourcePrefix = relativeDir === '.' ? skillPrefix : `${skillPrefix}${relativeDir}/`;
    const skillDir = path.join(targetDir, '.moss', 'skills', skillName);
    await extractZipPrefix(zip, sourcePrefix, skillDir);
    await writeJsonFileAsync(path.join(skillDir, '_moss_meta.json'), {
      name: skillName,
      display_name: connector.name,
      description: connector.description,
      source_type: 'connector',
      connector_id: connector.id,
      connector_type: connector.type,
      enabled: true,
      installed_at: installedAt,
    });
    installedSkills.push({ name: skillName, path: skillDir });
  }
  return installedSkills;
}

async function readConnectorRuntimeState(connectorId) {
  const id = normalizeConnectorId(connectorId);
  const state = await readJsonFileAsync(connectorStatePath(id), null);
  if (isPlainObject(state)) return state;

  const baseDir = connectorDir(id);
  const legacyState = await readJsonFileAsync(path.join(baseDir, CONNECTOR_STATE_FILE), null);
  const legacyAuth = await readJsonFileAsync(path.join(baseDir, CONNECTOR_AUTH_FILE), null);
  if (!isPlainObject(legacyState) && !isPlainObject(legacyAuth)) return {};
  return {
    ...(isPlainObject(legacyState) ? legacyState : {}),
    ...(isPlainObject(legacyAuth) ? { connected: Boolean(legacyAuth.connected) } : {}),
  };
}

async function writeConnectorRuntimeState(connectorId, state) {
  const id = normalizeConnectorId(connectorId);
  const next = {
    ...state,
    connectorId: id,
    updatedAt: new Date().toISOString(),
  };
  await writeJsonFileAsync(connectorStatePath(id), next);
  return next;
}

async function updateConnectorRuntimeState(connectorId, patch) {
  const current = await readConnectorRuntimeState(connectorId);
  return writeConnectorRuntimeState(connectorId, { ...current, ...patch });
}

async function readInstalledConnector(connectorId) {
  const id = normalizeConnectorId(connectorId);
  const baseDir = connectorDir(id);
  const meta = await readJsonFileAsync(path.join(baseDir, CONNECTOR_META_FILE), null);
  if (!isPlainObject(meta)) return null;
  const state = await readConnectorRuntimeState(id);
  const mcp = await readJsonFileAsync(path.join(baseDir, 'mcp.json'), null);
  const cli = await readJsonFileAsync(path.join(baseDir, 'cli.json'), null);
  const credentialSchema = normalizeConnectorCredentialSchema(
    meta.credentialSchema || await readJsonFileAsync(path.join(baseDir, 'token-schema.json'), null),
  );
  const credentialValues = credentialSchema ? readConnectorCredentialValues(id) : {};
  const credentialsConfigured = connectorCredentialsConfigured(credentialSchema, credentialValues);
  const skillRoot = path.join(baseDir, '.moss', 'skills');
  return {
    ...meta,
    installed: true,
    enabled: meta.enabled !== false,
    connected: Boolean(state?.connected) && credentialsConfigured,
    setupStatus: normalizeString(state?.setupStatus || meta.setupStatus) || (
      credentialSchema && !credentialsConfigured
        ? 'needs-credentials'
        : meta.type === 'cli' || meta.requiresCliSetup
          ? 'pending'
          : 'installed'
    ),
    setupMessage: normalizeString(state?.setupMessage),
    setupUpdatedAt: normalizeString(state?.updatedAt),
    path: baseDir,
    skillRoot: fs.existsSync(skillRoot) ? skillRoot : '',
    mcpServerNames: isPlainObject(mcp?.mcpServers) ? Object.keys(mcp.mcpServers) : normalizeStringList(meta.mcpServerNames),
    hasMcp: Boolean(mcp?.mcpServers || meta.hasMcp),
    hasCli: Boolean(cli || meta.hasCli),
    credentialSchema,
    configuredFields: credentialSchema
      ? credentialSchema.fields.map((field) => field.key).filter((key) => Boolean(credentialValues[key]))
      : [],
    credentialsConfigured,
  };
}

async function listInstalledConnectorMap() {
  await ensureConnectorDirs();
  const map = new Map();
  let entries = [];
  try {
    entries = await fsp.readdir(CONNECTOR_INSTALLED_DIR, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const connector = await readInstalledConnector(entry.name);
      if (connector?.id) map.set(connector.id, connector);
    } catch {}
  }
  return map;
}

export async function listInstalledConnectors() {
  const installed = await listInstalledConnectorMap();
  return Array.from(installed.values())
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'));
}

export async function listConnectorCatalog() {
  const { zip, connectors, zipPath, updatedAt } = await loadCatalogZip();
  const installed = await listInstalledConnectorMap();
  const normalizedBase = connectors
    .map((entry) => normalizeConnectorManifest(entry, zip))
    .filter(Boolean);
  const normalized = await Promise.all(normalizedBase.map(async (connector) => {
    const connectorWithIcon = await addConnectorIcon(zip, connector);
    const installedRecord = installed.get(connector.id);
    return {
      ...connectorWithIcon,
      installed: Boolean(installedRecord),
      enabled: installedRecord?.enabled ?? false,
      connected: installedRecord?.connected ?? false,
      setupStatus: installedRecord?.setupStatus || '',
      installedAt: installedRecord?.installedAt || null,
      mcpServerNames: normalizeStringList(installedRecord?.mcpServerNames),
    };
  }));
  const iconById = new Map(normalized.map((connector) => [connector.id, connector.icon || '']));
  const installedWithIcons = Array.from(installed.values()).map((connector) => ({
    ...connector,
    icon: connector.icon || iconById.get(connector.id) || '',
  }));
  return {
    connectors: normalized,
    installed: installedWithIcons,
    catalogPath: zipPath,
    installedDir: CONNECTOR_INSTALLED_DIR,
    updatedAt,
  };
}

function getPlatformCommand(value, label) {
  if (typeof value === 'string') return value.trim();
  if (!isPlainObject(value)) return '';
  const platformCommand = normalizeString(value[process.platform]);
  if (platformCommand) return platformCommand;
  const fallback = normalizeString(value.default || value.fallback);
  if (fallback) return fallback;
  if (label) throw new Error(`${label} is not configured for ${process.platform}.`);
  return '';
}

function normalizeVersionRange(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^[~^<>=*]/.test(raw)) return raw;
  return `>=${raw}`;
}

function coerceVersion(value) {
  return semver.coerce(String(value || ''), { loose: true })?.version || '';
}

function versionSatisfies(version, range) {
  const coerced = coerceVersion(version);
  const normalizedRange = normalizeVersionRange(range);
  if (!coerced || !normalizedRange) return false;
  return semver.satisfies(coerced, normalizedRange, { loose: true });
}

function redactUrl(value) {
  try {
    const url = new URL(value);
    const suffix = url.search || url.hash ? '?<redacted>' : '';
    return `${url.origin}${url.pathname}${suffix}`;
  } catch {
    return '<redacted-url>';
  }
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/\b((?:access|refresh|id)?_?token|password|passwd|secret|credential|authorization|code)=([^&\s]+)/gi, '$1=<redacted>')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactUrl(url));
}

function extractAccessToken(value) {
  const raw = normalizeString(value);
  if (!raw) return '';
  if (/^[A-Za-z0-9._~+/=-]{16,}$/.test(raw) && !raw.includes('://')) return raw;
  try {
    const url = new URL(raw);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    return normalizeString(url.searchParams.get('access_token') || hashParams.get('access_token'));
  } catch {
    const match = /(?:^|[?#&])access_token=([^&#\s]+)/.exec(raw);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

function connectorCredentialKey(connectorId, serverName) {
  return `${normalizeConnectorId(connectorId)}:${normalizeString(serverName)}`;
}

function readConnectorMcpAccessToken(connectorId, serverName) {
  const credentials = readConnectorCredentials();
  const record = credentials?.mcpAccessTokens?.[connectorCredentialKey(connectorId, serverName)];
  return decryptConnectorSecret(record);
}

function readConnectorCredentialValues(connectorId) {
  const id = normalizeConnectorId(connectorId);
  const credentials = readConnectorCredentials();
  const records = credentials?.connectorFields?.[id];
  if (!isPlainObject(records)) return {};
  const values = {};
  for (const [key, record] of Object.entries(records)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key)) continue;
    const value = decryptConnectorSecret(record);
    if (value) values[key] = value;
  }
  return values;
}

function connectorCredentialsConfigured(schema, values) {
  if (!schema) return true;
  return schema.fields.every((field) => !field.required || Boolean(normalizeString(values[field.key])));
}

function replaceCredentialReferences(value, values) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    ))
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    ))
    .replace(/%([a-zA-Z_][a-zA-Z0-9_]*)%/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    ));
}

export function applyConnectorCredentials(config, values) {
  if (!isPlainObject(config) || !isPlainObject(values)) return config;
  const resolved = {
    ...config,
    ...(typeof config.url === 'string'
      ? { url: replaceCredentialReferences(config.url, values) }
      : {}),
    ...(typeof config.command === 'string'
      ? { command: replaceCredentialReferences(config.command, values) }
      : {}),
    ...(Array.isArray(config.args)
      ? { args: config.args.map((arg) => replaceCredentialReferences(arg, values)) }
      : {}),
    ...(isPlainObject(config.headers)
      ? {
          headers: Object.fromEntries(
            Object.entries(config.headers).map(([key, value]) => [
              key,
              replaceCredentialReferences(value, values),
            ]),
          ),
        }
      : {}),
  };
  if (config.type === 'stdio') {
    resolved.env = {
      ...(isPlainObject(config.env)
        ? Object.fromEntries(
            Object.entries(config.env).map(([key, value]) => [
              key,
              replaceCredentialReferences(value, values),
            ]),
          )
        : {}),
      ...values,
    };
  }
  return resolved;
}

export function getConnectorCredentialEnv(connectorIds) {
  const env = {};
  for (const connectorId of normalizeStringList(connectorIds)) {
    if (!isValidConnectorId(connectorId)) continue;
    Object.assign(env, readConnectorCredentialValues(connectorId));
  }
  return env;
}

export async function saveConnectorCredentials(connectorId, inputValues) {
  const id = normalizeConnectorId(connectorId);
  const baseDir = connectorDir(id);
  const schema = normalizeConnectorCredentialSchema(
    await readJsonFileAsync(path.join(baseDir, 'token-schema.json'), null),
  );
  if (!schema) throw new Error(`Connector has no credential schema: ${id}`);
  if (!isPlainObject(inputValues)) throw new Error('Connector credentials must be an object.');

  const credentials = readConnectorCredentials();
  const connectorFields = isPlainObject(credentials.connectorFields)
    ? { ...credentials.connectorFields }
    : {};
  const existingRecords = isPlainObject(connectorFields[id]) ? connectorFields[id] : {};
  const nextRecords = { ...existingRecords };
  const allowedFields = new Map(schema.fields.map((field) => [field.key, field]));
  for (const [key, rawValue] of Object.entries(inputValues)) {
    const field = allowedFields.get(key);
    if (!field || typeof rawValue !== 'string') continue;
    const value = rawValue;
    if (!value.trim()) continue;
    const encrypted = encryptConnectorSecret(value);
    if (!encrypted) continue;
    nextRecords[key] = {
      ...encrypted,
      connectorId: id,
      field: key,
      updatedAt: new Date().toISOString(),
    };
  }

  const nextValues = {};
  for (const field of schema.fields) {
    const value = decryptConnectorSecret(nextRecords[field.key]);
    if (value) nextValues[field.key] = value;
    else if (field.defaultValue) {
      const encrypted = encryptConnectorSecret(field.defaultValue);
      if (encrypted) {
        nextRecords[field.key] = {
          ...encrypted,
          connectorId: id,
          field: field.key,
          updatedAt: new Date().toISOString(),
        };
        nextValues[field.key] = field.defaultValue;
      }
    }
  }
  const missing = schema.fields
    .filter((field) => field.required && !normalizeString(nextValues[field.key]))
    .map((field) => field.label || field.key);
  if (missing.length > 0) {
    throw new Error(`请填写必填凭据：${missing.join('、')}`);
  }

  connectorFields[id] = nextRecords;
  await writeConnectorCredentials({ ...credentials, connectorFields });
  const state = await updateConnectorRuntimeState(id, {
    connected: true,
    setupStatus: 'connected',
    setupMessage: '连接器凭据已配置',
  });
  return {
    ok: true,
    connectorId: id,
    configuredFields: Object.keys(nextValues),
    state,
  };
}

function withMcpAccessToken(config, token) {
  const accessToken = normalizeString(token);
  if (!accessToken || !isPlainObject(config) || typeof config.url !== 'string') return config;
  try {
    const url = new URL(config.url);
    url.searchParams.set('access_token', accessToken);
    return {
      ...config,
      url: url.toString(),
    };
  } catch {
    return config;
  }
}

export function getConnectorProviderAuthUrl(connector) {
  const authConfig = normalizeConnectorAuthConfig(connector?.authConfig, connector) || findCloudAuthProvider(connector);
  return normalizeString(authConfig?.authUrl);
}

export function getConnectorProviderAuthContext(connector) {
  const authConfig = normalizeConnectorAuthConfig(connector?.authConfig, connector) || findCloudAuthProvider(connector);
  if (!authConfig?.authUrl) return null;
  return {
    tokenParam: normalizeString(authConfig.tokenParam) || 'access_token',
    allowedHosts: normalizeStringList(authConfig.allowedHosts),
  };
}

export async function saveConnectorMcpAccessToken(connectorId, serverName, value) {
  const id = normalizeConnectorId(connectorId);
  const name = normalizeString(serverName);
  if (!isValidMcpServerName(name)) throw new Error('Invalid MCP server name.');
  const token = extractAccessToken(value);
  if (!token) throw new Error('No access token found.');
  const encrypted = encryptConnectorSecret(token);
  if (!encrypted) throw new Error('No access token found.');
  const credentials = readConnectorCredentials();
  await writeConnectorCredentials({
    ...credentials,
    mcpAccessTokens: {
      ...(isPlainObject(credentials.mcpAccessTokens) ? credentials.mcpAccessTokens : {}),
      [connectorCredentialKey(id, name)]: {
        ...encrypted,
        connectorId: id,
        serverName: name,
        updatedAt: new Date().toISOString(),
      },
    },
  });
  const state = await updateConnectorMcpAuthState(id, {
    connected: true,
    setupStatus: 'connected',
    setupMessage: '连接器已授权',
  });
  return { ok: true, connectorId: id, serverName: name, state };
}

export async function clearConnectorMcpAccessToken(connectorId, serverName) {
  const id = normalizeConnectorId(connectorId);
  const name = normalizeString(serverName);
  const credentials = readConnectorCredentials();
  const tokens = isPlainObject(credentials.mcpAccessTokens) ? { ...credentials.mcpAccessTokens } : {};
  delete tokens[connectorCredentialKey(id, name)];
  await writeConnectorCredentials({
    ...credentials,
    mcpAccessTokens: tokens,
  });
  return updateConnectorMcpAuthState(id, {
    connected: false,
    setupStatus: 'needs-auth',
    setupMessage: '连接器授权已清除',
  });
}

function appendLimitedOutput(current, chunk) {
  const next = `${current}${chunk}`;
  return next.length > COMMAND_OUTPUT_LIMIT ? next.slice(next.length - COMMAND_OUTPUT_LIMIT) : next;
}

function cleanUrlCandidate(value) {
  return String(value || '').replace(/[),.;\]}>"'，。；）】》]+$/g, '');
}

function extractAuthorizationUrl(text, domain) {
  const urls = String(text || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const normalizedDomain = normalizeString(domain).toLowerCase();
  for (const rawUrl of urls) {
    const candidate = cleanUrlCandidate(rawUrl);
    if (!normalizedDomain) return candidate;
    try {
      const parsed = new URL(candidate);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`)) {
        return candidate;
      }
    } catch {}
  }
  return '';
}

function connectorCommandEnv(extraEnv = {}) {
  return {
    ...process.env,
    ...extraEnv,
    MOSS_CONNECTOR_SETUP: '1',
  };
}

function expandEnvReferences(value, env) {
  return String(value || '')
    .replace(/\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, key) => env[key] ?? '')
    .replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, key) => env[key] ?? '')
    .replace(/%([a-zA-Z_][a-zA-Z0-9_]*)%/g, (_match, key) => env[key] ?? '');
}

export function buildConnectorCliEnv(cli, baseDir, connectorId, baseEnv = process.env) {
  const id = normalizeConnectorId(connectorId);
  const home = normalizeString(baseEnv.HOME || baseEnv.USERPROFILE) || os.homedir();
  const env = {
    ...baseEnv,
    HOME: normalizeString(baseEnv.HOME) || home,
    USERPROFILE: normalizeString(baseEnv.USERPROFILE) || home,
    MOSS_CONNECTOR_ID: id,
    MOSS_CONNECTOR_HOME: baseDir,
    MOSS_CONNECTOR_SETUP: '1',
  };
  const declaredEnv = isPlainObject(cli?.env) ? cli.env : {};
  for (const [key, rawValue] of Object.entries(declaredEnv)) {
    if (typeof rawValue !== 'string') continue;
    let value = expandEnvReferences(rawValue, env);
    if (/CONNECTOR_HOME$/i.test(key) && /connectors-marketplace[\\/]connectors/i.test(rawValue)) {
      value = baseDir;
    }
    env[key] = value;
  }

  const pathEntries = [
    path.join(baseDir, 'bin'),
    path.join(baseDir, 'cli'),
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
    baseEnv.APPDATA ? path.join(baseEnv.APPDATA, 'npm') : '',
    normalizeString(env.PATH),
  ].filter(Boolean);
  env.PATH = Array.from(new Set(pathEntries)).join(path.delimiter);
  return env;
}

function runConnectorCommand(command, {
  cwd,
  timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  env = connectorCommandEnv(),
  onOutput,
} = {}) {
  const normalizedCommand = normalizeString(command);
  if (!normalizedCommand) {
    return Promise.resolve({
      code: 0,
      signal: null,
      stdout: '',
      stderr: '',
      output: '',
    });
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let output = '';
    let settled = false;
    let timedOut = false;

    const child = spawn(normalizedCommand, {
      cwd,
      env,
      shell: true,
      windowsHide: true,
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code: result.code ?? null,
        signal: result.signal ?? null,
        stdout,
        stderr,
        output,
        timedOut,
        error: result.error,
      });
    };

    const consume = (stream, chunk) => {
      const text = chunk.toString();
      if (stream === 'stdout') stdout = appendLimitedOutput(stdout, text);
      if (stream === 'stderr') stderr = appendLimitedOutput(stderr, text);
      output = appendLimitedOutput(output, text);
      onOutput?.(text, stream);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {}
      setTimeout(() => {
        if (!settled) {
          try {
            child.kill('SIGKILL');
          } catch {}
        }
      }, 1500);
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => consume('stdout', chunk));
    child.stderr?.on('data', (chunk) => consume('stderr', chunk));
    child.on('error', (error) => finish({ code: null, signal: null, error }));
    child.on('close', (code, signal) => finish({ code, signal }));
  });
}

async function checkNodeRuntime(runtime, baseDir, env) {
  if (!isPlainObject(runtime) || normalizeString(runtime.type).toLowerCase() !== 'node') {
    return { ok: true, version: '', message: '不需要 Node runtime 检查' };
  }
  const range = normalizeString(runtime.version);
  const result = await runConnectorCommand('node --version', {
    cwd: baseDir,
    env,
    timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
  });
  const version = coerceVersion(result.output);
  if (result.code !== 0 || !version) {
    throw new Error('未检测到可用的 Node.js runtime。');
  }
  if (range && !versionSatisfies(version, range)) {
    throw new Error(`Node.js ${version} 不满足连接器要求 ${range}。`);
  }
  return { ok: true, version, message: `Node.js ${version}` };
}

async function runCliVersionCheck(cli, baseDir, env) {
  const command = getPlatformCommand(cli?.versionCheck?.command, 'versionCheck.command');
  const minVersion = normalizeString(cli?.versionCheck?.minVersion);
  if (!command) {
    return { checked: false, installed: false, version: '', satisfies: false };
  }
  const result = await runConnectorCommand(command, {
    cwd: baseDir,
    env,
    timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
  });
  const version = coerceVersion(result.output);
  const satisfies = result.code === 0 && (!minVersion || versionSatisfies(version, minVersion));
  return {
    checked: true,
    installed: result.code === 0,
    version,
    satisfies,
    minVersion,
  };
}

async function runCliStatus(cli, baseDir, env, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS) {
  const command = getPlatformCommand(cli?.status, 'status');
  if (!command) return { checked: false, connected: false, output: '' };
  const result = await runConnectorCommand(command, {
    cwd: baseDir,
    env,
    timeoutMs,
  });
  const output = result.output || `${result.stdout || ''}${result.stderr || ''}`;
  return {
    checked: true,
    connected: result.code === 0 && matchesCliStatus(cli, output),
    code: result.code,
    output,
  };
}

export function cliStatusStatePatch(connected) {
  return connected
    ? {
        connected: true,
        setupStatus: 'connected',
        setupMessage: '连接器可用',
      }
    : {
        connected: false,
        setupStatus: 'needs-auth',
        setupMessage: 'CLI 未认证',
      };
}

export async function refreshConnectorCliStatus(connectorId) {
  const id = normalizeConnectorId(connectorId);
  const connector = await readInstalledConnector(id);
  if (!connector) throw new Error(`Connector is not installed: ${id}`);
  const baseDir = connectorDir(id);
  const cli = await readJsonFileAsync(path.join(baseDir, 'cli.json'), null);
  if (!isPlainObject(cli)) throw new Error(`Connector has no cli.json: ${id}`);

  const status = await runCliStatus(
    cli,
    baseDir,
    {
      ...buildConnectorCliEnv(cli, baseDir, id, connectorCommandEnv({
        MOSS_CONNECTOR_NAME: connector.name || id,
      })),
      ...readConnectorCredentialValues(id),
    },
    CLI_STATUS_REFRESH_TIMEOUT_MS,
  );
  if (!status.checked) throw new Error(`Connector has no status command: ${id}`);

  const patch = cliStatusStatePatch(status.connected);
  const connectionChanged = connector.connected !== patch.connected;
  const changed = connector.connected !== patch.connected || connector.setupStatus !== patch.setupStatus;
  if (changed) await updateConnectorRuntimeState(id, patch);

  return {
    connector: changed ? await readInstalledConnector(id) : connector,
    connected: status.connected,
    changed,
    connectionChanged,
  };
}

function parseJsonOutputCandidates(output) {
  const text = normalizeString(output);
  if (!text) return [];
  const candidates = [text, ...text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)];
  const parsed = [];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (isPlainObject(value)) parsed.push(value);
    } catch {}
  }
  return parsed;
}

function jsonStatusMatches(actual, expected) {
  if (!isPlainObject(actual) || !isPlainObject(expected)) return false;
  return Object.entries(expected).every(([key, expectedValue]) => {
    const actualValue = actual[key];
    if (isPlainObject(expectedValue)) return jsonStatusMatches(actualValue, expectedValue);
    return String(actualValue) === String(expectedValue);
  });
}

export function matchesCliStatus(cli, output) {
  const jsonMatcher = isPlainObject(cli?.statusMatchJson) ? cli.statusMatchJson : null;
  if (jsonMatcher) {
    const candidates = parseJsonOutputCandidates(output);
    if (candidates.length > 0) {
      return candidates.some((candidate) => jsonStatusMatches(candidate, jsonMatcher));
    }
  }

  const statusMatch = normalizeString(cli?.statusMatch);
  if (!statusMatch) return !jsonMatcher;
  try {
    return new RegExp(statusMatch, 'm').test(String(output || ''));
  } catch {
    return String(output || '').includes(statusMatch);
  }
}

export function normalizeCliAuthSteps(cli) {
  const inherited = {
    authUrlDomain: cli?.authUrlDomain,
    authWaitForExit: cli?.authWaitForExit,
    authSuppressBrowser: cli?.authSuppressBrowser,
    authQrModal: cli?.authQrModal,
  };
  const sources = Array.isArray(cli?.auth) ? cli.auth : [cli?.auth];
  return sources
    .map((source) => {
      if (typeof source === 'string') return { ...inherited, command: source };
      if (!isPlainObject(source)) return null;
      const hasCommandWrapper = Object.prototype.hasOwnProperty.call(source, 'command');
      return hasCommandWrapper
        ? { ...inherited, ...source }
        : { ...inherited, command: source };
    })
    .filter(Boolean);
}

async function runCliAuthWaitForExit(step, baseDir, {
  env,
  sessionId,
  openBrowser,
} = {}) {
  const command = getPlatformCommand(step.command, 'auth.command');
  let output = '';
  let authorizationUrlOpened = false;
  let authorizationHost = '';
  const consume = (text) => {
    output = appendLimitedOutput(output, text);
    if (authorizationUrlOpened) return;
    const url = extractAuthorizationUrl(output, step.authUrlDomain);
    if (!url) return;
    authorizationUrlOpened = true;
    try {
      authorizationHost = new URL(url).hostname;
    } catch {
      authorizationHost = normalizeString(step.authUrlDomain);
    }
    if (!step.authSuppressBrowser) openBrowser?.({ url, sessionId });
  };
  const result = await runConnectorCommand(command, {
    cwd: baseDir,
    env,
    timeoutMs: DEFAULT_AUTH_TIMEOUT_MS,
    onOutput: consume,
  });
  if (result.code !== 0) {
    throw new Error(result.timedOut
      ? '认证等待超时'
      : `认证命令失败：${redactSensitiveText(result.output || `exit ${result.code}`)}`);
  }
  return {
    attempted: true,
    connected: false,
    code: result.code,
    output,
    authorizationUrlOpened,
    authorizationHost,
  };
}

async function runCliAuthCommand(step, cli, baseDir, {
  env,
  sessionId,
  openBrowser,
} = {}) {
  const command = getPlatformCommand(step.command, 'auth.command');
  if (!command) return { attempted: false, connected: false, authorizationUrlOpened: false };

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    let authorizationUrlOpened = false;
    let authorizationHost = '';

    const child = spawn(command, {
      cwd: baseDir,
      env,
      shell: true,
      windowsHide: true,
    });

    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(poll);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        attempted: true,
        authorizationUrlOpened,
        authorizationHost,
        output,
        ...result,
      });
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const maybeOpenUrl = (text) => {
      if (authorizationUrlOpened) return;
      const url = extractAuthorizationUrl(text, step.authUrlDomain);
      if (!url) return;
      authorizationUrlOpened = true;
      try {
        authorizationHost = new URL(url).hostname;
      } catch {
        authorizationHost = normalizeString(step.authUrlDomain);
      }
      if (!step.authSuppressBrowser) openBrowser?.({ url, sessionId });
    };

    const consume = (chunk) => {
      const text = chunk.toString();
      output = appendLimitedOutput(output, text);
      maybeOpenUrl(output);
    };

    const checkStatus = async () => {
      try {
        const status = await runCliStatus(cli, baseDir, env);
        if (!status.connected || settled) return;
        try {
          child.kill('SIGTERM');
        } catch {}
        finish({ connected: true, code: 0 });
      } catch {
        // Ignore transient status failures while auth is still pending.
      }
    };

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {}
      finish({
        connected: false,
        timedOut: true,
        code: null,
      });
    }, DEFAULT_AUTH_TIMEOUT_MS);

    const poll = setInterval(() => {
      void checkStatus();
    }, AUTH_STATUS_POLL_MS);

    child.stdout?.on('data', consume);
    child.stderr?.on('data', consume);
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (settled) return;
      void runCliStatus(cli, baseDir, env)
        .then((status) => {
          if (status.connected || code !== 0) {
            finish({ connected: status.connected, code, signal });
          }
        })
        .catch(() => finish({
          connected: false,
          code,
          signal,
        }));
    });
  });
}

async function runCliAuth(cli, baseDir, options = {}) {
  const steps = normalizeCliAuthSteps(cli);
  if (steps.length === 0) {
    return { attempted: false, connected: false, authorizationUrlOpened: false };
  }

  let output = '';
  let authorizationUrlOpened = false;
  let authorizationHost = '';
  for (const step of steps) {
    const skipCommand = getPlatformCommand(step.skipIf, 'auth.skipIf');
    if (skipCommand) {
      const skipResult = await runConnectorCommand(skipCommand, {
        cwd: baseDir,
        env: options.env,
        timeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
      });
      if (skipResult.code === 0) continue;
    }
    const result = step.authWaitForExit
      ? await runCliAuthWaitForExit(step, baseDir, options)
      : await runCliAuthCommand(step, cli, baseDir, options);
    output = appendLimitedOutput(output, result.output || '');
    authorizationUrlOpened ||= Boolean(result.authorizationUrlOpened);
    authorizationHost ||= result.authorizationHost || '';
  }
  const status = await runCliStatus(cli, baseDir, options.env);
  return {
    attempted: true,
    connected: status.connected,
    output,
    authorizationUrlOpened,
    authorizationHost,
  };
}

function makeSetupStep(step, status, message = '') {
  return {
    step,
    status,
    ...(message ? { message: redactSensitiveText(message) } : {}),
  };
}

export async function setupConnectorCli(connectorId, {
  sessionId = null,
  openBrowser,
  emitConnectorsChanged,
  onSetupComplete,
} = {}) {
  const id = normalizeConnectorId(connectorId);
  const connector = await readInstalledConnector(id);
  if (!connector) throw new Error(`Connector is not installed: ${id}`);
  const baseDir = connectorDir(id);
  const cli = await readJsonFileAsync(path.join(baseDir, 'cli.json'), null);
  if (!isPlainObject(cli)) throw new Error(`Connector has no cli.json: ${id}`);

  const steps = [];
  const env = {
    ...buildConnectorCliEnv(cli, baseDir, id, connectorCommandEnv({
      MOSS_CONNECTOR_NAME: connector.name || id,
    })),
    ...readConnectorCredentialValues(id),
  };

  const setState = async (patch) => {
    const state = await updateConnectorRuntimeState(id, patch);
    emitConnectorsChanged?.({ reason: 'setup-state', connectorId: id, state });
    return state;
  };

  await setState({
    connected: false,
    setupStatus: 'running',
    setupMessage: '正在检查 CLI 环境',
  });

  try {
    const runtime = await checkNodeRuntime(cli.runtime, baseDir, env);
    steps.push(makeSetupStep('runtime', 'ok', runtime.message));

    let version = await runCliVersionCheck(cli, baseDir, env);
    if (version.checked && version.satisfies) {
      steps.push(makeSetupStep('versionCheck', 'ok', version.version ? `CLI ${version.version}` : 'CLI 已安装'));
    } else if (version.checked) {
      if (version.checked) {
        const reason = version.installed
          ? `CLI ${version.version || '已安装版本'} 不满足 ${version.minVersion || '最低版本'}`
          : '未检测到 CLI';
        steps.push(makeSetupStep('versionCheck', 'needs_install', reason));
      }

      const initCommand = getPlatformCommand(cli.init, 'init');
      if (!initCommand) throw new Error('cli.json 缺少当前系统的 init 命令。');
      await setState({
        setupStatus: 'running',
        setupMessage: '正在安装或升级 CLI',
      });
      const installResult = await runConnectorCommand(initCommand, {
        cwd: baseDir,
        env,
        timeoutMs: DEFAULT_INSTALL_TIMEOUT_MS,
      });
      if (installResult.code !== 0) {
        throw new Error(`CLI 安装失败：${redactSensitiveText(installResult.stderr || installResult.output || `exit ${installResult.code}`)}`);
      }
      steps.push(makeSetupStep('install', 'ok', 'CLI 安装完成'));

      version = await runCliVersionCheck(cli, baseDir, env);
      if (version.checked && !version.satisfies) {
        throw new Error(`CLI 版本检查失败：当前 ${version.version || '未知'}，要求 ${version.minVersion || '满足 cli.json 要求'}`);
      }
      if (version.checked) {
        steps.push(makeSetupStep('versionCheckAfterInstall', 'ok', version.version ? `CLI ${version.version}` : 'CLI 版本满足要求'));
      }
    } else {
      const initCommand = getPlatformCommand(cli.init, 'init');
      if (initCommand) {
        await setState({
          setupStatus: 'running',
          setupMessage: '正在安装或升级 CLI',
        });
        const installResult = await runConnectorCommand(initCommand, {
          cwd: baseDir,
          env,
          timeoutMs: DEFAULT_INSTALL_TIMEOUT_MS,
        });
        if (installResult.code !== 0) {
          throw new Error(`CLI 安装失败：${redactSensitiveText(installResult.stderr || installResult.output || `exit ${installResult.code}`)}`);
        }
        steps.push(makeSetupStep('install', 'ok', 'CLI 安装完成'));
      } else {
        steps.push(makeSetupStep('install', 'ok', '连接器使用包内或按需 CLI'));
      }
    }

    await setState({
      setupStatus: 'running',
      setupMessage: '正在检查认证状态',
    });
    let status = await runCliStatus(cli, baseDir, env);
    if (!status.checked) {
      throw new Error('cli.json 缺少当前系统的 status 命令。');
    }

    let authorizationUrlOpened = false;
    let authorizationHost = '';
    if (!status.connected) {
      steps.push(makeSetupStep('statusBeforeAuth', 'needs_auth', '当前未登录'));
      await setState({
        setupStatus: 'authenticating',
        setupMessage: '正在等待浏览器认证',
      });
      const auth = await runCliAuth(cli, baseDir, {
        env,
        sessionId,
        openBrowser,
      });
      authorizationUrlOpened = Boolean(auth.authorizationUrlOpened);
      authorizationHost = auth.authorizationHost || '';
      if (!auth.connected) {
        const detail = auth.timedOut
          ? '认证等待超时'
          : redactSensitiveText(auth.output || '认证命令结束但未检测到登录态');
        throw new Error(`CLI 认证未完成：${detail}`);
      }
      steps.push(makeSetupStep('auth', 'ok', authorizationHost ? `已打开 ${authorizationHost} 授权页并完成认证` : '认证完成'));
    } else {
      steps.push(makeSetupStep('statusBeforeAuth', 'ok', '已登录'));
    }

    status = await runCliStatus(cli, baseDir, env);
    if (!status.connected) {
      throw new Error(`最终状态检查未通过：${redactSensitiveText(status.output || `exit ${status.code}`)}`);
    }
    steps.push(makeSetupStep('status', 'ok', '连接器可用'));

    await setState({
      connected: true,
      setupStatus: 'connected',
      setupMessage: '连接器可用',
      authorizationHost,
    });
    const reload = await onSetupComplete?.({ connectorId: id });
    emitConnectorsChanged?.({
      reason: 'cli-setup-complete',
      connectorId: id,
      ...(isPlainObject(reload) ? reload : {}),
    });

    return {
      connector: await readInstalledConnector(id),
      connected: true,
      setupStatus: 'connected',
      version: version.version || '',
      authorizationUrlOpened,
      authorizationHost,
      steps,
      ...(isPlainObject(reload) ? reload : {}),
      message: '连接器 CLI 已安装并认证可用。',
    };
  } catch (error) {
    const message = redactSensitiveText(error?.message || String(error));
    steps.push(makeSetupStep('setup', 'failed', message));
    await setState({
      connected: false,
      setupStatus: 'failed',
      setupMessage: message,
    });
    throw new Error(message);
  }
}

export async function installConnector(connectorId) {
  const id = normalizeConnectorId(connectorId);
  const { zip, connectors } = await loadCatalogZip();
  const connector = connectors
    .map((entry) => normalizeConnectorManifest(entry, zip))
    .filter(Boolean)
    .find((entry) => entry.id === id);
  if (!connector) {
    throw new Error(`Connector not found: ${id}`);
  }

  const baseDir = connectorDir(id);
  const previous = await readInstalledConnector(id).catch(() => null);
  const previousState = await readConnectorRuntimeState(id).catch(() => ({}));
  const installedAt = previous?.installedAt || new Date().toISOString();
  const updatedAt = new Date().toISOString();
  await fsp.rm(baseDir, { recursive: true, force: true });
  await fsp.mkdir(baseDir, { recursive: true });

  const packagePrefix = `connectors/${connector.source}/`;
  await extractZipPrefix(zip, packagePrefix, baseDir);

  const credentialSchema = normalizeConnectorCredentialSchema(
    await readZipJson(zip, `${packagePrefix}token-schema.json`, null),
  );
  if (credentialSchema) {
    await writeJsonFileAsync(path.join(baseDir, 'token-schema.json'), credentialSchema);
  }

  let mcpServerNames = [];
  let requiresCliSetup = false;
  if (connector.hasMcp) {
    const rawMcp = await readZipJson(zip, `connectors/${connector.source}/mcp.json`, null);
    requiresCliSetup = normalizeString(rawMcp?.preAuth).toLowerCase() === 'cli';
    const mcp = normalizeConnectorMcpConfig(id, rawMcp);
    mcpServerNames = Object.keys(mcp.mcpServers);
    await writeJsonFileAsync(path.join(baseDir, 'mcp.json'), mcp);
  }

  let cli = null;
  if (connector.hasCli) {
    cli = await readZipJson(zip, `connectors/${connector.source}/cli.json`, null);
    await writeJsonFileAsync(path.join(baseDir, 'cli.json'), cli || {});
  }

  const packageAuthConfig = normalizeConnectorAuthConfig(
    connector.authConfig,
    await readZipJson(zip, `connectors/${connector.source}/auth.json`, null),
  );
  const skills = await extractConnectorSkill(zip, connector, baseDir, installedAt);
  const connectorWithIcon = await addConnectorIcon(zip, connector);
  const meta = {
    ...connectorWithIcon,
    authConfig: packageAuthConfig,
    enabled: true,
    installedAt,
    updatedAt,
    mcpServerNames,
    requiresCliSetup,
    credentialSchema,
    skillName: skills[0]?.name || '',
    skillNames: skills.map((skill) => skill.name),
  };
  await writeJsonFileAsync(path.join(baseDir, CONNECTOR_META_FILE), meta);
  await writeConnectorRuntimeState(id, {
    ...previousState,
    connected: Boolean(previous?.connected),
    setupStatus: previous?.setupStatus || (
      credentialSchema
        ? 'needs-credentials'
        : connector.type === 'cli' || requiresCliSetup
          ? 'pending'
          : 'installed'
    ),
    setupMessage: previous?.setupMessage || '',
    updatedAt,
  });

  return {
    connector: await readInstalledConnector(id),
    cli,
  };
}

export async function uninstallConnector(connectorId) {
  const id = normalizeConnectorId(connectorId);
  await fsp.rm(connectorDir(id), { recursive: true, force: true });
  await fsp.rm(connectorStatePath(id), { force: true });
  const credentials = readConnectorCredentials();
  const connectorFields = isPlainObject(credentials.connectorFields)
    ? { ...credentials.connectorFields }
    : {};
  const mcpAccessTokens = isPlainObject(credentials.mcpAccessTokens)
    ? { ...credentials.mcpAccessTokens }
    : {};
  delete connectorFields[id];
  for (const key of Object.keys(mcpAccessTokens)) {
    if (key.startsWith(`${id}:`)) delete mcpAccessTokens[key];
  }
  await writeConnectorCredentials({ ...credentials, connectorFields, mcpAccessTokens });
  return { ok: true, id };
}

export function getConnectorMcpServers(connectorIds) {
  const result = {};
  for (const item of normalizeStringList(connectorIds)) {
    if (!isValidConnectorId(item)) continue;
    const baseDir = connectorDir(item);
    const meta = readJsonFile(path.join(baseDir, CONNECTOR_META_FILE), null);
    if (!isPlainObject(meta) || meta.enabled === false) continue;
    const rawMcp = readJsonFile(path.join(baseDir, 'mcp.json'), null);
    if (!isPlainObject(rawMcp)) continue;
    const credentialSchema = normalizeConnectorCredentialSchema(
      readJsonFile(path.join(baseDir, 'token-schema.json'), null),
    );
    const credentialValues = credentialSchema ? readConnectorCredentialValues(item) : {};
    if (!connectorCredentialsConfigured(credentialSchema, credentialValues)) continue;
    try {
      const normalized = normalizeConnectorMcpConfig(item, rawMcp);
      for (const [serverName, config] of Object.entries(normalized.mcpServers)) {
        const accessToken = readConnectorMcpAccessToken(item, serverName);
        result[serverName] = withMcpAccessToken(
          applyConnectorCredentials(config, credentialValues),
          accessToken,
        );
      }
    } catch {}
  }
  return result;
}

export function findConnectorMcpServer(nameOrConnectorId) {
  const target = normalizeString(nameOrConnectorId);
  if (!isValidConnectorId(target) && !isValidMcpServerName(target)) return null;

  let entries = [];
  try {
    entries = fs.readdirSync(CONNECTOR_INSTALLED_DIR, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const connectorId = entry.name;
    if (!isValidConnectorId(connectorId)) continue;
    const baseDir = connectorDir(connectorId);
    const meta = readJsonFile(path.join(baseDir, CONNECTOR_META_FILE), null);
    if (!isPlainObject(meta) || meta.enabled === false) continue;
    const rawMcp = readJsonFile(path.join(baseDir, 'mcp.json'), null);
    if (!isPlainObject(rawMcp)) continue;
    const credentialSchema = normalizeConnectorCredentialSchema(
      readJsonFile(path.join(baseDir, 'token-schema.json'), null),
    );
    const credentialValues = credentialSchema ? readConnectorCredentialValues(connectorId) : {};
    if (!connectorCredentialsConfigured(credentialSchema, credentialValues)) continue;

    let normalized;
    try {
      normalized = normalizeConnectorMcpConfig(connectorId, rawMcp);
    } catch {
      continue;
    }

    const serverEntries = Object.entries(normalized.mcpServers);
    for (const [serverName, config] of serverEntries) {
      if (
        serverName === target ||
        connectorId === target ||
        meta.id === target ||
        meta.source === target
      ) {
        return {
          connectorId,
          connectorName: normalizeString(meta.name) || connectorId,
          providerId: normalizeString(meta.providerId),
          authMode: normalizeString(meta.authMode),
          authConfig: normalizeConnectorAuthConfig(meta.authConfig, meta),
          serverName,
          config: applyConnectorCredentials(config, credentialValues),
        };
      }
    }
  }
  return null;
}

export async function updateConnectorMcpAuthState(connectorId, patch = {}) {
  const id = normalizeConnectorId(connectorId);
  return updateConnectorRuntimeState(id, {
    ...patch,
    setupStatus: normalizeString(patch.setupStatus) || (patch.connected ? 'connected' : 'needs-auth'),
    setupMessage: redactSensitiveText(normalizeString(patch.setupMessage)),
    connected: Boolean(patch.connected),
  });
}

export function getConnectorAddDirs(connectorIds) {
  const dirs = [];
  const seen = new Set();
  for (const item of normalizeStringList(connectorIds)) {
    if (!isValidConnectorId(item)) continue;
    const baseDir = connectorDir(item);
    const credentialSchema = normalizeConnectorCredentialSchema(
      readJsonFile(path.join(baseDir, 'token-schema.json'), null),
    );
    if (credentialSchema && !connectorCredentialsConfigured(credentialSchema, readConnectorCredentialValues(item))) {
      continue;
    }
    const skillRoot = path.join(baseDir, '.moss', 'skills');
    if (!fs.existsSync(skillRoot)) continue;
    if (seen.has(baseDir)) continue;
    seen.add(baseDir);
    dirs.push(baseDir);
  }
  return dirs;
}

export function registerConnectorHubIpcHandlers({
  getSessionRecord,
  updateSessionConnectors,
  emitConnectorsChanged,
  onMcpTokenSaved,
} = {}) {
  ipcMain.handle('connector-hub:list', async () => {
    try {
      return { success: true, data: await listConnectorCatalog() };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('connector-hub:get-installed', async () => {
    try {
      return { success: true, data: await listInstalledConnectors() };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('connector-hub:refresh-cli-status', async (_event, payload = {}) => {
    try {
      const result = await refreshConnectorCliStatus(payload.id);
      if (result.connectionChanged) {
        if (result.connected && result.connector?.hasMcp) await onMcpTokenSaved?.(result);
        emitConnectorsChanged?.({
          reason: 'cli-status-refreshed',
          connectorId: result.connector?.id || payload.id,
        });
      }
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: redactSensitiveText(error?.message || String(error)) };
    }
  });

  ipcMain.handle('connector-hub:install', async (_event, payload = {}) => {
    try {
      const result = await installConnector(payload.id);
      emitConnectorsChanged?.({ reason: 'installed', connectorId: result.connector?.id || payload.id });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('connector-hub:uninstall', async (_event, payload = {}) => {
    try {
      const result = await uninstallConnector(payload.id);
      emitConnectorsChanged?.({ reason: 'uninstalled', connectorId: result.id });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('connector-hub:save-mcp-token', async (_event, payload = {}) => {
    try {
      const result = await saveConnectorMcpAccessToken(payload.connectorId, payload.serverName, payload.token || payload.url);
      const reload = await onMcpTokenSaved?.(result);
      emitConnectorsChanged?.({ reason: 'mcp-token-saved', connectorId: result.connectorId, ...reload });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: redactSensitiveText(error?.message || String(error)) };
    }
  });

  ipcMain.handle('connector-hub:save-credentials', async (_event, payload = {}) => {
    try {
      const result = await saveConnectorCredentials(payload.connectorId, payload.values);
      const reload = await onMcpTokenSaved?.(result);
      emitConnectorsChanged?.({ reason: 'credentials-saved', connectorId: result.connectorId, ...reload });
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: redactSensitiveText(error?.message || String(error)) };
    }
  });

  ipcMain.handle('agent:set-session-connectors', async (_event, payload = {}) => {
    try {
      const sessionRecord = getSessionRecord?.(payload.sessionId);
      if (!sessionRecord) throw new Error('Unknown session.');
      const detail = await updateSessionConnectors?.(sessionRecord, payload.connectorIds);
      return { success: true, data: detail };
    } catch (error) {
      return { success: false, error: error?.message || String(error) };
    }
  });
}
