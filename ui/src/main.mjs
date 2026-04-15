import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(uiRoot, '..');
const cliPath = path.join(repoRoot, 'cli-node.js');
const sdkPath = path.join(repoRoot, 'electron-direct.mjs');
const rendererHtml = path.join(uiRoot, 'dist', 'renderer', 'index.html');
const DEFAULT_BYPASS_PERMISSIONS = process.env.CLAUDE_CODE_BYPASS_PERMISSIONS === 'true';
const MAX_FILE_BYTES = 200 * 1024;
const MOSS_HOME = path.join(os.homedir(), '.moss');
const MOSS_WORKSPACES_DIR = path.join(MOSS_HOME, 'workspaces');
const USER_TMP_DIR = path.join(os.homedir(), 'tmp');
const MOSS_APPS_DIR = path.join(MOSS_HOME, 'generated-apps');
const MOSS_APP_DATA_DIR = path.join(MOSS_HOME, 'generated-app-data');
const DESKTOP_SETTINGS_PATH = path.join(MOSS_HOME, 'settings.json');
const AUTH_SETTINGS_PATH = DESKTOP_SETTINGS_PATH;
const SESSION_DB_PATH = path.join(MOSS_HOME, 'moss.db');
const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  bypassPermissions: DEFAULT_BYPASS_PERMISSIONS,
  model: 'claude-sonnet-4-6',
  maxTurns: 100,
  appendSystemPrompt: '',
  thinkingMode: 'adaptive',
  thinkingBudgetTokens: 16000,
});
const APP_FILES_SUBDIR = 'files';
const APP_VERSIONS_SUBDIR = 'versions';
const APP_STORAGE_FILENAME = 'storage.json';
const APP_METADATA_SCRIPT_TYPE = 'application/ld+json';
const APP_PRD_SCRIPT_TYPE = 'application/x-goose-prd';
const APP_SCHEMA_CONTEXT = 'urn:goose.ai:schema';
const APP_SCHEMA_TYPE = 'GooseApp';
const APP_CSP_CONTENT = "default-src 'self' 'unsafe-inline' data: blob: file: https:; img-src 'self' data: blob: file: https:; media-src 'self' data: blob: file: https:; font-src 'self' data: blob: file: https:; connect-src 'self' data: blob: file: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline'; frame-src 'self' https:;";

// Direct embed should behave like the local-agent launcher, not Claude Desktop.
process.env.CLAUDE_CODE_ENTRYPOINT = 'local-agent';
process.env.CLAUDE_CODE_LOCAL_SETTINGS_AUTH_ONLY = 'true';

let mainWindow = null;
let claudeSessionCtorPromise = null;
let claudeRuntimeModulePromise = null;

const sessions = new Map();
const appWindows = new Map();
const appWindowStates = new Map();
fs.mkdirSync(MOSS_HOME, { recursive: true });
fs.mkdirSync(MOSS_WORKSPACES_DIR, { recursive: true });
fs.mkdirSync(USER_TMP_DIR, { recursive: true });
fs.mkdirSync(MOSS_APPS_DIR, { recursive: true });
fs.mkdirSync(MOSS_APP_DATA_DIR, { recursive: true });
const sessionDb = new DatabaseSync(SESSION_DB_PATH);
const persistSessionStmt = (() => {
  sessionDb.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      workspace TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      message_count INTEGER NOT NULL,
      preview TEXT NOT NULL,
      underlying_session_id TEXT,
      history_json TEXT NOT NULL
    )
  `);
  return sessionDb.prepare(`
    INSERT INTO sessions (
      id, title, workspace, created_at, updated_at, message_count, preview, underlying_session_id, history_json
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      workspace = excluded.workspace,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      message_count = excluded.message_count,
      preview = excluded.preview,
      underlying_session_id = excluded.underlying_session_id,
      history_json = excluded.history_json
  `);
})();
const deleteSessionStmt = sessionDb.prepare('DELETE FROM sessions WHERE id = ?');
const loadSessionsStmt = sessionDb.prepare(`
  SELECT
    id,
    title,
    workspace,
    created_at,
    updated_at,
    message_count,
    preview,
    underlying_session_id,
    history_json
  FROM sessions
  ORDER BY updated_at DESC
`);

function loadLocalSettingsAuthConfig() {
  const result = {
    path: AUTH_SETTINGS_PATH,
    exists: false,
    loaded: false,
    parseError: '',
    injected: [],
  };

  try {
    if (!fs.existsSync(AUTH_SETTINGS_PATH)) {
      return result;
    }

    result.path = AUTH_SETTINGS_PATH;
    result.exists = true;
    const raw = fs.readFileSync(AUTH_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const env = parsed && typeof parsed === 'object' && parsed.env && typeof parsed.env === 'object'
      ? parsed.env
      : {};

    // 允许注入 env 对象中的所有环境变量，不再限制特定的三个 key
    for (const key of Object.keys(env)) {
      const value = env[key];
      if (typeof value === 'string' && value.trim()) {
        process.env[key] = value.trim();
        result.injected.push(key);
      }
    }

    result.loaded = true;
    return result;
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error);
    return result;
  }
}

const localSettingsAuthConfig = loadLocalSettingsAuthConfig();

function normalizeDesktopSettings(input, existing = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = { ...existing };

  if (typeof source.model === 'string' && source.model.trim()) {
    result.model = source.model.trim();
  } else if (result.model === undefined) {
    result.model = DEFAULT_DESKTOP_SETTINGS.model;
  }

  if (source.appendSystemPrompt !== undefined) {
    result.appendSystemPrompt = source.appendSystemPrompt;
  } else if (result.appendSystemPrompt === undefined) {
    result.appendSystemPrompt = DEFAULT_DESKTOP_SETTINGS.appendSystemPrompt;
  }

  if (source.maxTurns !== undefined) {
    let maxTurns = Number.parseInt(String(source.maxTurns), 10);
    if (Number.isFinite(maxTurns) && maxTurns >= 1) {
      result.maxTurns = Math.min(maxTurns, 10_000);
    }
  } else if (result.maxTurns === undefined) {
    result.maxTurns = DEFAULT_DESKTOP_SETTINGS.maxTurns;
  }

  if (source.thinkingMode !== undefined) {
    result.thinkingMode = source.thinkingMode;
  } else if (result.thinkingMode === undefined) {
    result.thinkingMode = DEFAULT_DESKTOP_SETTINGS.thinkingMode;
  }

  if (source.thinkingBudgetTokens !== undefined) {
    let tokens = Number.parseInt(String(source.thinkingBudgetTokens), 10);
    if (Number.isFinite(tokens) && tokens >= 1024) {
      result.thinkingBudgetTokens = Math.min(tokens, 128_000);
    }
  } else if (result.thinkingBudgetTokens === undefined) {
    result.thinkingBudgetTokens = DEFAULT_DESKTOP_SETTINGS.thinkingBudgetTokens;
  }

  if (source.bypassPermissions !== undefined) {
    result.bypassPermissions = Boolean(source.bypassPermissions);
  } else if (result.bypassPermissions === undefined) {
    result.bypassPermissions = DEFAULT_DESKTOP_SETTINGS.bypassPermissions;
  }

  return result;
}

function loadDesktopSettings() {
  const result = {
    path: DESKTOP_SETTINGS_PATH,
    exists: false,
    loaded: false,
    parseError: '',
    value: { ...DEFAULT_DESKTOP_SETTINGS },
  };

  try {
    if (!fs.existsSync(DESKTOP_SETTINGS_PATH)) {
      return result;
    }

    result.exists = true;
    const raw = fs.readFileSync(DESKTOP_SETTINGS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // 启动加载时，保留原始 JSON 中的所有 key，只对标准 key 进行合并/格式化
    result.value = {
      ...parsed,
      ...normalizeDesktopSettings(parsed, parsed)
    };
    result.loaded = true;
    return result;
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error);
    return result;
  }
}

let desktopSettingsState = loadDesktopSettings();
let desktopSettings = desktopSettingsState.value;

function getDesktopSettingsPayload(extra = {}) {
  return {
    ...desktopSettings,
    settingsPath: desktopSettingsState.path,
    settingsExists: desktopSettingsState.exists,
    settingsLoaded: desktopSettingsState.loaded,
    settingsParseError: desktopSettingsState.parseError,
    ...extra,
  };
}

function saveDesktopSettings(nextSettings) {
  fs.writeFileSync(DESKTOP_SETTINGS_PATH, `${JSON.stringify(nextSettings, null, 2)}\n`, 'utf8');
  desktopSettingsState = {
    path: DESKTOP_SETTINGS_PATH,
    exists: true,
    loaded: true,
    parseError: '',
    value: nextSettings,
  };
  desktopSettings = nextSettings;
}

function buildThinkingConfig() {
  if (desktopSettings.thinkingMode === 'disabled') {
    return { type: 'disabled' };
  }
  if (desktopSettings.thinkingMode === 'enabled') {
    return {
      type: 'enabled',
      budgetTokens: desktopSettings.thinkingBudgetTokens,
    };
  }
  return { type: 'adaptive' };
}

function buildClaudeSessionConfig(cwd) {
  return {
    cwd,
    model: desktopSettings.model,
    appendSystemPrompt: desktopSettings.appendSystemPrompt || undefined,
    maxTurns: desktopSettings.maxTurns,
    thinkingConfig: buildThinkingConfig(),
    permissionMode: desktopSettings.bypassPermissions ? 'allow-all' : 'default',
  };
}

function refreshDesktopSettings(payload = {}) {
  // 这里不再只保留标准 key，而是将 payload 合并到现有的 desktopSettings 中
  // 这样可以保留用户手动在 settings.json 中添加的自定义 key（如 env, apiBaseUrl 等）
  const nextSettings = {
    ...desktopSettings,
    ...normalizeDesktopSettings(payload, desktopSettings)
  };
  saveDesktopSettings(nextSettings);

  let skippedSessionCount = 0;
  for (const sessionRecord of sessions.values()) {
    if (!sessionRecord.runtime) continue;
    if (sessionRecord.busy || sessionRecord.messageCount > 0) {
      skippedSessionCount += 1;
      continue;
    }
    disposeRuntime(sessionRecord);
  }

  emitToRenderer('agent:settings-changed', getDesktopSettingsPayload({
    skippedSessionCount,
  }));

  return getDesktopSettingsPayload({
    skippedSessionCount,
  });
}

function parseStoredHistory(historyJson) {
  if (!historyJson) return [];
  try {
    const parsed = JSON.parse(historyJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toPersistedSessionRow(sessionRecord) {
  return [
    sessionRecord.id,
    sessionRecord.title,
    sessionRecord.workspace,
    sessionRecord.createdAt,
    sessionRecord.updatedAt,
    sessionRecord.messageCount,
    sessionRecord.preview || '',
    sessionRecord.underlyingSessionId,
    JSON.stringify(sessionRecord.history || []),
  ];
}

function persistSessionRecord(sessionRecord) {
  persistSessionStmt.run(...toPersistedSessionRow(sessionRecord));
}

function flushPendingSessionPersist(sessionRecord) {
  if (sessionRecord.persistTimer) {
    clearTimeout(sessionRecord.persistTimer);
    sessionRecord.persistTimer = null;
  }
  persistSessionRecord(sessionRecord);
}

function schedulePersistSession(sessionRecord, immediate = false) {
  if (immediate) {
    flushPendingSessionPersist(sessionRecord);
    return;
  }
  if (sessionRecord.persistTimer) return;
  sessionRecord.persistTimer = setTimeout(() => {
    sessionRecord.persistTimer = null;
    persistSessionRecord(sessionRecord);
  }, 200);
}

function deletePersistedSession(sessionId) {
  deleteSessionStmt.run(sessionId);
}

function hydratePersistedSessions() {
  const rows = loadSessionsStmt.all();
  for (const row of rows) {
    const sessionRecord = {
      id: row.id,
      title: row.title,
      workspace: row.workspace,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      busy: false,
      messageCount: row.message_count,
      preview: row.preview || '',
      underlyingSessionId: row.underlying_session_id || null,
      history: parseStoredHistory(row.history_json),
      runtime: null,
      workspaceWatcher: null,
      workspaceWatcherSyncTimer: null,
      persistTimer: null,
    };
    sessions.set(sessionRecord.id, sessionRecord);
  }
}

hydratePersistedSessions();

function getPackageMetadata() {
  try {
    const packageJsonPath = path.join(repoRoot, 'package.json');
    return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return {};
  }
}

function installRuntimeMacros() {
  if (globalThis.MACRO) return globalThis.MACRO;

  const packageMetadata = getPackageMetadata();
  const version = typeof packageMetadata.version === 'string' && packageMetadata.version
    ? packageMetadata.version
    : '0.0.0';

  globalThis.MACRO = Object.freeze({
    VERSION: version,
    BUILD_TIME: '',
    PACKAGE_URL: typeof packageMetadata.name === 'string' && packageMetadata.name
      ? packageMetadata.name
      : '@anthropic-ai/claude-code',
    FEEDBACK_CHANNEL: '',
    ISSUES_EXPLAINER: '',
    VERSION_CHANGELOG: '',
  });

  return globalThis.MACRO;
}

async function getClaudeRuntimeModule() {
  if (claudeRuntimeModulePromise) {
    return claudeRuntimeModulePromise;
  }

  installRuntimeMacros();
  claudeRuntimeModulePromise = import(sdkPath)
    .catch((error) => {
      claudeRuntimeModulePromise = null;
      throw error;
    });

  return claudeRuntimeModulePromise;
}

async function getClaudeSessionCtor() {
  if (claudeSessionCtorPromise) {
    return claudeSessionCtorPromise;
  }

  claudeSessionCtorPromise = getClaudeRuntimeModule()
    .then((mod) => {
      if (typeof mod.ClaudeSession !== 'function') {
        throw new Error('electron-direct.mjs did not export ClaudeSession.');
      }
      return mod.ClaudeSession;
    })
    .catch((error) => {
      claudeSessionCtorPromise = null;
      throw error;
    });

  return claudeSessionCtorPromise;
}

async function getAuthDebugSnapshot() {
  const mod = await getClaudeRuntimeModule();
  if (typeof mod.getAuthDebugSnapshot === 'function') {
    return mod.getAuthDebugSnapshot();
  }
  return null;
}

function formatAuthDebug(authDebug) {
  if (!authDebug) return '';

  const parts = [
    `entrypoint=${authDebug.entrypoint || 'unknown'}`,
    `localSettingsAuthOnly=${authDebug.localSettingsAuthOnly ? 'yes' : 'no'}`,
    `apiKeySource=${authDebug.apiKeySource || 'none'}`,
    `hasApiKey=${authDebug.hasApiKeyCandidate ? 'yes' : 'no'}`,
    `authTokenSource=${authDebug.authTokenSource || 'none'}`,
    `hasAuthToken=${authDebug.hasAuthTokenCandidate ? 'yes' : 'no'}`,
    `apiKeyEnv=${authDebug.hasAnthropicApiKeyEnv ? 'yes' : 'no'}`,
    `authTokenEnv=${authDebug.hasAnthropicAuthTokenEnv ? 'yes' : 'no'}`,
    `apiKeyHelper=${authDebug.hasApiKeyHelper ? 'yes' : 'no'}`,
    `storedOauth=${authDebug.hasStoredOauthAccount ? 'yes' : 'no'}`,
    `primaryApiKey=${authDebug.hasPrimaryApiKey ? 'yes' : 'no'}`,
  ];

  return parts.join(', ');
}

function createDefaultWorkspacePath() {
  const workspaceName = `claude-code-ui-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const candidatePaths = [
    path.join(USER_TMP_DIR, workspaceName),
    path.join(MOSS_WORKSPACES_DIR, workspaceName),
  ];

  for (const candidate of candidatePaths) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {}
  }

  return repoRoot;
}

function hasFile(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function getSessionSummary(sessionRecord) {
  return {
    id: sessionRecord.id,
    title: sessionRecord.title,
    workspace: sessionRecord.workspace,
    createdAt: sessionRecord.createdAt,
    updatedAt: sessionRecord.updatedAt,
    busy: sessionRecord.busy,
    messageCount: sessionRecord.messageCount,
    sessionId: sessionRecord.underlyingSessionId,
    preview: sessionRecord.preview,
  };
}

function getBootStatus() {
  return {
    repoRoot,
    uiRoot,
    cliPath,
    sdkPath,
    cliReady: true, // 核心改动：不再依赖外部 cli-node.js，因为逻辑已经由 electron-direct.mjs 嵌入
    sdkReady: hasFile(sdkPath),
    sessionsCount: sessions.size,
    defaultBypassPermissions: DEFAULT_BYPASS_PERMISSIONS,
    defaultWorkspaceRoot: USER_TMP_DIR,
    appsDir: ensureAppsDir(),
    localSettingsAuthOnly: process.env.CLAUDE_CODE_LOCAL_SETTINGS_AUTH_ONLY === 'true',
    userSettingsPath: localSettingsAuthConfig.path,
    userSettingsExists: localSettingsAuthConfig.exists,
    userSettingsLoaded: localSettingsAuthConfig.loaded,
    userSettingsInjected: localSettingsAuthConfig.injected,
    userSettingsParseError: localSettingsAuthConfig.parseError,
    desktopSettingsPath: DESKTOP_SETTINGS_PATH,
    desktopSettingsExists: desktopSettingsState.exists,
    desktopSettingsLoaded: desktopSettingsState.loaded,
    desktopSettingsParseError: desktopSettingsState.parseError,
  };
}

function emitToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(channel, payload);
}

function emitSessionMeta(sessionRecord) {
  emitToRenderer('agent:session-meta', getSessionSummary(sessionRecord));
}

function emitAppsChanged(payload = {}) {
  emitToRenderer('app:changed', {
    timestamp: Date.now(),
    ...payload,
  });
}

function normalizeWorkspace(workspace) {
  const normalized = workspace && String(workspace).trim() ? String(workspace).trim() : createDefaultWorkspacePath();
  return path.resolve(normalized);
}

function buildSessionTitle(prompt) {
  const line = String(prompt || '')
    .split('\n')
    .map((entry) => entry.trim())
    .find(Boolean);
  if (!line) return 'New Session';
  return line.length > 36 ? `${line.slice(0, 36)}...` : line;
}

function slugifyAppName(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function ensureAppsDir() {
  fs.mkdirSync(MOSS_APPS_DIR, { recursive: true });
  return MOSS_APPS_DIR;
}

function ensureAppDataRootDir() {
  fs.mkdirSync(MOSS_APP_DATA_DIR, { recursive: true });
  return MOSS_APP_DATA_DIR;
}

function ensureAppDataDir(name) {
  const dataDir = path.join(ensureAppDataRootDir(), name);
  fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}

function ensureAppFilesDir(name) {
  const filesDir = path.join(ensureAppDataDir(name), APP_FILES_SUBDIR);
  fs.mkdirSync(filesDir, { recursive: true });
  return filesDir;
}

function ensureAppVersionsDir(name) {
  const versionsDir = path.join(ensureAppDataDir(name), APP_VERSIONS_SUBDIR);
  fs.mkdirSync(versionsDir, { recursive: true });
  return versionsDir;
}

function getAppStoragePath(name) {
  return path.join(ensureAppDataDir(name), APP_STORAGE_FILENAME);
}

function getAppFilePath(name) {
  return path.join(ensureAppsDir(), `${name}.html`);
}

function buildStoredAppHtml(appRecord) {
  const metadata = {
    '@context': APP_SCHEMA_CONTEXT,
    '@type': APP_SCHEMA_TYPE,
    name: appRecord.name,
    description: appRecord.description,
    width: appRecord.width,
    height: appRecord.height,
    resizable: appRecord.resizable,
    mcpServers: ['apps'],
    runtime: {
      hostApi: 'window.gooseApp',
      capabilities: ['storage', 'files', 'agent', 'resources'],
    },
  };
  const cspMeta = `  <meta http-equiv="Content-Security-Policy" content="${APP_CSP_CONTENT}">`;

  const metadataScript = `  <script type="${APP_METADATA_SCRIPT_TYPE}">\n${JSON.stringify(
    metadata,
    null,
    2
  )}\n  </script>`;
  const prdScript = appRecord.prd
    ? `  <script type="${APP_PRD_SCRIPT_TYPE}">\n${appRecord.prd}\n  </script>`
    : '';
  const scripts = prdScript ? `${cspMeta}\n${metadataScript}\n${prdScript}\n` : `${cspMeta}\n${metadataScript}\n`;
  const html = String(appRecord.html || '').trim();

  if (html.includes('</head>')) {
    return html.replace('</head>', `${scripts}</head>`);
  }

  if (html.includes('<html')) {
    const htmlTagEnd = html.indexOf('>');
    if (htmlTagEnd !== -1) {
      return `${html.slice(0, htmlTagEnd + 1)}\n<head>\n${scripts}</head>\n${html.slice(htmlTagEnd + 1)}`;
    }
  }

  return `<html>\n<head>\n${scripts}</head>\n<body>\n${html}\n</body>\n</html>`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseStoredAppHtml(fileContent, filePath = '') {
  const metadataScriptType = escapeRegExp(APP_METADATA_SCRIPT_TYPE);
  const prdScriptType = escapeRegExp(APP_PRD_SCRIPT_TYPE);
  const metadataMatch = fileContent.match(
    new RegExp(`<script type="${metadataScriptType}"[^>]*>\\s*([\\s\\S]*?)\\s*<\\/script>`, 'i')
  );
  if (!metadataMatch) {
    throw new Error(`Missing app metadata in ${filePath || 'HTML content'}`);
  }

  const metadata = JSON.parse(metadataMatch[1]);
  const prdMatch = fileContent.match(
    new RegExp(`<script type="${prdScriptType}"[^>]*>\\s*([\\s\\S]*?)\\s*<\\/script>`, 'i')
  );

  const cleanHtml = fileContent
    .replace(
      new RegExp(`<script type="${metadataScriptType}"[^>]*>[\\s\\S]*?<\\/script>`, 'ig'),
      ''
    )
    .replace(
      new RegExp(`<script type="${prdScriptType}"[^>]*>[\\s\\S]*?<\\/script>`, 'ig'),
      ''
    )
    .trim();

  return {
    name: String(metadata.name || ''),
    description: String(metadata.description || ''),
    width: Number(metadata.width) || 900,
    height: Number(metadata.height) || 700,
    resizable: metadata.resizable !== false,
    html: cleanHtml,
    prd: prdMatch?.[1]?.trim() || '',
    filePath,
  };
}

function listStoredApps() {
  const entries = fs.readdirSync(ensureAppsDir(), { withFileTypes: true });
  const apps = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
    const filePath = path.join(ensureAppsDir(), entry.name);
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsed = parseStoredAppHtml(fileContent, filePath);
      const stat = fs.statSync(filePath);
      const versions = listAppVersionSnapshots(parsed.name);
      apps.push({
        name: parsed.name,
        description: parsed.description,
        width: parsed.width,
        height: parsed.height,
        resizable: parsed.resizable,
        filePath,
        createdAt: stat.birthtimeMs || stat.ctimeMs || Date.now(),
        updatedAt: stat.mtimeMs || Date.now(),
        versionCount: versions.length,
        latestVersionId: versions[0]?.id || null,
      });
    } catch (error) {
      console.warn(`Failed to load stored app from ${filePath}:`, error);
    }
  }

  return apps.sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveStoredApp(appRecord) {
  ensureAppsDir();
  const existingNames = new Set(listStoredApps().map((entry) => entry.name));
  const baseName = slugifyAppName(appRecord.name) || `generated-app-${Date.now()}`;
  let name = baseName;
  let counter = 1;

  while (existingNames.has(name)) {
    name = `${baseName}-${counter}`;
    counter += 1;
  }

  const nextRecord = { ...appRecord, name };
  const filePath = getAppFilePath(name);
  fs.writeFileSync(filePath, buildStoredAppHtml(nextRecord), 'utf8');
  const snapshot = saveAppVersionSnapshot(nextRecord, { reason: 'created' });
  const stat = fs.statSync(filePath);

  return {
    name,
    description: nextRecord.description,
    width: nextRecord.width,
    height: nextRecord.height,
    resizable: nextRecord.resizable,
    filePath,
    createdAt: stat.birthtimeMs || stat.ctimeMs || Date.now(),
    updatedAt: stat.mtimeMs || Date.now(),
    versionCount: 1,
    latestVersionId: snapshot.id,
  };
}

function updateStoredApp(name, appRecord, options = {}) {
  const existing = getStoredApp(name);
  const nextRecord = {
    ...appRecord,
    name,
  };
  fs.writeFileSync(existing.filePath, buildStoredAppHtml(nextRecord), 'utf8');
  const snapshot = options.saveVersion === false
    ? null
    : saveAppVersionSnapshot(nextRecord, { reason: options.reason || 'updated' });
  const stat = fs.statSync(existing.filePath);
  const versions = listAppVersionSnapshots(name);

  return {
    name,
    description: nextRecord.description,
    width: nextRecord.width,
    height: nextRecord.height,
    resizable: nextRecord.resizable,
    filePath: existing.filePath,
    createdAt: stat.birthtimeMs || stat.ctimeMs || Date.now(),
    updatedAt: stat.mtimeMs || Date.now(),
    versionCount: versions.length,
    latestVersionId: snapshot?.id || versions[0]?.id || null,
  };
}

function toAppVersionSnapshotRecord(appRecord, extra = {}) {
  return {
    id: extra.id || `${Date.now()}-${randomUUID().slice(0, 8)}`,
    appName: appRecord.name,
    createdAt: extra.createdAt || Date.now(),
    reason: extra.reason || 'updated',
    note: extra.note || '',
    description: appRecord.description || '',
    width: appRecord.width || 900,
    height: appRecord.height || 700,
    resizable: appRecord.resizable !== false,
    prd: appRecord.prd || '',
    html: appRecord.html || '',
  };
}

function saveAppVersionSnapshot(appRecord, extra = {}) {
  const snapshot = toAppVersionSnapshotRecord(appRecord, extra);
  const filePath = path.join(ensureAppVersionsDir(appRecord.name), `${snapshot.id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return snapshot;
}

function listAppVersionSnapshots(name) {
  const versionsDir = ensureAppVersionsDir(name);
  const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
  const versions = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(versionsDir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      versions.push({
        id: String(parsed.id || path.basename(entry.name, '.json')),
        createdAt: Number(parsed.createdAt) || Date.now(),
        reason: String(parsed.reason || 'updated'),
        note: String(parsed.note || ''),
        description: String(parsed.description || ''),
        width: Number(parsed.width) || 900,
        height: Number(parsed.height) || 700,
        resizable: parsed.resizable !== false,
      });
    } catch (error) {
      console.warn(`Failed to load app version snapshot from ${filePath}:`, error);
    }
  }

  return versions.sort((a, b) => b.createdAt - a.createdAt);
}

function getAppVersionSnapshot(name, versionId) {
  const targetPath = path.join(ensureAppVersionsDir(name), `${versionId}.json`);
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Unknown app version: ${versionId}`);
  }
  const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  return {
    id: String(parsed.id || versionId),
    appName: name,
    createdAt: Number(parsed.createdAt) || Date.now(),
    reason: String(parsed.reason || 'updated'),
    note: String(parsed.note || ''),
    description: String(parsed.description || ''),
    width: Number(parsed.width) || 900,
    height: Number(parsed.height) || 700,
    resizable: parsed.resizable !== false,
    prd: String(parsed.prd || ''),
    html: String(parsed.html || ''),
  };
}

function rollbackAppToVersion(name, versionId) {
  const snapshot = getAppVersionSnapshot(name, versionId);
  const rolledBackApp = updateStoredApp(name, {
    name,
    description: snapshot.description,
    width: snapshot.width,
    height: snapshot.height,
    resizable: snapshot.resizable,
    prd: snapshot.prd,
    html: snapshot.html,
  }, {
    saveVersion: false,
  });

  return {
    ...rolledBackApp,
    versionCount: listAppVersionSnapshots(name).length,
    latestVersionId: versionId,
  };
}

function deleteStoredApp(name) {
  const appEntry = listStoredApps().find((entry) => entry.name === name);
  if (!appEntry) {
    throw new Error(`Unknown app: ${name}`);
  }

  fs.rmSync(appEntry.filePath, { force: true });
  fs.rmSync(path.join(ensureAppDataRootDir(), name), { recursive: true, force: true });
}

function getStoredApp(name) {
  const appEntry = listStoredApps().find((entry) => entry.name === name);
  if (!appEntry) {
    throw new Error(`Unknown app: ${name}`);
  }
  return appEntry;
}

function loadStoredAppContent(name) {
  const appEntry = getStoredApp(name);
  const fileContent = fs.readFileSync(appEntry.filePath, 'utf8');
  return {
    ...appEntry,
    ...parseStoredAppHtml(fileContent, appEntry.filePath),
  };
}

function createAppWindowState(appEntry, appWindow) {
  const state = {
    name: appEntry.name,
    window: appWindow,
    dataDir: ensureAppDataDir(appEntry.name),
    filesDir: ensureAppFilesDir(appEntry.name),
    versionsDir: ensureAppVersionsDir(appEntry.name),
    storagePath: getAppStoragePath(appEntry.name),
    runtime: null,
    underlyingSessionId: null,
    busy: false,
    currentAgentRequestId: null,
    currentAgentContext: '',
  };
  appWindowStates.set(appWindow.webContents.id, state);
  return state;
}

function getAppWindowStateBySender(sender) {
  const state = appWindowStates.get(sender.id);
  if (!state) {
    throw new Error('App runtime is not available for this window.');
  }
  return state;
}

function disposeAppRuntime(appState) {
  if (!appState?.runtime) return;
  appState.runtime.dispose();
  appState.runtime = null;
  appState.underlyingSessionId = null;
  appState.currentAgentRequestId = null;
  appState.busy = false;
}

function emitToAppWindow(appState, channel, payload) {
  if (!appState?.window || appState.window.isDestroyed()) return;
  appState.window.webContents.send(channel, payload);
}

function emitAppRuntimeEvent(appState, eventType, payload = {}) {
  emitToAppWindow(appState, 'app-runtime:event', {
    type: eventType,
    appName: appState.name,
    timestamp: Date.now(),
    ...payload,
  });
}

function readAppStorageSnapshot(appState) {
  try {
    if (!fs.existsSync(appState.storagePath)) {
      return {};
    }
    const raw = fs.readFileSync(appState.storagePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAppStorageSnapshot(appState, snapshot) {
  fs.mkdirSync(path.dirname(appState.storagePath), { recursive: true });
  fs.writeFileSync(appState.storagePath, JSON.stringify(snapshot, null, 2), 'utf8');
}

function getAppInfoPayload(appState) {
  const storedApp = loadStoredAppContent(appState.name);
  return {
    name: storedApp.name,
    description: storedApp.description,
    width: storedApp.width,
    height: storedApp.height,
    resizable: storedApp.resizable,
    prd: storedApp.prd,
    filePath: storedApp.filePath,
    dataDir: appState.dataDir,
    filesDir: appState.filesDir,
    versionsDir: appState.versionsDir,
    hostApi: 'window.gooseApp',
  };
}

function listAppResourceDescriptors(appState) {
  return [
    { uri: 'app://meta', mimeType: 'application/json', description: 'Current app metadata and host paths.' },
    { uri: 'app://prd', mimeType: 'text/plain', description: 'Current app PRD.' },
    { uri: 'app://html', mimeType: 'text/html', description: 'Current app HTML document.' },
    { uri: 'app://storage', mimeType: 'application/json', description: 'Current key/value storage snapshot.' },
    { uri: 'app://files/<path>', mimeType: 'text/plain', description: 'Text file under the app data files directory.' },
    { uri: 'app://versions', mimeType: 'application/json', description: 'Available app version snapshots.' },
  ];
}

function listAppToolDescriptors() {
  return [
    { name: 'storage.get', description: 'Read one storage value by key.' },
    { name: 'storage.set', description: 'Persist one storage value by key.' },
    { name: 'storage.remove', description: 'Delete one storage value by key.' },
    { name: 'storage.list', description: 'List storage keys.' },
    { name: 'files.list', description: 'List files and directories under the app files root.' },
    { name: 'files.read_text', description: 'Read a UTF-8 text file from the app files root.' },
    { name: 'files.write_text', description: 'Write a UTF-8 text file to the app files root.' },
    { name: 'files.delete', description: 'Delete a file or directory from the app files root.' },
    { name: 'files.mkdir', description: 'Create a directory under the app files root.' },
    { name: 'resources.read', description: 'Read a runtime resource by URI.' },
    { name: 'resources.list', description: 'List runtime resource descriptors.' },
    { name: 'versions.list', description: 'List saved app version snapshots.' },
    { name: 'versions.rollback', description: 'Roll back the current app to a saved version id.' },
    { name: 'agent.send', description: 'Send a prompt to the app-scoped agent. Supports streaming and context.' },
    { name: 'agent.cancel', description: 'Cancel the in-flight app agent request.' },
    { name: 'agent.reset', description: 'Dispose the current app agent runtime.' },
    { name: 'tools.list', description: 'List available runtime tools.' },
  ];
}

async function listAppFiles(appState, dirPath = '.') {
  const root = appState.filesDir;
  const targetPath = ensureInsideRoot(root, path.join(root, dirPath));
  await fsp.mkdir(targetPath, { recursive: true });
  const dirents = await fsp.readdir(targetPath, { withFileTypes: true });

  const items = dirents
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => {
      const fullPath = path.join(targetPath, entry.name);
      return {
        name: entry.name,
        path: path.relative(root, fullPath) || '.',
        absolutePath: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  return {
    root,
    path: path.relative(root, targetPath) || '.',
    items,
  };
}

async function readAppTextFile(appState, filePath) {
  const targetPath = ensureInsideRoot(appState.filesDir, path.join(appState.filesDir, filePath));
  const stat = await fsp.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error('Target is not a file.');
  }
  const buffer = await fsp.readFile(targetPath);
  if (buffer.includes(0)) {
    throw new Error('Binary files are not supported by this runtime API.');
  }
  return {
    path: path.relative(appState.filesDir, targetPath),
    content: buffer.toString('utf8'),
    size: stat.size,
  };
}

async function writeAppTextFile(appState, filePath, content) {
  const targetPath = ensureInsideRoot(appState.filesDir, path.join(appState.filesDir, filePath));
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  await fsp.writeFile(targetPath, String(content ?? ''), 'utf8');
  const stat = await fsp.stat(targetPath);
  return {
    path: path.relative(appState.filesDir, targetPath),
    size: stat.size,
  };
}

async function deleteAppFile(appState, filePath) {
  const targetPath = ensureInsideRoot(appState.filesDir, path.join(appState.filesDir, filePath));
  await fsp.rm(targetPath, { recursive: true, force: true });
  return { ok: true };
}

async function makeAppDirectory(appState, dirPath) {
  const targetPath = ensureInsideRoot(appState.filesDir, path.join(appState.filesDir, dirPath));
  await fsp.mkdir(targetPath, { recursive: true });
  return {
    path: path.relative(appState.filesDir, targetPath) || '.',
  };
}

async function readAppResource(appState, uri) {
  const normalizedUri = String(uri || '').trim();
  if (!normalizedUri) {
    throw new Error('Resource URI is required.');
  }

  if (normalizedUri === 'app://meta') {
    const info = getAppInfoPayload(appState);
    return {
      uri: normalizedUri,
      mimeType: 'application/json',
      text: JSON.stringify(info, null, 2),
      data: info,
    };
  }

  if (normalizedUri === 'app://prd') {
    const info = getAppInfoPayload(appState);
    return {
      uri: normalizedUri,
      mimeType: 'text/plain',
      text: info.prd || '',
    };
  }

  if (normalizedUri === 'app://html') {
    const storedApp = loadStoredAppContent(appState.name);
    return {
      uri: normalizedUri,
      mimeType: 'text/html',
      text: storedApp.html,
    };
  }

  if (normalizedUri === 'app://storage') {
    const storage = readAppStorageSnapshot(appState);
    return {
      uri: normalizedUri,
      mimeType: 'application/json',
      text: JSON.stringify(storage, null, 2),
      data: storage,
    };
  }

  if (normalizedUri === 'app://versions') {
    const versions = listAppVersionSnapshots(appState.name);
    return {
      uri: normalizedUri,
      mimeType: 'application/json',
      text: JSON.stringify(versions, null, 2),
      data: versions,
    };
  }

  if (normalizedUri.startsWith('app://files/')) {
    const relativePath = normalizedUri.slice('app://files/'.length);
    const file = await readAppTextFile(appState, relativePath);
    return {
      uri: normalizedUri,
      mimeType: 'text/plain',
      text: file.content,
      data: file,
    };
  }

  throw new Error(`Unsupported resource URI: ${normalizedUri}`);
}

async function ensureAppAgentRuntime(appState) {
  if (!hasFile(sdkPath)) {
    throw new Error(`Missing electron-direct.mjs at ${sdkPath}.`);
  }

  if (appState.runtime) {
    return appState.runtime;
  }

  const ClaudeSession = await getClaudeSessionCtor();
  appState.runtime = new ClaudeSession({
    ...buildClaudeSessionConfig(appState.dataDir),
    onPermissionRequest: async (toolName, input) => {
      const toolLabel = toolName || 'Tool';
      const detailParts = [];
      if (input) detailParts.push(`输入:\n${JSON.stringify(input, null, 2)}`);

      const dialogTarget = appState.window && !appState.window.isDestroyed()
        ? appState.window
        : mainWindow && !mainWindow.isDestroyed()
          ? mainWindow
          : undefined;

      const response = await dialog.showMessageBox(dialogTarget, {
        type: 'question',
        buttons: ['允许', '拒绝'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'App 工具权限确认',
        message: `${appState.name} 请求执行 ${toolLabel}`,
        detail: detailParts.join('\n\n') || '应用中的 agent 请求工具执行权限。',
      });

      return response.response === 0;
    },
  });
  return appState.runtime;
}

function buildAppAgentPrompt(appState, prompt, systemPrompt = '') {
  const info = getAppInfoPayload(appState);
  const parts = [];
  if (systemPrompt && String(systemPrompt).trim()) {
    parts.push(`SYSTEM INSTRUCTIONS:\n${String(systemPrompt).trim()}`);
  }
  if (appState.currentAgentContext) {
    parts.push(`APP CONTEXT:\n${appState.currentAgentContext}`);
  }
  parts.push(
    'You are assisting an Electron mini app through its host runtime.',
    `App name: ${info.name}`,
    `App description: ${info.description || 'n/a'}`,
    `App data directory: ${info.dataDir}`,
    '',
    'App PRD:',
    info.prd || '(empty)',
    '',
    'User request:',
    String(prompt || '').trim()
  );
  return parts.join('\n');
}

function buildAgentContextBlock(context) {
  if (context == null) return '';
  if (typeof context === 'string') {
    return context.trim();
  }
  try {
    return JSON.stringify(context, null, 2);
  } catch {
    return String(context);
  }
}

function normalizeAppAgentResult(appState, requestId, result) {
  return {
    ok: true,
    requestId,
    sessionId: appState.underlyingSessionId,
    text: result.text || '',
    content: [{ type: 'text', text: result.text || '' }],
    completedAt: Date.now(),
  };
}

async function sendPromptToAppAgent(appState, payload = {}) {
  if (appState.busy) {
    return {
      ok: false,
      error: {
        code: 'busy',
        message: 'This app agent is already processing a request.',
      },
    };
  }

  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) {
    return {
      ok: false,
      error: {
        code: 'invalid_prompt',
        message: 'Prompt is required.',
      },
    };
  }

  const runtime = await ensureAppAgentRuntime(appState);
  const requestId = typeof payload.requestId === 'string' && payload.requestId.trim()
    ? payload.requestId.trim()
    : randomUUID();
  const stream = payload.stream === true;
  const contextBlock = buildAgentContextBlock(payload.context);
  appState.currentAgentContext = contextBlock;
  const runtimePrompt = buildAppAgentPrompt(appState, prompt, payload.systemPrompt);

  const runRequest = async () => {
    appState.busy = true;
    appState.currentAgentRequestId = requestId;
    emitAppRuntimeEvent(appState, 'agent:start', {
      requestId,
      prompt,
      stream,
    });

    try {
      let latestAssistantText = '';
      let streamedAssistantText = '';

      for await (const message of runtime.send(runtimePrompt)) {
        if (message.session_id) {
          appState.underlyingSessionId = message.session_id;
        }
        if (message.type === 'assistant') {
          const assistantText = extractTextFromAssistantMessage(message);
          if (assistantText) {
            latestAssistantText = assistantText;
          }
        } else if (
          message.type === 'stream_event' &&
          message.event?.type === 'content_block_delta' &&
          message.event?.delta?.type === 'text_delta' &&
          typeof message.event.delta.text === 'string'
        ) {
          streamedAssistantText += message.event.delta.text;
          emitAppRuntimeEvent(appState, 'agent:delta', {
            requestId,
            delta: message.event.delta.text,
            text: streamedAssistantText,
          });
        }
      }

      const finalResult = normalizeAppAgentResult(appState, requestId, {
        text: latestAssistantText || streamedAssistantText,
      });
      emitAppRuntimeEvent(appState, 'agent:complete', finalResult);
      return finalResult;
    } catch (error) {
      const normalizedError = {
        ok: false,
        requestId,
        error: {
          code: 'agent_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      };
      emitAppRuntimeEvent(appState, 'agent:error', normalizedError);
      return normalizedError;
    } finally {
      appState.busy = false;
      appState.currentAgentRequestId = null;
    }
  };

  if (stream) {
    void runRequest();
    return {
      ok: true,
      requestId,
      streaming: true,
      sessionId: appState.underlyingSessionId,
    };
  }

  return runRequest();
}

function cancelAppAgentRequest(appState, requestId = '') {
  if (!appState.busy || !appState.runtime) {
    return {
      ok: false,
      error: {
        code: 'not_running',
        message: 'No in-flight app agent request.',
      },
    };
  }
  if (requestId && appState.currentAgentRequestId && requestId !== appState.currentAgentRequestId) {
    return {
      ok: false,
      error: {
        code: 'request_mismatch',
        message: 'Request id does not match the active app agent request.',
      },
    };
  }

  appState.runtime.abort();
  emitAppRuntimeEvent(appState, 'agent:cancelled', {
    requestId: appState.currentAgentRequestId,
  });
  return {
    ok: true,
    requestId: appState.currentAgentRequestId,
  };
}

async function callAppTool(appState, name, args = {}) {
  switch (name) {
    case 'storage.get': {
      const key = String(args.key || '').trim();
      if (!key) throw new Error('storage.get requires key.');
      const storage = readAppStorageSnapshot(appState);
      return storage[key];
    }
    case 'storage.set': {
      const key = String(args.key || '').trim();
      if (!key) throw new Error('storage.set requires key.');
      const storage = readAppStorageSnapshot(appState);
      storage[key] = args.value;
      writeAppStorageSnapshot(appState, storage);
      emitAppRuntimeEvent(appState, 'storage:changed', {
        key,
        value: args.value,
        action: 'set',
      });
      return { ok: true, key, value: args.value };
    }
    case 'storage.remove': {
      const key = String(args.key || '').trim();
      if (!key) throw new Error('storage.remove requires key.');
      const storage = readAppStorageSnapshot(appState);
      delete storage[key];
      writeAppStorageSnapshot(appState, storage);
      emitAppRuntimeEvent(appState, 'storage:changed', {
        key,
        action: 'remove',
      });
      return { ok: true, key };
    }
    case 'storage.list':
      return Object.keys(readAppStorageSnapshot(appState));
    case 'files.list':
      return listAppFiles(appState, args.path || '.');
    case 'files.read_text':
      return readAppTextFile(appState, args.path);
    case 'files.write_text':
      return writeAppTextFile(appState, args.path, args.content).then((result) => {
        emitAppRuntimeEvent(appState, 'files:changed', {
          action: 'write',
          path: result.path,
        });
        return result;
      });
    case 'files.delete':
      return deleteAppFile(appState, args.path).then((result) => {
        emitAppRuntimeEvent(appState, 'files:changed', {
          action: 'delete',
          path: args.path,
        });
        return result;
      });
    case 'files.mkdir':
      return makeAppDirectory(appState, args.path || '.').then((result) => {
        emitAppRuntimeEvent(appState, 'files:changed', {
          action: 'mkdir',
          path: result.path,
        });
        return result;
      });
    case 'resources.read':
      return readAppResource(appState, args.uri);
    case 'resources.list':
      return listAppResourceDescriptors(appState);
    case 'versions.list':
      return listAppVersionSnapshots(appState.name);
    case 'versions.rollback': {
      const versionId = String(args.versionId || '').trim();
      if (!versionId) throw new Error('versions.rollback requires versionId.');
      const rolledBack = rollbackAppToVersion(appState.name, versionId);
      emitAppsChanged({ action: 'rolled-back', name: appState.name });
      emitAppRuntimeEvent(appState, 'app:rolled-back', {
        versionId,
        app: rolledBack,
      });
      refreshOpenAppWindow(appState.name);
      return {
        ok: true,
        versionId,
        app: rolledBack,
      };
    }
    case 'agent.send':
      return sendPromptToAppAgent(appState, args);
    case 'agent.cancel':
      return cancelAppAgentRequest(appState, String(args.requestId || ''));
    case 'agent.reset':
      disposeAppRuntime(appState);
      emitAppRuntimeEvent(appState, 'agent:reset', {});
      return { ok: true };
    case 'tools.list':
      return listAppToolDescriptors();
    default:
      throw new Error(`Unknown app tool: ${name}`);
  }
}

function extractTextFromAssistantMessage(message) {
  if (!Array.isArray(message?.message?.content)) return '';
  return message.message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractAppPayloadFromText(content) {
  const htmlMatch = content.match(/```html\s*([\s\S]*?)```/i);
  if (!htmlMatch) {
    throw new Error('Agent response did not contain an ```html``` block.');
  }

  const metaMatch =
    content.match(/```app-meta\s*([\s\S]*?)```/i) ||
    content.match(/```json\s*([\s\S]*?)```/i);

  if (!metaMatch) {
    throw new Error('Agent response did not contain an app metadata block.');
  }

  let metadata;
  try {
    metadata = JSON.parse(metaMatch[1]);
  } catch (error) {
    throw new Error(
      `Failed to parse app metadata JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const html = htmlMatch[1].trim();
  if (!html.toLowerCase().includes('<html')) {
    throw new Error('Generated HTML block did not contain a full HTML document.');
  }

  return {
    name: slugifyAppName(metadata?.name) || `generated-app-${Date.now()}`,
    description: String(metadata?.description || '').trim(),
    width: Number(metadata?.width) || 900,
    height: Number(metadata?.height) || 700,
    resizable: metadata?.resizable !== false,
    html,
  };
}

function buildCreateAppPrompt(prd) {
  return [
    'You are generating a standalone single-file desktop mini app.',
    'First, output your thinking process and a step-by-step execution plan. Explain what features you are implementing and how.',
    'Then, return the final app code in exactly two fenced blocks at the very END of your response.',
    'First block must be ```app-meta with JSON.',
    'Second block must be ```html containing the full code.',
    'Rules:',
    '- BE VERBOSE about your plan and progress BEFORE outputting the code.',
    '- Use vanilla HTML/CSS/JavaScript only.',
    '- Keep the app fully self-contained.',
    '- Make the UI polished and usable.',
    '- Name must be lowercase and hyphenated.',
    '- The app runs inside Electron and can access a host runtime API via window.gooseApp.',
    '',
    'Available host runtime APIs (all async):',
    '- window.gooseApp.getAppInfo()',
    '- window.gooseApp.readResource(uri)',
    '- window.gooseApp.storage.get(key), set(key, value), remove(key), listKeys()',
    '- window.gooseApp.files.list(path?), readText(path), writeText(path, content), delete(path), mkdir(path)',
    '- window.gooseApp.agent.send({ prompt, systemPrompt? })',
    '- window.gooseApp.agent.reset()',
    '',
    'App request:',
    String(prd || '').trim(),
  ].join('\n');
}

function buildIterateAppPrompt(appRecord, feedback) {
  return [
    'You are updating an existing standalone single-file desktop mini app.',
    'First, analyze the requested changes and output your modification plan step-by-step.',
    'Then, return the full updated app code in exactly two fenced blocks at the very END of your response.',
    'First block must be ```app-meta with JSON.',
    'Second block must be ```html containing the full code.',
    'Rules:',
    '- BE VERBOSE about your analysis and what you are fixing/adding BEFORE outputting the code.',
    '- Keep the app name unchanged.',
    '- Use vanilla HTML/CSS/JavaScript only.',
    '- Keep the app fully self-contained.',
    '- The app runs inside Electron and can access a host runtime API via window.gooseApp.',
    '',
    'Current app PRD:',
    appRecord.prd || '(empty)',
    '',
    'Current app HTML:',
    '```html',
    appRecord.html || '',
    '```',
    '',
    'Requested update:',
    String(feedback || '').trim(),
  ].join('\n');
}

function refreshOpenAppWindow(name) {
  const existingWindow = appWindows.get(name);
  if (!existingWindow || existingWindow.isDestroyed()) return;
  const appState = appWindowStates.get(existingWindow.webContents.id);
  if (appState) {
    disposeAppRuntime(appState);
  }
  const appEntry = getStoredApp(name);
  void existingWindow.loadFile(appEntry.filePath);
}

function launchAppWindowByEntry(appEntry) {
  const existingWindow = appWindows.get(appEntry.name);
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (existingWindow.isMinimized()) {
      existingWindow.restore();
    }
    existingWindow.show();
    existingWindow.focus();
    return existingWindow;
  }

  const appWindow = new BrowserWindow({
    title: appEntry.name,
    width: appEntry.width || 900,
    height: appEntry.height || 700,
    resizable: appEntry.resizable !== false,
    backgroundColor: '#0b1120',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'app-preload.mjs'),
      sandbox: false, // 核心修复：必须关闭 sandbox 模式，Host API 才能在 ContextBridge 中正确挂载
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  appWindows.set(appEntry.name, appWindow);
  const appState = createAppWindowState(appEntry, appWindow);
  appWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  appWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== appWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) {
        void shell.openExternal(url);
      }
    }
  });
  appWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  appWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  appWindow.on('closed', () => {
    const state = appWindowStates.get(appWindow.webContents.id);
    if (state) {
      disposeAppRuntime(state);
      appWindowStates.delete(appWindow.webContents.id);
    }
    appWindows.delete(appEntry.name);
  });
  emitAppRuntimeEvent(appState, 'app:window-opened', {
    name: appEntry.name,
  });
  void appWindow.loadFile(appEntry.filePath);
  return appWindow;
}

function ensureInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the active workspace.');
  }
  return resolvedTarget;
}

function createSessionRecord({ workspace } = {}) {
  const now = Date.now();
  const normalizedWorkspace = normalizeWorkspace(workspace);
  fs.mkdirSync(normalizedWorkspace, { recursive: true });

  // 核心改动：在工作区初始化 git
  try {
    if (!fs.existsSync(path.join(normalizedWorkspace, '.git'))) {
      execSync('git init', { cwd: normalizedWorkspace, stdio: 'ignore' });
    }
  } catch (error) {
    console.warn(`Failed to initialize git in ${normalizedWorkspace}:`, error);
  }

  const sessionRecord = {
    id: randomUUID(),
    title: 'New Session',
    workspace: normalizedWorkspace,
    createdAt: now,
    updatedAt: now,
    busy: false,
    messageCount: 0,
    preview: '',
    underlyingSessionId: null,
    history: [],
    runtime: null,
    workspaceWatcher: null,
    workspaceWatcherSyncTimer: null,
    persistTimer: null,
  };
  sessions.set(sessionRecord.id, sessionRecord);
  persistSessionRecord(sessionRecord);
  void startWorkspaceWatcher(sessionRecord);
  emitSessionMeta(sessionRecord);
  return sessionRecord;
}

function getSessionRecord(sessionId) {
  const sessionRecord = sessions.get(sessionId);
  if (!sessionRecord) {
    throw new Error(`Unknown session: ${sessionId}`);
  }
  return sessionRecord;
}

function disposeRuntime(sessionRecord) {
  if (!sessionRecord.runtime) return;
  sessionRecord.runtime.dispose();
  sessionRecord.runtime = null;
  schedulePersistSession(sessionRecord, true);
}

function closeWorkspaceWatcher(sessionRecord) {
  if (!sessionRecord.workspaceWatcher) return;
  sessionRecord.workspaceWatcher.closed = true;
  for (const watcher of sessionRecord.workspaceWatcher.watchers.values()) {
    try {
      watcher.close();
    } catch {}
  }
  sessionRecord.workspaceWatcher.watchers.clear();
  sessionRecord.workspaceWatcher = null;
  if (sessionRecord.workspaceWatcherSyncTimer) {
    clearTimeout(sessionRecord.workspaceWatcherSyncTimer);
    sessionRecord.workspaceWatcherSyncTimer = null;
  }
  if (sessionRecord.persistTimer) {
    clearTimeout(sessionRecord.persistTimer);
    sessionRecord.persistTimer = null;
  }
}

async function collectDirectories(rootPath) {
  const directories = [];
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop();
    directories.push(current);
    let dirents = [];
    try {
      dirents = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of dirents) {
      if (!entry.isDirectory()) continue;
      if (entry.name === '.' || entry.name === '..') continue;
      pending.push(path.join(current, entry.name));
    }
  }
  return directories;
}

function emitWorkspaceChanged(sessionRecord, eventType, changedPath) {
  emitToRenderer('workspace:changed', {
    sessionId: sessionRecord.id,
    workspace: sessionRecord.workspace,
    eventType,
    path: changedPath,
    timestamp: Date.now(),
  });
}

async function syncWorkspaceWatcher(sessionRecord) {
  const watcherState = sessionRecord.workspaceWatcher;
  if (!watcherState || watcherState.closed) return;

  const directories = await collectDirectories(sessionRecord.workspace);
  if (watcherState.closed) return;
  const nextPaths = new Set(directories);

  for (const watchedPath of watcherState.watchers.keys()) {
    if (nextPaths.has(watchedPath)) continue;
    try {
      watcherState.watchers.get(watchedPath)?.close();
    } catch {}
    watcherState.watchers.delete(watchedPath);
  }

  for (const dirPath of directories) {
    if (watcherState.watchers.has(dirPath)) continue;
    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        const changedPath = filename ? path.join(dirPath, filename.toString()) : dirPath;
        emitWorkspaceChanged(sessionRecord, eventType, changedPath);
        if (sessionRecord.workspaceWatcherSyncTimer) {
          clearTimeout(sessionRecord.workspaceWatcherSyncTimer);
        }
        sessionRecord.workspaceWatcherSyncTimer = setTimeout(() => {
          sessionRecord.workspaceWatcherSyncTimer = null;
          void syncWorkspaceWatcher(sessionRecord);
        }, 150);
      });
      watcherState.watchers.set(dirPath, watcher);
    } catch {}
  }
}

async function startWorkspaceWatcher(sessionRecord) {
  closeWorkspaceWatcher(sessionRecord);
  sessionRecord.workspaceWatcher = {
    closed: false,
    watchers: new Map(),
  };
  await syncWorkspaceWatcher(sessionRecord);
}

async function ensureRuntime(sessionRecord) {
  if (!hasFile(sdkPath)) {
    throw new Error(`Missing electron-direct.mjs at ${sdkPath}.`);
  }

  if (sessionRecord.runtime) {
    return sessionRecord.runtime;
  }

  const ClaudeSession = await getClaudeSessionCtor();

  sessionRecord.runtime = new ClaudeSession({
    ...buildClaudeSessionConfig(sessionRecord.workspace),
    onPermissionRequest: async (toolName, input) => {
      const toolLabel = toolName || 'Tool';
      const detailParts = [];
      if (input) detailParts.push(`输入:\n${JSON.stringify(input, null, 2)}`);

      emitToRenderer('agent:permission', {
        sessionId: sessionRecord.id,
        request: {
          tool_name: toolName,
          input,
        },
      });

      const dialogTarget = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
      const response = await dialog.showMessageBox(dialogTarget, {
        type: 'question',
        buttons: ['允许', '拒绝'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: '工具权限确认',
        message: `${toolLabel} 请求执行`,
        detail: detailParts.join('\n\n') || '本地 agent 请求工具执行权限。',
      });

      if (response.response === 0) {
        return true;
      }

      return false;
    },
  });
  return sessionRecord.runtime;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 980,
    minWidth: 1220,
    minHeight: 780,
    title: 'Claude Code Electron UI',
    backgroundColor: '#09111c',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (!hasFile(rendererHtml)) {
    throw new Error(`Missing renderer build at ${rendererHtml}. Run "vite build" in ui first.`);
  }

  mainWindow.loadFile(rendererHtml);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function listDirectoryEntries(sessionRecord, dirPath) {
  const root = sessionRecord.workspace;
  const targetPath = ensureInsideRoot(root, dirPath || root);
  const dirents = await fsp.readdir(targetPath, { withFileTypes: true });

  const items = dirents
    .filter((entry) => !entry.name.startsWith('.'))
    .map((entry) => {
      const fullPath = path.join(targetPath, entry.name);
      return {
        name: entry.name,
        path: fullPath,
        relativePath: path.relative(root, fullPath) || entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });

  return {
    root,
    path: targetPath,
    relativePath: path.relative(root, targetPath) || '.',
    items,
  };
}

async function readWorkspaceFile(sessionRecord, filePath) {
  const targetPath = ensureInsideRoot(sessionRecord.workspace, filePath);
  const stat = await fsp.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error('Target is not a file.');
  }
  if (stat.size > MAX_FILE_BYTES) {
    return {
      path: targetPath,
      relativePath: path.relative(sessionRecord.workspace, targetPath),
      size: stat.size,
      truncated: true,
      content: `File too large to preview (${stat.size} bytes).`,
    };
  }

  const buffer = await fsp.readFile(targetPath);
  if (buffer.includes(0)) {
    return {
      path: targetPath,
      relativePath: path.relative(sessionRecord.workspace, targetPath),
      size: stat.size,
      truncated: false,
      content: 'Binary file preview is not supported in this app.',
    };
  }

  return {
    path: targetPath,
    relativePath: path.relative(sessionRecord.workspace, targetPath),
    size: stat.size,
    truncated: false,
    content: buffer.toString('utf8'),
  };
}

app.whenReady().then(() => {
  createWindow();
  for (const sessionRecord of sessions.values()) {
    void startWorkspaceWatcher(sessionRecord);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  for (const sessionRecord of sessions.values()) {
    closeWorkspaceWatcher(sessionRecord);
    disposeRuntime(sessionRecord);
  }
  for (const appState of appWindowStates.values()) {
    disposeAppRuntime(appState);
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('agent:get-status', () => getBootStatus());
ipcMain.handle('agent:get-auth-debug', async () => getAuthDebugSnapshot());
ipcMain.handle('agent:get-settings', () => getDesktopSettingsPayload());
ipcMain.handle('agent:update-settings', (_event, payload = {}) => refreshDesktopSettings(payload));

ipcMain.handle('agent:list-sessions', () => {
  return Array.from(sessions.values())
    .map(getSessionSummary)
    .sort((a, b) => b.updatedAt - a.updatedAt);
});

ipcMain.handle('agent:create-session', (_event, payload = {}) => {
  const sessionRecord = createSessionRecord({ workspace: payload.workspace });
  return {
    summary: getSessionSummary(sessionRecord),
    detail: {
      ...getSessionSummary(sessionRecord),
      history: sessionRecord.history,
    },
  };
});

ipcMain.handle('agent:get-session', (_event, { sessionId }) => {
  const sessionRecord = getSessionRecord(sessionId);
  return {
    ...getSessionSummary(sessionRecord),
    history: sessionRecord.history,
  };
});

ipcMain.handle('agent:update-session', (_event, { sessionId, title }) => {
  const sessionRecord = getSessionRecord(sessionId);
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  if (!normalizedTitle) {
    throw new Error('Title is required.');
  }

  sessionRecord.title = normalizedTitle;
  sessionRecord.updatedAt = Date.now();
  schedulePersistSession(sessionRecord, true);
  emitSessionMeta(sessionRecord);

  return {
    ...getSessionSummary(sessionRecord),
    history: sessionRecord.history,
  };
});

ipcMain.handle('agent:delete-session', (_event, { sessionId }) => {
  const sessionRecord = getSessionRecord(sessionId);
  closeWorkspaceWatcher(sessionRecord);
  disposeRuntime(sessionRecord);
  sessions.delete(sessionId);
  deletePersistedSession(sessionId);
  emitToRenderer('agent:session-removed', { sessionId });
  return { ok: true };
});

ipcMain.handle('agent:pick-directory', async () => {
  const response = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (response.canceled || response.filePaths.length === 0) {
    return null;
  }
  return response.filePaths[0];
});

ipcMain.handle('agent:set-session-workspace', async (_event, { sessionId, workspace }) => {
  const sessionRecord = getSessionRecord(sessionId);
  if (sessionRecord.messageCount > 0) {
    throw new Error('Workspace can only be changed before the first message.');
  }
  sessionRecord.workspace = normalizeWorkspace(workspace);
  await fsp.mkdir(sessionRecord.workspace, { recursive: true });
  await startWorkspaceWatcher(sessionRecord);
  sessionRecord.updatedAt = Date.now();
  schedulePersistSession(sessionRecord, true);
  emitSessionMeta(sessionRecord);
  return {
    ...getSessionSummary(sessionRecord),
    history: sessionRecord.history,
  };
});

ipcMain.handle('agent:abort', async (_event, { sessionId }) => {
  const sessionRecord = getSessionRecord(sessionId);
  sessionRecord.runtime?.abort();
  schedulePersistSession(sessionRecord, true);
  return { ok: true };
});

ipcMain.handle('workspace:list-dir', async (_event, { sessionId, dirPath }) => {
  const sessionRecord = getSessionRecord(sessionId);
  return listDirectoryEntries(sessionRecord, dirPath);
});

ipcMain.handle('workspace:read-file', async (_event, { sessionId, filePath }) => {
  const sessionRecord = getSessionRecord(sessionId);
  return readWorkspaceFile(sessionRecord, filePath);
});

ipcMain.handle('app:list', async () => {
  return listStoredApps().map(({ filePath, ...appEntry }) => appEntry);
});

ipcMain.handle('app:list-versions', async (_event, { name }) => {
  return listAppVersionSnapshots(name);
});

ipcMain.handle('app:launch', async (_event, { name }) => {
  launchAppWindowByEntry(getStoredApp(name));
  return { ok: true };
});

ipcMain.handle('app:rollback', async (_event, { name, versionId }) => {
  const rolledBack = rollbackAppToVersion(name, versionId);
  refreshOpenAppWindow(name);
  emitAppsChanged({
    action: 'rolled-back',
    app: rolledBack,
    versionId,
  });
  return {
    ok: true,
    app: rolledBack,
  };
});

ipcMain.handle('app:delete', async (_event, { name }) => {
  const existingWindow = appWindows.get(name);
  if (existingWindow && !existingWindow.isDestroyed()) {
    existingWindow.close();
  }
  deleteStoredApp(name);
  emitAppsChanged({ action: 'deleted', name });
  return { ok: true };
});

ipcMain.handle('app-runtime:get-info', async (event) => {
  const appState = getAppWindowStateBySender(event.sender);
  return getAppInfoPayload(appState);
});

ipcMain.handle('app-runtime:list-tools', async () => {
  return listAppToolDescriptors();
});

ipcMain.handle('app-runtime:list-resources', async (event) => {
  const appState = getAppWindowStateBySender(event.sender);
  return listAppResourceDescriptors(appState);
});

ipcMain.handle('app-runtime:read-resource', async (event, { uri }) => {
  const appState = getAppWindowStateBySender(event.sender);
  return readAppResource(appState, uri);
});

ipcMain.handle('app-runtime:call-tool', async (event, { name, args }) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, name, args);
});

ipcMain.handle('app-runtime:storage:get', async (event, { key }) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'storage.get', { key });
});

ipcMain.handle('app-runtime:storage:set', async (event, { key, value }) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'storage.set', { key, value });
});

ipcMain.handle('app-runtime:storage:remove', async (event, { key }) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'storage.remove', { key });
});

ipcMain.handle('app-runtime:storage:list', async (event) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'storage.list');
});

ipcMain.handle('app-runtime:files:list', async (event, payload = {}) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'files.list', payload);
});

ipcMain.handle('app-runtime:files:read-text', async (event, payload = {}) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'files.read_text', payload);
});

ipcMain.handle('app-runtime:files:write-text', async (event, payload = {}) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'files.write_text', payload);
});

ipcMain.handle('app-runtime:files:delete', async (event, payload = {}) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'files.delete', payload);
});

ipcMain.handle('app-runtime:files:mkdir', async (event, payload = {}) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'files.mkdir', payload);
});

ipcMain.handle('app-runtime:agent:send', async (event, payload = {}) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'agent.send', payload);
});

ipcMain.handle('app-runtime:agent:cancel', async (event, payload = {}) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'agent.cancel', payload);
});

ipcMain.handle('app-runtime:agent:reset', async (event) => {
  const appState = getAppWindowStateBySender(event.sender);
  return callAppTool(appState, 'agent.reset');
});

ipcMain.handle('agent:send', async (event, { sessionId, prompt, mode, appName }) => {
  const sessionRecord = getSessionRecord(sessionId);
  if (sessionRecord.busy) {
    throw new Error('This session is already processing a request.');
  }

  const trimmedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  if (!trimmedPrompt) {
    throw new Error('Prompt is required.');
  }
  const isCreateAppMode = mode === 'create-app';
  const isIterateAppMode = mode === 'iterate-app';
  const isPlanOnly = mode === 'plan';

  let iterateTarget = null;
  if (isIterateAppMode) {
    if (!appName || typeof appName !== 'string') {
      throw new Error('App name is required for iterate-app mode.');
    }
    iterateTarget = loadStoredAppContent(appName);
  }

  const runtimePrompt = isCreateAppMode
    ? buildCreateAppPrompt(trimmedPrompt)
    : isIterateAppMode
      ? buildIterateAppPrompt(iterateTarget, trimmedPrompt)
      : isPlanOnly
        ? `Please create a step-by-step implementation plan for the following request. Do NOT output any code blocks yet, just the logical plan: ${trimmedPrompt}`
        : trimmedPrompt;

  const runtime = await ensureRuntime(sessionRecord);
  const userEvent = {
    type: 'user',
    prompt: trimmedPrompt,
    timestamp: Date.now(),
  };

  sessionRecord.history.push(userEvent);
  sessionRecord.messageCount += 1;
  sessionRecord.updatedAt = Date.now();
  sessionRecord.preview = trimmedPrompt;
  if (sessionRecord.title === 'New Session') {
    sessionRecord.title = buildSessionTitle(trimmedPrompt);
  }
  sessionRecord.busy = true;
  schedulePersistSession(sessionRecord, true);
  emitSessionMeta(sessionRecord);
  event.sender.send('agent:event', { sessionId, payload: userEvent });
  emitToRenderer('agent:state', { sessionId, busy: true });

  try {
    let latestAssistantText = '';
    let streamedAssistantText = '';

    for await (const message of runtime.send(runtimePrompt)) {
      if (message.session_id) {
        sessionRecord.underlyingSessionId = message.session_id;
      }
      sessionRecord.history.push(message);
      sessionRecord.updatedAt = Date.now();
      if (message.type === 'assistant') {
        const assistantText = extractTextFromAssistantMessage(message);
        if (assistantText) {
          latestAssistantText = assistantText;
          sessionRecord.preview = assistantText;
        }
      } else if (
        message.type === 'stream_event' &&
        message.event?.type === 'content_block_delta' &&
        message.event?.delta?.type === 'text_delta' &&
        typeof message.event.delta.text === 'string'
      ) {
        streamedAssistantText += message.event.delta.text;
      }
      schedulePersistSession(sessionRecord);
      if (!event.sender.isDestroyed()) {
        event.sender.send('agent:event', { sessionId, payload: message });
      }
    }

    let createdApp = null;
    let updatedApp = null;
    if (isCreateAppMode) {
      const payload = extractAppPayloadFromText(latestAssistantText || streamedAssistantText);
      createdApp = saveStoredApp({
        ...payload,
        prd: trimmedPrompt,
      });
      launchAppWindowByEntry(createdApp);
      emitAppsChanged({
        action: 'created',
        app: {
          name: createdApp.name,
          description: createdApp.description,
          width: createdApp.width,
          height: createdApp.height,
          resizable: createdApp.resizable,
          createdAt: createdApp.createdAt,
          updatedAt: createdApp.updatedAt,
        },
      });
    } else if (isIterateAppMode) {
      const payload = extractAppPayloadFromText(latestAssistantText || streamedAssistantText);
      const nextPrd = iterateTarget.prd
        ? `${iterateTarget.prd}\n\nUpdate request:\n${trimmedPrompt}`
        : trimmedPrompt;
      updatedApp = updateStoredApp(iterateTarget.name, {
        ...payload,
        prd: nextPrd,
      });
      refreshOpenAppWindow(updatedApp.name);
      emitAppsChanged({
        action: 'updated',
        app: {
          name: updatedApp.name,
          description: updatedApp.description,
          width: updatedApp.width,
          height: updatedApp.height,
          resizable: updatedApp.resizable,
          createdAt: updatedApp.createdAt,
          updatedAt: updatedApp.updatedAt,
        },
      });
    }

    return {
      ok: true,
      sessionId,
      summary: getSessionSummary(sessionRecord),
      createdApp: createdApp
        ? {
            name: createdApp.name,
            description: createdApp.description,
            width: createdApp.width,
            height: createdApp.height,
            resizable: createdApp.resizable,
            createdAt: createdApp.createdAt,
            updatedAt: createdApp.updatedAt,
          }
        : null,
      updatedApp: updatedApp
        ? {
            name: updatedApp.name,
            description: updatedApp.description,
            width: updatedApp.width,
            height: updatedApp.height,
            resizable: updatedApp.resizable,
            createdAt: updatedApp.createdAt,
            updatedAt: updatedApp.updatedAt,
          }
        : null,
    };
  } catch (error) {
    let message = error instanceof Error ? error.message : String(error);
    if (/Failed to authenticate|API Error:\s*403|API Error:\s*401|forbidden|unauthorized/i.test(message)) {
      try {
        const authDebug = await getAuthDebugSnapshot();
        const summary = formatAuthDebug(authDebug);
        if (summary) {
          message = `${message}\n[auth debug] ${summary}`;
        }
      } catch {}
    }
    const errorEvent = {
      type: 'error',
      message,
      timestamp: Date.now(),
    };
    sessionRecord.history.push(errorEvent);
    schedulePersistSession(sessionRecord, true);
    if (!event.sender.isDestroyed()) {
      event.sender.send('agent:event', { sessionId, payload: errorEvent });
    }
    throw error;
  } finally {
    sessionRecord.busy = false;
    sessionRecord.updatedAt = Date.now();
    schedulePersistSession(sessionRecord, true);
    emitSessionMeta(sessionRecord);
    emitToRenderer('agent:state', {
      sessionId,
      busy: false,
      summary: getSessionSummary(sessionRecord),
    });
  }
});
