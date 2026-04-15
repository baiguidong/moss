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
const rendererDevServerUrl = process.env.VITE_DEV_SERVER_URL && String(process.env.VITE_DEV_SERVER_URL).trim();
const shouldOpenDevTools = process.env.MOSS_OPEN_DEVTOOLS === 'true';
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
  url: '',
  apiKey: '',
});
const APP_FILES_SUBDIR = 'files';
const APP_VERSIONS_SUBDIR = 'versions';
const APP_STORAGE_FILENAME = 'storage.json';
const APP_CURRENT_VERSION_FILENAME = 'current-version.json';
const SESSION_APP_BUILD_SUBDIR = '.moss-app-build';
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
const debugWindows = new Map();
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

  if (typeof source.url === 'string') {
    result.url = source.url.trim();
  } else if (result.url === undefined) {
    result.url = DEFAULT_DESKTOP_SETTINGS.url;
  }

  if (typeof source.apiKey === 'string') {
    result.apiKey = source.apiKey.trim();
  } else if (result.apiKey === undefined) {
    result.apiKey = DEFAULT_DESKTOP_SETTINGS.apiKey;
  }

  if (typeof source.visionModel === 'string' && source.visionModel.trim()) {
    result.visionModel = source.visionModel.trim();
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
    // 从 env 中提取 url 和 apiKey
    const env = parsed && parsed.env && typeof parsed.env === 'object' ? parsed.env : {};
    const urlFromEnv = typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL.trim() : '';
    const apiKeyFromEnv = typeof env.ANTHROPIC_AUTH_TOKEN === 'string' ? env.ANTHROPIC_AUTH_TOKEN.trim() : '';
    // 启动加载时，保留原始 JSON 中的所有 key，只对标准 key 进行合并/格式化
    const normalized = normalizeDesktopSettings(parsed, parsed);
    result.value = {
      ...parsed,
      ...normalized,
      // 从 env 中读取 url 和 apiKey
      url: urlFromEnv || normalized.url || DEFAULT_DESKTOP_SETTINGS.url,
      apiKey: apiKeyFromEnv || normalized.apiKey || DEFAULT_DESKTOP_SETTINGS.apiKey,
      visionModel: normalized.visionModel || '',
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
  // 读取现有文件，保留 env 等其他配置
  let existingEnv = {};
  try {
    if (fs.existsSync(DESKTOP_SETTINGS_PATH)) {
      const raw = fs.readFileSync(DESKTOP_SETTINGS_PATH, 'utf8');
      const existing = JSON.parse(raw);
      if (existing && existing.env && typeof existing.env === 'object') {
        existingEnv = existing.env;
      }
    }
  } catch { /* ignore */ }

  // 将 url 和 apiKey 存入 env
  const env = { ...existingEnv };
  if (nextSettings.url) {
    env.ANTHROPIC_BASE_URL = nextSettings.url;
  }
  if (nextSettings.apiKey) {
    env.ANTHROPIC_AUTH_TOKEN = nextSettings.apiKey;
  }

  // 构建完整的保存对象，保留所有现有配置
  const toSave = {
    ...nextSettings,
    env,
    // 从顶级别存，避免重复
    url: undefined,
    apiKey: undefined,
  };
  // 删除 undefined 字段
  Object.keys(toSave).forEach(k => toSave[k] === undefined && delete toSave[k]);

  fs.writeFileSync(DESKTOP_SETTINGS_PATH, `${JSON.stringify(toSave, null, 2)}\n`, 'utf8');
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
    url: desktopSettings.url || undefined,
    apiKey: desktopSettings.apiKey || undefined,
    visionModel: desktopSettings.visionModel || undefined,
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
    const history = parseStoredHistory(row.history_json);
    const sessionRecord = {
      id: row.id,
      title: row.title,
      workspace: row.workspace,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      busy: false,
      messageCount: row.message_count,
      preview: row.preview || deriveSessionPreview(history),
      underlyingSessionId: row.underlying_session_id || null,
      pendingPlanApproval: derivePendingPlanApproval(history),
      history,
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
    pendingPlanApproval: sessionRecord.pendingPlanApproval || null,
  };
}

function normalizePreviewText(value, maxLength = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function extractTextFromAssistantMessage(message) {
  if (!Array.isArray(message?.message?.content)) return '';
  return message.message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function extractPreviewFromAssistantMessage(message) {
  const text = extractTextFromAssistantMessage(message);
  if (text) return normalizePreviewText(text);
  return '';
}

function extractPreviewFromStreamEvent(message) {
  const event = message?.event;
  if (!event || typeof event !== 'object') return '';

  if (
    event.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta' &&
    typeof event.delta.text === 'string'
  ) {
    return normalizePreviewText(event.delta.text);
  }

  return '';
}

function deriveSessionPreview(history) {
  if (!Array.isArray(history) || history.length === 0) return '';

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'assistant') {
      const preview = extractPreviewFromAssistantMessage(entry);
      if (preview) return preview;
      continue;
    }

    if (entry.type === 'stream_event') {
      const preview = extractPreviewFromStreamEvent(entry);
      if (preview) return preview;
      continue;
    }

    if (entry.type === 'user' && typeof entry.prompt === 'string') {
      const preview = normalizePreviewText(entry.prompt);
      if (preview) return preview;
      continue;
    }

    if (entry.type === 'error' && typeof entry.message === 'string') {
      const preview = normalizePreviewText(entry.message);
      if (preview) return preview;
    }
  }

  return '';
}

function derivePendingPlanApproval(history) {
  if (!Array.isArray(history)) return null;

  let pending = null;
  for (const entry of history) {
    if (!entry || entry.type !== 'app_plan_state' || entry.kind !== 'create-app') continue;

    if (entry.state === 'awaiting_approval') {
      pending = {
        kind: 'create-app',
        originalPrompt: typeof entry.originalPrompt === 'string' ? entry.originalPrompt : '',
        plan: typeof entry.plan === 'string' ? entry.plan : '',
        requestedAt: typeof entry.timestamp === 'number' ? entry.timestamp : Date.now(),
      };
      continue;
    }

    if (entry.state === 'approved' || entry.state === 'rejected') {
      pending = null;
    }
  }

  return pending;
}

function pushSessionHistoryEvent(sessionRecord, event, sender = null) {
  sessionRecord.history.push(event);
  sessionRecord.updatedAt = Date.now();
  sessionRecord.preview = deriveSessionPreview(sessionRecord.history);
  schedulePersistSession(sessionRecord);
  if (sender && !sender.isDestroyed()) {
    sender.send('agent:event', { sessionId: sessionRecord.id, payload: event });
  }
}

function setPendingPlanApproval(sessionRecord, pendingPlanApproval) {
  sessionRecord.pendingPlanApproval = pendingPlanApproval;
  sessionRecord.updatedAt = Date.now();
  schedulePersistSession(sessionRecord, true);
  emitSessionMeta(sessionRecord);
}

async function runSessionPrompt({
  sessionRecord,
  sender,
  runtimePrompt,
  visibleUserPrompt,
}) {
  const runtime = await ensureRuntime(sessionRecord);

  if (typeof visibleUserPrompt === 'string' && visibleUserPrompt.trim()) {
    const trimmedUserPrompt = visibleUserPrompt.trim();
    const userEvent = {
      type: 'user',
      prompt: trimmedUserPrompt,
      timestamp: Date.now(),
    };

    sessionRecord.history.push(userEvent);
    sessionRecord.messageCount += 1;
    sessionRecord.updatedAt = Date.now();
    sessionRecord.preview = trimmedUserPrompt;
    if (sessionRecord.title === 'New Session') {
      sessionRecord.title = buildSessionTitle(trimmedUserPrompt);
    }
    schedulePersistSession(sessionRecord, true);
    emitSessionMeta(sessionRecord);
    if (!sender.isDestroyed()) {
      sender.send('agent:event', { sessionId: sessionRecord.id, payload: userEvent });
    }
  }

  sessionRecord.busy = true;
  sessionRecord.updatedAt = Date.now();
  schedulePersistSession(sessionRecord, true);
  emitSessionMeta(sessionRecord);
  emitToRenderer('agent:state', { sessionId: sessionRecord.id, busy: true });

  try {
    let latestAssistantText = '';
    let streamedAssistantText = '';

    for await (const message of runtime.send(runtimePrompt)) {
      if (message.session_id) {
        sessionRecord.underlyingSessionId = message.session_id;
      }
      sessionRecord.history.push(message);
      sessionRecord.updatedAt = Date.now();
      sessionRecord.preview = deriveSessionPreview(sessionRecord.history);
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
      }
      schedulePersistSession(sessionRecord);
      if (!sender.isDestroyed()) {
        sender.send('agent:event', { sessionId: sessionRecord.id, payload: message });
      }
    }

    return {
      latestAssistantText,
      streamedAssistantText,
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
    if (!sender.isDestroyed()) {
      sender.send('agent:event', { sessionId: sessionRecord.id, payload: errorEvent });
    }
    throw error;
  } finally {
    sessionRecord.busy = false;
    sessionRecord.updatedAt = Date.now();
    schedulePersistSession(sessionRecord, true);
    emitSessionMeta(sessionRecord);
    emitToRenderer('agent:state', {
      sessionId: sessionRecord.id,
      busy: false,
      summary: getSessionSummary(sessionRecord),
    });
  }
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

function getAppCurrentVersionPath(name) {
  return path.join(ensureAppDataDir(name), APP_CURRENT_VERSION_FILENAME);
}

function getAppFilePath(name) {
  return path.join(ensureAppsDir(), `${name}.html`);
}

function parseAppVersionIndex(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  const semverMatch = raw.match(/^0\.0\.(\d+)$/);
  if (!semverMatch) {
    return null;
  }

  const parsed = Number.parseInt(semverMatch[1], 10);
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

function formatAppVersionNumber(value) {
  const parsed = parseAppVersionIndex(value);
  if (!parsed) {
    return null;
  }
  return `0.0.${parsed}`;
}

function readAppCurrentVersion(name) {
  const currentVersionPath = getAppCurrentVersionPath(name);
  if (!fs.existsSync(currentVersionPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(currentVersionPath, 'utf8'));
    const id = String(parsed.id || '').trim();
    const version = formatAppVersionNumber(parsed.version);
    if (!id && !version) {
      return null;
    }
    return {
      id: id || null,
      version,
    };
  } catch (error) {
    console.warn(`Failed to load current app version from ${currentVersionPath}:`, error);
    return null;
  }
}

function writeAppCurrentVersion(name, versionSelection) {
  const payload = {
    id: String(versionSelection?.id || '').trim(),
    version: formatAppVersionNumber(versionSelection?.version),
  };
  fs.writeFileSync(getAppCurrentVersionPath(name), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function loadAppVersionSnapshots(name) {
  const versionsDir = ensureAppVersionsDir(name);
  const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
  const snapshots = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const filePath = path.join(versionsDir, entry.name);
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      snapshots.push({
        id: String(parsed.id || path.basename(entry.name, '.json')),
        version: formatAppVersionNumber(parsed.version),
        createdAt: Number(parsed.createdAt) || Date.now(),
        reason: String(parsed.reason || 'updated'),
        note: String(parsed.note || ''),
        description: String(parsed.description || ''),
        width: Number(parsed.width) || 900,
        height: Number(parsed.height) || 700,
        resizable: parsed.resizable !== false,
        prd: String(parsed.prd || ''),
        html: String(parsed.html || ''),
      });
    } catch (error) {
      console.warn(`Failed to load app version snapshot from ${filePath}:`, error);
    }
  }

  snapshots.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  let assignedVersion = 0;
  for (const snapshot of snapshots) {
    if (snapshot.version) {
      assignedVersion = Math.max(assignedVersion, parseAppVersionIndex(snapshot.version) || 0);
      continue;
    }
    assignedVersion += 1;
    snapshot.version = formatAppVersionNumber(assignedVersion);
  }

  return snapshots;
}

function getLatestAppVersionSnapshot(name, snapshots = loadAppVersionSnapshots(name)) {
  return snapshots[snapshots.length - 1] || null;
}

function getCurrentAppVersionSnapshot(name, snapshots = loadAppVersionSnapshots(name)) {
  const currentSelection = readAppCurrentVersion(name);
  let currentSnapshot = null;

  if (currentSelection?.id) {
    currentSnapshot = snapshots.find((snapshot) => snapshot.id === currentSelection.id) || null;
  }
  if (!currentSnapshot && currentSelection?.version) {
    currentSnapshot =
      snapshots.find((snapshot) => snapshot.version === currentSelection.version) || null;
  }
  if (!currentSnapshot) {
    currentSnapshot = getLatestAppVersionSnapshot(name, snapshots);
  }

  if (
    currentSnapshot &&
    (
      currentSelection?.id !== currentSnapshot.id ||
      currentSelection?.version !== currentSnapshot.version
    )
  ) {
    writeAppCurrentVersion(name, currentSnapshot);
  }

  return currentSnapshot;
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
      hostApi: 'window.mossApp',
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
      const versions = loadAppVersionSnapshots(parsed.name);
      const latestVersion = getLatestAppVersionSnapshot(parsed.name, versions);
      const currentVersion = getCurrentAppVersionSnapshot(parsed.name, versions);
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
        latestVersionId: latestVersion?.id || null,
        latestVersion: latestVersion?.version || null,
        currentVersionId: currentVersion?.id || latestVersion?.id || null,
        currentVersion: currentVersion?.version || latestVersion?.version || null,
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
    latestVersion: snapshot.version,
    currentVersionId: snapshot.id,
    currentVersion: snapshot.version,
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
  if (
    options.saveVersion === false &&
    (options.currentVersionId || options.currentVersion)
  ) {
    writeAppCurrentVersion(name, {
      id: options.currentVersionId,
      version: options.currentVersion,
    });
  }
  const stat = fs.statSync(existing.filePath);
  const versions = loadAppVersionSnapshots(name);
  const latestVersion = getLatestAppVersionSnapshot(name, versions);
  const currentVersion = getCurrentAppVersionSnapshot(name, versions);

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
    latestVersionId: latestVersion?.id || snapshot?.id || null,
    latestVersion: latestVersion?.version || snapshot?.version || null,
    currentVersionId: currentVersion?.id || snapshot?.id || null,
    currentVersion: currentVersion?.version || snapshot?.version || null,
  };
}

function toAppVersionSnapshotRecord(appRecord, extra = {}) {
  const existingSnapshots = Array.isArray(extra.existingSnapshots) ? extra.existingSnapshots : [];
  const nextVersionNumber =
    existingSnapshots.reduce((max, snapshot) => {
      const versionNumber = parseAppVersionIndex(snapshot.version);
      return versionNumber ? Math.max(max, versionNumber) : max;
    }, 0) + 1;

  return {
    id: extra.id || `${Date.now()}-${randomUUID().slice(0, 8)}`,
    version: formatAppVersionNumber(extra.version) || formatAppVersionNumber(nextVersionNumber),
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
  const existingSnapshots = loadAppVersionSnapshots(appRecord.name);
  const snapshot = toAppVersionSnapshotRecord(appRecord, {
    ...extra,
    existingSnapshots,
  });
  const filePath = path.join(ensureAppVersionsDir(appRecord.name), `${snapshot.id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  writeAppCurrentVersion(appRecord.name, snapshot);
  return snapshot;
}

function listAppVersionSnapshots(name) {
  const snapshots = loadAppVersionSnapshots(name);
  const currentSnapshot = getCurrentAppVersionSnapshot(name, snapshots);
  const latestSnapshot = getLatestAppVersionSnapshot(name, snapshots);
  return [...snapshots]
    .sort((a, b) => {
      const versionDiff = (parseAppVersionIndex(b.version) || 0) - (parseAppVersionIndex(a.version) || 0);
      return versionDiff || b.createdAt - a.createdAt;
    })
    .map(({ id, version, createdAt, reason, note, description, width, height, resizable }) => ({
      id,
      version,
      createdAt,
      reason,
      note,
      description,
      width,
      height,
      resizable,
      isCurrent: id === currentSnapshot?.id,
      isLatest: id === latestSnapshot?.id,
    }));
}

function getAppVersionSnapshot(name, versionId) {
  const normalizedVersion = formatAppVersionNumber(versionId);
  const snapshot = loadAppVersionSnapshots(name).find(
    (entry) => entry.id === versionId || (normalizedVersion && entry.version === normalizedVersion)
  );
  if (!snapshot) {
    throw new Error(`Unknown app version: ${versionId}`);
  }
  return {
    ...snapshot,
    appName: name,
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
    currentVersionId: snapshot.id,
    currentVersion: snapshot.version,
  });

  return rolledBackApp;
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
    hostApi: 'window.mossApp',
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
      launchAppWindowByEntry(rolledBack);
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

function getSessionAppBuildPaths(sessionRecord) {
  const buildDir = path.join(sessionRecord.workspace, SESSION_APP_BUILD_SUBDIR);
  return {
    buildDir,
    metadataPath: path.join(buildDir, 'app-meta.json'),
    htmlPath: path.join(buildDir, 'index.html'),
  };
}

function readGeneratedAppPayloadFromWorkspace(sessionRecord) {
  const { metadataPath, htmlPath } = getSessionAppBuildPaths(sessionRecord);

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`App metadata file was not created: ${metadataPath}`);
  }
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`App html file was not created: ${htmlPath}`);
  }

  let metadata;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Failed to parse generated app metadata JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const html = fs.readFileSync(htmlPath, 'utf8').trim();
  if (!html.toLowerCase().includes('<html')) {
    throw new Error(`Generated HTML file did not contain a full HTML document: ${htmlPath}`);
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

function buildCreateAppPlanPrompt(prd) {
  return [
    'You are in planning mode for a standalone single-file desktop mini app.',
    'All natural-language output must be in Simplified Chinese.',
    'Produce an implementation plan only. Do NOT output any app code, HTML, JSON metadata, or fenced code blocks.',
    'Your plan must be concrete enough for user approval.',
    'Include these sections in plain markdown:',
    '1. Goal',
    '2. Core features',
    '3. UI and interaction design',
    '4. Data and state handling',
    '5. Execution steps',
    '6. Risks or open questions',
    '',
    'App request:',
    String(prd || '').trim(),
  ].join('\n');
}

function buildCreateAppExecutionPrompt(prd, approvedPlan, buildPaths) {
  return [
    'You are implementing a standalone single-file desktop mini app using workspace tools.',
    'All natural-language output must be in Simplified Chinese.',
    'The user has already approved the implementation plan below. You must follow it.',
    '',
    'Approved plan:',
    String(approvedPlan || '').trim() || '(empty)',
    '',
    'Use file tools to create or overwrite these exact files inside the workspace:',
    `- ${buildPaths.metadataPath}`,
    `- ${buildPaths.htmlPath}`,
    '',
    'Write the app metadata JSON to app-meta.json with this shape:',
    '{ "name": string, "description": string, "width": number, "height": number, "resizable": boolean }',
    '',
    'Write the full standalone HTML document to index.html.',
    'Do not return the full app code in chat unless it is strictly necessary.',
    'Your final assistant message should be a short implementation summary in Simplified Chinese only.',
    'Rules:',
    '- Do not change scope unless absolutely necessary.',
    '- Use tools for the actual file creation so the execution is visible.',
    '- You may read back the files to verify them before finishing.',
    '- Use vanilla HTML/CSS/JavaScript only.',
    '- Keep the app fully self-contained.',
    '- Make the UI polished and usable.',
    '- Name must be lowercase and hyphenated.',
    '- The app runs inside Electron and can access a host runtime API via window.mossApp.',
    '',
    'Available host runtime APIs (all async):',
    '- window.mossApp.getAppInfo()',
    '- window.mossApp.readResource(uri)',
    '- window.mossApp.storage.getItem(key), setItem(key, value), removeItem(key), list()',
    '- window.mossApp.files.list(path?), readText(path), writeText(path, content), delete(path), mkdir(path)',
    '- window.mossApp.agent.send({ prompt, systemPrompt? })',
    '- window.mossApp.agent.reset()',
    '',
    'App request:',
    String(prd || '').trim(),
  ].join('\n');
}

function buildIterateAppPrompt(appRecord, feedback) {
  return [
    'You are updating an existing standalone single-file desktop mini app.',
    'All natural-language analysis, plans, explanations, and summaries must be in Simplified Chinese.',
    'First, analyze the requested changes and output your modification plan step-by-step.',
    'Then, return the full updated app code in exactly two fenced blocks at the very END of your response.',
    'First block must be ```app-meta with JSON.',
    'Second block must be ```html containing the full code.',
    'Rules:',
    '- BE VERBOSE about your analysis and what you are fixing/adding BEFORE outputting the code.',
    '- Keep the app name unchanged.',
    '- Use vanilla HTML/CSS/JavaScript only.',
    '- Keep the app fully self-contained.',
    '- The app runs inside Electron and can access a host runtime API via window.mossApp.',
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
    pendingPlanApproval: null,
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
    title: 'Moss',
    backgroundColor: '#09111c',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin'
      ? false
      : {
          color: '#09111c',
          symbolColor: '#dbe4ea',
          height: 36,
        },
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (rendererDevServerUrl) {
    void mainWindow.loadURL(rendererDevServerUrl);
    if (shouldOpenDevTools) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    if (!hasFile(rendererHtml)) {
      throw new Error(`Missing renderer build at ${rendererHtml}. Run "vite build" in ui first.`);
    }
    void mainWindow.loadFile(rendererHtml);
  }
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

ipcMain.handle('workspace:open', async (_event, { sessionId }) => {
  const sessionRecord = getSessionRecord(sessionId);
  const result = await shell.openPath(sessionRecord.workspace);
  if (result) {
    throw new Error(result);
  }
  return { ok: true };
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
  launchAppWindowByEntry(rolledBack);
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

ipcMain.handle('app:open-debug', async (event, { name }) => {
  const parentWindow = BrowserWindow.fromWebContents(event.sender);
  if (!parentWindow) return { error: 'No parent window' };

  const existingDebug = debugWindows.get(name);
  if (existingDebug && !existingDebug.isDestroyed()) {
    existingDebug.focus();
    return { ok: true };
  }

  const debugWindow = new BrowserWindow({
    title: `Moss Debug - ${name}`,
    width: 500,
    height: 600,
    minWidth: 400,
    minHeight: 400,
    resizable: true,
    backgroundColor: '#0b1120',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'debug-preload.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  debugWindows.set(name, debugWindow);
  debugWindow.setParentWindow(parentWindow);

  debugWindow.on('closed', () => {
    debugWindows.delete(name);
  });

  debugWindow.webContents.on('did-finish-load', () => {
    debugWindow.webContents.send('debug:init', { name });
  });

  const debugHtmlPath = path.join(__dirname, 'debug.html');
  void debugWindow.loadFile(debugHtmlPath);

  return { ok: true };
});

ipcMain.on('debug:close', (event) => {
  const debugWindow = BrowserWindow.fromWebContents(event.sender);
  if (debugWindow) {
    debugWindow.close();
  }
});

ipcMain.on('debug:send-to-agent', (event, { prompt, appName }) => {
  const debugWindow = BrowserWindow.fromWebContents(event.sender);
  const parentWindow = debugWindow?.getParentWindow();
  if (!parentWindow) return;

  const appState = appWindowStates.get(parentWindow.webContents.id);
  if (!appState || !appState.runtime) return;

  // Forward events to debug window
  const originalEmit = appState.runtime.emit;
  if (originalEmit) {
    appState.runtime.emit = function(...args) {
      if (debugWindow && !debugWindow.isDestroyed()) {
        debugWindow.webContents.send('debug:agent-event', args[0]);
      }
      return originalEmit.apply(this, args);
    };
  }

  appState.runtime.agent.send(prompt, (err, response) => {
    if (debugWindow && !debugWindow.isDestroyed()) {
      debugWindow.webContents.send('debug:response', response);
    }
  });
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

  if (isCreateAppMode && sessionRecord.pendingPlanApproval) {
    throw new Error('There is already a pending app creation plan awaiting approval.');
  }

  let iterateTarget = null;
  if (isIterateAppMode) {
    if (!appName || typeof appName !== 'string') {
      throw new Error('App name is required for iterate-app mode.');
    }
    iterateTarget = loadStoredAppContent(appName);
  }

  const runtimePrompt = isCreateAppMode
    ? buildCreateAppPlanPrompt(trimmedPrompt)
    : isIterateAppMode
      ? buildIterateAppPrompt(iterateTarget, trimmedPrompt)
      : isPlanOnly
        ? `Please create a step-by-step implementation plan for the following request. Do NOT output any code blocks yet, just the logical plan: ${trimmedPrompt}`
        : trimmedPrompt;

  const {
    latestAssistantText,
    streamedAssistantText,
  } = await runSessionPrompt({
    sessionRecord,
    sender: event.sender,
    runtimePrompt,
    visibleUserPrompt: trimmedPrompt,
  });

  let createdApp = null;
  let updatedApp = null;
  if (isCreateAppMode) {
    const planText = String(latestAssistantText || streamedAssistantText || '').trim();
    if (!planText) {
      throw new Error('Planner did not return a usable app creation plan.');
    }
    const pendingPlanApproval = {
      kind: 'create-app',
      originalPrompt: trimmedPrompt,
      plan: planText,
      requestedAt: Date.now(),
    };
    pushSessionHistoryEvent(sessionRecord, {
      type: 'app_plan_state',
      kind: 'create-app',
      state: 'awaiting_approval',
      originalPrompt: trimmedPrompt,
      plan: planText,
      timestamp: pendingPlanApproval.requestedAt,
    }, event.sender);
    setPendingPlanApproval(sessionRecord, pendingPlanApproval);
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
    launchAppWindowByEntry(updatedApp);
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
    pendingPlanApproval: sessionRecord.pendingPlanApproval || null,
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
});

ipcMain.handle('agent:approve-plan', async (event, { sessionId }) => {
  const sessionRecord = getSessionRecord(sessionId);
  if (sessionRecord.busy) {
    throw new Error('This session is already processing a request.');
  }
  const pendingPlanApproval = sessionRecord.pendingPlanApproval;
  if (!pendingPlanApproval || pendingPlanApproval.kind !== 'create-app') {
    throw new Error('There is no app creation plan waiting for approval.');
  }

  pushSessionHistoryEvent(sessionRecord, {
    type: 'app_plan_state',
    kind: 'create-app',
    state: 'approved',
    originalPrompt: pendingPlanApproval.originalPrompt,
    plan: pendingPlanApproval.plan,
    timestamp: Date.now(),
  }, event.sender);
  setPendingPlanApproval(sessionRecord, null);

  const buildPaths = getSessionAppBuildPaths(sessionRecord);
  fs.mkdirSync(buildPaths.buildDir, { recursive: true });

  const {
    latestAssistantText,
    streamedAssistantText,
  } = await runSessionPrompt({
    sessionRecord,
    sender: event.sender,
    runtimePrompt: buildCreateAppExecutionPrompt(
      pendingPlanApproval.originalPrompt,
      pendingPlanApproval.plan,
      buildPaths,
    ),
  });

  const payload = readGeneratedAppPayloadFromWorkspace(sessionRecord);
  const createdApp = saveStoredApp({
    ...payload,
    prd: pendingPlanApproval.originalPrompt,
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

  return {
    ok: true,
    sessionId,
    summary: getSessionSummary(sessionRecord),
    createdApp: {
      name: createdApp.name,
      description: createdApp.description,
      width: createdApp.width,
      height: createdApp.height,
      resizable: createdApp.resizable,
      createdAt: createdApp.createdAt,
      updatedAt: createdApp.updatedAt,
    },
  };
});

ipcMain.handle('agent:reject-plan', async (event, { sessionId }) => {
  const sessionRecord = getSessionRecord(sessionId);
  if (sessionRecord.busy) {
    throw new Error('This session is already processing a request.');
  }
  const pendingPlanApproval = sessionRecord.pendingPlanApproval;
  if (!pendingPlanApproval || pendingPlanApproval.kind !== 'create-app') {
    throw new Error('There is no app creation plan waiting for approval.');
  }

  pushSessionHistoryEvent(sessionRecord, {
    type: 'app_plan_state',
    kind: 'create-app',
    state: 'rejected',
    originalPrompt: pendingPlanApproval.originalPrompt,
    plan: pendingPlanApproval.plan,
    timestamp: Date.now(),
  }, event.sender);
  setPendingPlanApproval(sessionRecord, null);

  return {
    ok: true,
    sessionId,
    summary: getSessionSummary(sessionRecord),
  };
});
