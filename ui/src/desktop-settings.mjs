import { normalizeDesktopControlSettings } from '../../packages/app-runtime/src/desktop-control/session.mjs';
import fs from 'node:fs';
import { normalizeUserAvatar } from './user-avatar-settings.mjs';
import { DEFAULT_RUNTIME_LIFECYCLE, normalizeRuntimeLifecycle } from './runtime-lifecycle-settings.mjs';

import {
  DEFAULT_APPEARANCE,
  hasPersistedAppearance,
  normalizeAppearance,
} from './appearance-settings.mjs';
import { normalizeMcpStore } from './desktop-mcp-settings.mjs';
import { normalizeAgentMailSessionMode } from './agent-mail-context.mjs';
import { normalizeWebSearchSettings } from './web-search-capability.mjs';
import {
  DEFAULT_MOSS_TOOL_LOADING,
  normalizeMossToolLoading,
} from './tool-loading-settings.mjs';
import {
  normalizePermissionMode,
  permissionModeFromLegacyBypass,
} from './permission-modes.mjs';
import {
  DEFAULT_DECLARED_CONTEXT_WINDOW,
  normalizeDeclaredContextWindow,
} from '../../shared/model-context-options.mjs';

const DEFAULT_BYPASS_PERMISSIONS = process.env.CLAUDE_CODE_BYPASS_PERMISSIONS === 'true';
const DEFAULT_PERMISSION_MODE = permissionModeFromLegacyBypass(DEFAULT_BYPASS_PERMISSIONS);

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  appWidgets: { enabled: true },
  userAvatar: '',
  agentMode: 'local',
  localEnabled: true,
  enterpriseEnabled: false,
  agentTeamsEnabled: false,
  permissionMode: DEFAULT_PERMISSION_MODE,
  bypassPermissions: DEFAULT_BYPASS_PERMISSIONS,
  model: '',
  fastModel: '',
  declaredContextByModel: {},
  maxTurns: 100,
  runtimeLifecycle: { ...DEFAULT_RUNTIME_LIFECYCLE },
  language: 'chinese',
  appendSystemPrompt: '',
  thinkingMode: 'auto',
  thinkingBudgetTokens: 16000,
  url: '',
  apiKey: '',
  webSearch: {
    mode: 'auto',
    tavilyApiKey: '',
    braveApiKey: '',
  },
  image: {
    model: 'gpt-image-2',
  },
  toolLoading: {
    ...DEFAULT_MOSS_TOOL_LOADING,
  },
  toolCallDrafts: {
    enabled: true,
  },
  agentSettings: {
    disabled: ['verification'],
  },
  autoMemory: {
    enabled: true,
    extractionEnabled: false,
    extractionIntervalTurns: 5,
    pastContextSearchEnabled: false,
    dreamEnabled: false,
    dreamMinHours: 24,
    dreamMinSessions: 5,
  },
  advanced: {
    moss_auto_background_agents: false,
    moss_bash_ast_permissions: false,
    moss_hive_evidence: false,
    moss_scratchpad: false,
    moss_idle_session_cleanup: false,
    moss_streaming_tool_execution: false,
    moss_disable_nonstreaming_fallback: false,
    moss_plan_mode_interview: true,
    moss_fast_web_search: false,
    moss_memory_learn_from_corrections: false,
    moss_large_tool_result_protection: false,
    moss_tool_result_budget_chars: 200000,
    moss_mcp_output_token_limit: 25000,
    moss_file_read_max_size_bytes: 256 * 1024,
    moss_file_read_max_tokens: 25000,
    moss_request_attribution_enabled: true,
    moss_context_compaction_strategy: 'proactive',
    moss_session_debug_logging: false,
  },
  managedRuntimes: {
    node: true,
    python: true,
    git: true,
  },
  appearance: {
    ...DEFAULT_APPEARANCE,
  },
  mcp: {
    version: 1,
    servers: {},
  },
  skillHub: {
    apiBaseUrl: 'https://api.skillhub.cn',
  },
  expertHub: {
    baseUrl: 'https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace',
  },
  agentMail: {
    enabled: false,
    sessionMode: 'fixed',
    consumerId: '',
    inboxSessionId: '',
    inboxSessionIds: {},
  },
  enterpriseAccountServerUrl: '',
  enterpriseAccountCredentialMode: 'password',
  enterpriseAccountUserName: '',
  enterpriseAccountUserEmail: '',
  enterpriseAccountUserPassword: '',
  enterpriseAccountAccessToken: '',
  enterpriseAccountWorkspace: '',
  coordinatorMode: false,
  logRotationMaxSize: 10 * 1024 * 1024, // 10MB
  logRotationMaxFiles: 5,
});


export function normalizeMossBaseUrl(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function objectField(source, key) {
  return isPlainObject(source?.[key]) ? source[key] : {};
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(source, key) {
  return typeof source?.[key] === 'string' ? source[key].trim() : undefined;
}

function ownStringField(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key) &&
    typeof source?.[key] === 'string'
    ? source[key].trim()
    : undefined;
}

function ownRawStringField(source, key) {
  return Object.prototype.hasOwnProperty.call(source || {}, key) &&
    typeof source?.[key] === 'string'
    ? source[key]
    : undefined;
}

function boundedInt(value, min, max) {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, max) : undefined;
}

function normalizeAgentTypeList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const name = typeof item === 'string' ? item.trim() : '';
    if (!name || name.length > 128 || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function normalizeDeclaredContextByModel(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([name, limit]) =>
    name.trim() && name.length <= 200 &&
    (limit === null || (Number.isSafeInteger(limit) && limit >= 1024 && limit <= 10_000_000))
  ).map(([name, limit]) => [name.trim(), normalizeDeclaredContextWindow(limit)]));
}

export function getDeclaredModelContextWindows(settings) {
  const models = [...new Set([settings?.model, settings?.fastModel]
    .filter(model => typeof model === 'string' && model.trim())
    .map(model => model.trim()))];
  const declarations = settings?.declaredContextByModel;
  return Object.fromEntries(models.flatMap(model => {
    const choice = declarations && Object.hasOwn(declarations, model) ? declarations[model] : undefined;
    return [[model, choice ?? DEFAULT_DECLARED_CONTEXT_WINDOW]];
  }));
}

function isModelEndpointEnvKey(key) {
  return /^MOSS_(MODEL_)?(BASE_URL|AUTH_TOKEN)$/.test(key);
}

function isLegacyServerEndpointEnvKey(key) {
  return key === 'MOSS_SERVER_URL' || key === 'MOSS_SERVER_AUTH_TOKEN';
}

function deleteManagedEndpointEnvKeys(env) {
  for (const key of Object.keys(env)) {
    if (isModelEndpointEnvKey(key) || isLegacyServerEndpointEnvKey(key)) {
      delete env[key];
    }
  }
}

function deleteLegacyServerSettings(target) {
  delete target.reporting;
  delete target.reportingServerUrl;
  delete target.reportingApiKey;
  delete target.reportingAuthToken;
  delete target.serverUrl;
  delete target.serverAuthToken;
}

export function normalizeRemoteDirectCredentialMode(value) {
  return 'password';
}


function loadLocalSettingsAuthConfig(settingsPath) {
  const result = {
    path: settingsPath,
    exists: false,
    loaded: false,
    parseError: '',
    injected: [],
  };

  try {
    if (!fs.existsSync(settingsPath)) {
      return result;
    }

    result.path = settingsPath;
    result.exists = true;
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const env = parsed && typeof parsed === 'object' && parsed.env && typeof parsed.env === 'object'
      ? parsed.env
      : {};
    const textModel = objectField(objectField(parsed, 'models'), 'text');
    const modelBaseUrl = normalizeMossBaseUrl(stringField(textModel, 'baseUrl') || '');
    const modelAuthToken = stringField(textModel, 'apiKey') || '';
    if (modelBaseUrl) {
      process.env.MOSS_MODEL_BASE_URL = modelBaseUrl;
      result.injected.push('MOSS_MODEL_BASE_URL');
    }
    if (modelAuthToken) {
      process.env.MOSS_MODEL_AUTH_TOKEN = modelAuthToken;
      result.injected.push('MOSS_MODEL_AUTH_TOKEN');
    }

    // 模型端点只从结构化配置注入；env 仅保留其他运行变量。
    for (const key of Object.keys(env)) {
      if (isModelEndpointEnvKey(key) || isLegacyServerEndpointEnvKey(key)) {
        continue;
      }
      const value = env[key];
      if (typeof value === 'string' && value.trim()) {
        const normalizedValue = value.trim();
        if (!normalizedValue) continue;
        process.env[key] = normalizedValue;
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

// Read legacy account settings once; saved files use the enterprise account model.
function readEnterpriseAccountSettings(value = {}) {
  value = value && typeof value === 'object' ? value : {};
  const result = { ...value };
  if (result.enterpriseEnabled === undefined && result.remoteEnabled !== undefined) result.enterpriseEnabled = result.remoteEnabled;
  for (const [key, item] of Object.entries(value)) if (key.startsWith('remoteDirect')) {
    const next = key.replace('remoteDirect', 'enterpriseAccount');
    if (result[next] === undefined) result[next] = item;
    delete result[key];
  }
  delete result.remoteEnabled;
  return result;
}

export function normalizeDesktopSettings(input, existing = {}) {
  input = readEnterpriseAccountSettings(input);
  existing = readEnterpriseAccountSettings(existing);
  const source = input && typeof input === 'object' ? input : {};
  const result = { ...existing };
  result.desktopControl = normalizeDesktopControlSettings(source.desktopControl ?? existing.desktopControl ?? source.computerUse ?? existing.computerUse);
  delete result.computerUse;
  result.userAvatar = normalizeUserAvatar(source.userAvatar ?? result.userAvatar);
  const sourceModels = objectField(source, 'models');
  const sourceText = objectField(sourceModels, 'text');
  const sourceTextThinking = objectField(sourceText, 'thinking');
  const existingModels = objectField(existing, 'models');
  const existingText = objectField(existingModels, 'text');
  const existingTextThinking = objectField(existingText, 'thinking');
  const sourceRemoteDirect = objectField(source, 'enterpriseAccount');
  const existingRemoteDirect = objectField(existing, 'enterpriseAccount');

  if (source.agentTeamsEnabled !== undefined) {
    result.agentTeamsEnabled = source.agentTeamsEnabled === true;
  } else if (typeof result.agentTeamsEnabled !== 'boolean') {
    result.agentTeamsEnabled = DEFAULT_DESKTOP_SETTINGS.agentTeamsEnabled;
  }

  // Execution always belongs to this Host. Legacy remote settings now only
  // configure the enterprise account connection; they cannot select a runner.
  result.agentMode = 'local';
  result.localEnabled = true;

  if (source.enterpriseEnabled !== undefined) {
    result.enterpriseEnabled = Boolean(source.enterpriseEnabled);
  } else if (result.enterpriseEnabled === undefined) {
    result.enterpriseEnabled = DEFAULT_DESKTOP_SETTINGS.enterpriseEnabled;
  }

  result.model =
    stringField(source, 'model') ??
    stringField(sourceText, 'model') ??
    stringField(result, 'model') ??
    stringField(existingText, 'model') ??
    DEFAULT_DESKTOP_SETTINGS.model;

  result.fastModel =
    ownStringField(source, 'fastModel') ??
    ownStringField(sourceText, 'fastModel') ??
    ownStringField(result, 'fastModel') ??
    ownStringField(existingText, 'fastModel') ??
    DEFAULT_DESKTOP_SETTINGS.fastModel;

  result.declaredContextByModel = normalizeDeclaredContextByModel(
    source.declaredContextByModel ?? sourceText.declaredContextByModel ??
    result.declaredContextByModel ?? existingText.declaredContextByModel,
  );

  if (source.appendSystemPrompt !== undefined) {
    result.appendSystemPrompt = source.appendSystemPrompt;
  } else if (result.appendSystemPrompt === undefined) {
    result.appendSystemPrompt = DEFAULT_DESKTOP_SETTINGS.appendSystemPrompt;
  }

  result.maxTurns =
    boundedInt(source.maxTurns, 1, 10_000) ??
    boundedInt(sourceText.maxTurns, 1, 10_000) ??
    boundedInt(result.maxTurns, 1, 10_000) ??
    boundedInt(existingText.maxTurns, 1, 10_000) ??
    DEFAULT_DESKTOP_SETTINGS.maxTurns;

  result.language =
    ownStringField(source, 'language') ??
    stringField(result, 'language') ??
    DEFAULT_DESKTOP_SETTINGS.language;

  result.thinkingMode = (
    source.thinkingMode ??
    sourceTextThinking.mode ??
    result.thinkingMode ??
    existingTextThinking.mode ??
    DEFAULT_DESKTOP_SETTINGS.thinkingMode
  ) || 'auto';

  result.thinkingBudgetTokens =
    boundedInt(source.thinkingBudgetTokens, 1024, 128_000) ??
    boundedInt(sourceTextThinking.budgetTokens, 1024, 128_000) ??
    boundedInt(result.thinkingBudgetTokens, 1024, 128_000) ??
    boundedInt(existingTextThinking.budgetTokens, 1024, 128_000) ??
    DEFAULT_DESKTOP_SETTINGS.thinkingBudgetTokens;

  const explicitPermissionMode = Object.prototype.hasOwnProperty.call(source, 'permissionMode')
    ? normalizePermissionMode(source.permissionMode)
    : null;
  const legacyPermissionMode = Object.prototype.hasOwnProperty.call(source, 'bypassPermissions')
    ? permissionModeFromLegacyBypass(source.bypassPermissions)
    : null;
  result.permissionMode = explicitPermissionMode
    || legacyPermissionMode
    || normalizePermissionMode(
      result.permissionMode,
      permissionModeFromLegacyBypass(result.bypassPermissions),
    );
  // Keep the legacy field in sync for older desktop builds and settings files.
  result.bypassPermissions = result.permissionMode === 'bypassPermissions';

  result.url = normalizeMossBaseUrl(
    stringField(source, 'url') ??
    stringField(sourceText, 'baseUrl') ??
    stringField(result, 'url') ??
    stringField(existingText, 'baseUrl') ??
    DEFAULT_DESKTOP_SETTINGS.url,
  );

  result.apiKey =
    stringField(source, 'apiKey') ??
    stringField(sourceText, 'apiKey') ??
    stringField(result, 'apiKey') ??
    stringField(existingText, 'apiKey') ??
    DEFAULT_DESKTOP_SETTINGS.apiKey;

  result.webSearch = normalizeWebSearchSettings(
    source.webSearch,
    result.webSearch || DEFAULT_DESKTOP_SETTINGS.webSearch,
  );

  result.toolLoading = normalizeMossToolLoading(
    source.toolLoading,
    result.toolLoading || DEFAULT_DESKTOP_SETTINGS.toolLoading,
  );
  const sourceToolCallDrafts = source.toolCallDrafts && typeof source.toolCallDrafts === 'object'
    ? source.toolCallDrafts
    : {};
  const existingToolCallDrafts = result.toolCallDrafts && typeof result.toolCallDrafts === 'object'
    ? result.toolCallDrafts
    : {};
  result.toolCallDrafts = {
    enabled: typeof sourceToolCallDrafts.enabled === 'boolean'
      ? sourceToolCallDrafts.enabled
      : typeof existingToolCallDrafts.enabled === 'boolean'
        ? existingToolCallDrafts.enabled
        : DEFAULT_DESKTOP_SETTINGS.toolCallDrafts.enabled,
  };
  result.runtimeLifecycle = normalizeRuntimeLifecycle(source.runtimeLifecycle, result.runtimeLifecycle);

  const sourceImage = source.image && typeof source.image === 'object' ? source.image : objectField(sourceModels, 'image');
  const existingImage = result.image && typeof result.image === 'object' ? result.image : {};
  const existingModelImage = objectField(existingModels, 'image');
  result.image = {
    model:
      typeof sourceImage.model === 'string'
        ? sourceImage.model.trim() || 'gpt-image-2'
        : typeof existingImage.model === 'string'
          ? existingImage.model || 'gpt-image-2'
          : typeof existingModelImage.model === 'string'
            ? existingModelImage.model || 'gpt-image-2'
          : DEFAULT_DESKTOP_SETTINGS.image.model,
  };

  result.enterpriseAccountServerUrl =
    ownStringField(source, 'enterpriseAccountServerUrl') ??
    ownStringField(sourceRemoteDirect, 'serverUrl') ??
    stringField(result, 'enterpriseAccountServerUrl') ??
    stringField(existingRemoteDirect, 'serverUrl') ??
    DEFAULT_DESKTOP_SETTINGS.enterpriseAccountServerUrl;

  result.enterpriseAccountCredentialMode = normalizeRemoteDirectCredentialMode(
    source.enterpriseAccountCredentialMode ??
      sourceRemoteDirect.credentialMode ??
      result.enterpriseAccountCredentialMode ??
      existingRemoteDirect.credentialMode ??
      DEFAULT_DESKTOP_SETTINGS.enterpriseAccountCredentialMode,
  );

  result.enterpriseAccountUserName =
    ownStringField(source, 'enterpriseAccountUserName') ??
    ownStringField(sourceRemoteDirect, 'userName') ??
    stringField(result, 'enterpriseAccountUserName') ??
    stringField(existingRemoteDirect, 'userName') ??
    DEFAULT_DESKTOP_SETTINGS.enterpriseAccountUserName;

  result.enterpriseAccountUserEmail =
    ownStringField(source, 'enterpriseAccountUserEmail') ??
    ownStringField(sourceRemoteDirect, 'userEmail') ??
    stringField(result, 'enterpriseAccountUserEmail') ??
    stringField(existingRemoteDirect, 'userEmail') ??
    DEFAULT_DESKTOP_SETTINGS.enterpriseAccountUserEmail;

  result.enterpriseAccountUserPassword =
    ownRawStringField(source, 'enterpriseAccountUserPassword') ??
    ownRawStringField(sourceRemoteDirect, 'userPassword') ??
    (typeof result.enterpriseAccountUserPassword === 'string'
      ? result.enterpriseAccountUserPassword
      : typeof existingRemoteDirect.userPassword === 'string'
        ? existingRemoteDirect.userPassword
        : DEFAULT_DESKTOP_SETTINGS.enterpriseAccountUserPassword);

  result.enterpriseAccountAccessToken =
    ownStringField(source, 'enterpriseAccountAccessToken') ??
    ownStringField(sourceRemoteDirect, 'accessToken') ??
    stringField(result, 'enterpriseAccountAccessToken') ??
    stringField(existingRemoteDirect, 'accessToken') ??
    DEFAULT_DESKTOP_SETTINGS.enterpriseAccountAccessToken;

  result.enterpriseAccountWorkspace =
    ownStringField(source, 'enterpriseAccountWorkspace') ??
    ownStringField(sourceRemoteDirect, 'workspace') ??
    stringField(result, 'enterpriseAccountWorkspace') ??
    stringField(existingRemoteDirect, 'workspace') ??
    DEFAULT_DESKTOP_SETTINGS.enterpriseAccountWorkspace;

  result.enterpriseAccount = {
    serverUrl: result.enterpriseAccountServerUrl,
    credentialMode: result.enterpriseAccountCredentialMode,
    userName: result.enterpriseAccountUserName,
    userEmail: result.enterpriseAccountUserEmail,
    userPassword: result.enterpriseAccountUserPassword,
    accessToken: result.enterpriseAccountAccessToken,
    workspace: result.enterpriseAccountWorkspace,
  };
  delete result.enterpriseAccountProfileMode;

  if (source.coordinatorMode !== undefined) {
    result.coordinatorMode = Boolean(source.coordinatorMode);
  } else if (result.coordinatorMode === undefined) {
    result.coordinatorMode = DEFAULT_DESKTOP_SETTINGS.coordinatorMode;
  }

  const normalizePositiveInt = (value, fallback, min = 1, max = 1_000_000) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
  };
  // Retired session-summary settings must not return through an old snapshot.
  delete result.sessionMemory;

  const sourceAutoMemory = source.autoMemory && typeof source.autoMemory === 'object' ? source.autoMemory : {};
  const existingAutoMemory = result.autoMemory && typeof result.autoMemory === 'object' ? result.autoMemory : {};
  const normalizePositiveNumber = (value, fallback, min = 0.1, max = 1_000_000) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
  };
  result.autoMemory = {
    enabled:
      sourceAutoMemory.enabled !== undefined
        ? Boolean(sourceAutoMemory.enabled)
        : source.autoMemoryEnabled !== undefined
          ? Boolean(source.autoMemoryEnabled)
          : existingAutoMemory.enabled !== undefined
            ? Boolean(existingAutoMemory.enabled)
            : DEFAULT_DESKTOP_SETTINGS.autoMemory.enabled,
    extractionEnabled:
      sourceAutoMemory.extractionEnabled !== undefined
        ? Boolean(sourceAutoMemory.extractionEnabled)
        : existingAutoMemory.extractionEnabled !== undefined
          ? Boolean(existingAutoMemory.extractionEnabled)
          : DEFAULT_DESKTOP_SETTINGS.autoMemory.extractionEnabled,
    extractionIntervalTurns: normalizePositiveInt(
      sourceAutoMemory.extractionIntervalTurns ?? existingAutoMemory.extractionIntervalTurns,
      DEFAULT_DESKTOP_SETTINGS.autoMemory.extractionIntervalTurns,
      1,
      10_000,
    ),
    pastContextSearchEnabled:
      sourceAutoMemory.pastContextSearchEnabled !== undefined
        ? Boolean(sourceAutoMemory.pastContextSearchEnabled)
        : existingAutoMemory.pastContextSearchEnabled !== undefined
          ? Boolean(existingAutoMemory.pastContextSearchEnabled)
          : DEFAULT_DESKTOP_SETTINGS.autoMemory.pastContextSearchEnabled,
    dreamEnabled:
      sourceAutoMemory.dreamEnabled !== undefined
        ? Boolean(sourceAutoMemory.dreamEnabled)
        : source.autoDreamEnabled !== undefined
          ? Boolean(source.autoDreamEnabled)
          : existingAutoMemory.dreamEnabled !== undefined
            ? Boolean(existingAutoMemory.dreamEnabled)
            : DEFAULT_DESKTOP_SETTINGS.autoMemory.dreamEnabled,
    dreamMinHours: normalizePositiveNumber(
      sourceAutoMemory.dreamMinHours ?? existingAutoMemory.dreamMinHours,
      DEFAULT_DESKTOP_SETTINGS.autoMemory.dreamMinHours,
      0.1,
      24 * 365,
    ),
    dreamMinSessions: normalizePositiveInt(
      sourceAutoMemory.dreamMinSessions ?? existingAutoMemory.dreamMinSessions,
      DEFAULT_DESKTOP_SETTINGS.autoMemory.dreamMinSessions,
      1,
      100_000,
    ),
  };

  const sourceAdvanced = source.advanced && typeof source.advanced === 'object'
    ? source.advanced
    : {};
  const existingAdvanced = result.advanced && typeof result.advanced === 'object'
    ? result.advanced
    : {};
  result.advanced = Object.fromEntries(
    Object.entries(DEFAULT_DESKTOP_SETTINGS.advanced).map(([key, fallback]) => {
      const candidate = sourceAdvanced[key] ?? existingAdvanced[key];
      if (typeof fallback === 'boolean') {
        return [
          key,
          typeof sourceAdvanced[key] === 'boolean'
            ? sourceAdvanced[key]
            : typeof existingAdvanced[key] === 'boolean'
              ? existingAdvanced[key]
              : fallback,
        ];
      }
      if (typeof fallback === 'number') {
        const maximum = key === 'moss_file_read_max_size_bytes'
          ? 1_000_000_000
          : key === 'moss_mcp_output_token_limit' || key === 'moss_file_read_max_tokens'
            ? 1_000_000
            : 10_000_000;
        return [key, normalizePositiveInt(candidate, fallback, 1, maximum)];
      }
      return [
        key,
        candidate === 'proactive' || candidate === 'reactive'
          ? candidate
          : fallback,
      ];
    }),
  );

  const sourceAgentSettings = isPlainObject(source.agentSettings)
    ? source.agentSettings
    : {};
  const existingAgentSettings = isPlainObject(result.agentSettings)
    ? result.agentSettings
    : {};
  const sourceHasDisabledAgents = Object.prototype.hasOwnProperty.call(
    sourceAgentSettings,
    'disabled',
  );
  const existingHasDisabledAgents = Object.prototype.hasOwnProperty.call(
    existingAgentSettings,
    'disabled',
  );
  const legacyVerificationEnabled = typeof sourceAdvanced.moss_hive_evidence === 'boolean'
    ? sourceAdvanced.moss_hive_evidence
    : typeof existingAdvanced.moss_hive_evidence === 'boolean'
      ? existingAdvanced.moss_hive_evidence
      : false;
  const disabledAgents = normalizeAgentTypeList(
    sourceHasDisabledAgents
      ? sourceAgentSettings.disabled
      : existingHasDisabledAgents
        ? existingAgentSettings.disabled
        : typeof sourceAdvanced.moss_hive_evidence === 'boolean'
          ? (sourceAdvanced.moss_hive_evidence ? [] : ['verification'])
          : legacyVerificationEnabled
            ? []
            : DEFAULT_DESKTOP_SETTINGS.agentSettings.disabled,
  );
  result.agentSettings = { disabled: disabledAgents };
  // Keep the legacy runtime gate synchronized while the Desktop UI exposes
  // verification only through Settings → Agents.
  result.advanced.moss_hive_evidence = !disabledAgents.includes('verification');

  const sourceManagedRuntimes = source.managedRuntimes && typeof source.managedRuntimes === 'object'
    ? source.managedRuntimes
    : {};
  const existingManagedRuntimes = result.managedRuntimes && typeof result.managedRuntimes === 'object'
    ? result.managedRuntimes
    : {};
  result.managedRuntimes = {
    node:
      sourceManagedRuntimes.node !== undefined
        ? Boolean(sourceManagedRuntimes.node)
        : existingManagedRuntimes.node !== undefined
          ? Boolean(existingManagedRuntimes.node)
          : DEFAULT_DESKTOP_SETTINGS.managedRuntimes.node,
    python:
      sourceManagedRuntimes.python !== undefined
        ? Boolean(sourceManagedRuntimes.python)
        : existingManagedRuntimes.python !== undefined
          ? Boolean(existingManagedRuntimes.python)
          : DEFAULT_DESKTOP_SETTINGS.managedRuntimes.python,
    git:
      sourceManagedRuntimes.git !== undefined
        ? Boolean(sourceManagedRuntimes.git)
        : existingManagedRuntimes.git !== undefined
          ? Boolean(existingManagedRuntimes.git)
          : DEFAULT_DESKTOP_SETTINGS.managedRuntimes.git,
  };

  // Workflow availability is controlled by its installed App. Discard the retired switch.
  delete result.workflows;

  const sourceAgentMail = source.agentMail && typeof source.agentMail === 'object'
    ? source.agentMail
    : {};
  const existingAgentMail = result.agentMail && typeof result.agentMail === 'object'
    ? result.agentMail
    : {};
  result.agentMail = {
    enabled:
      result.enterpriseEnabled === true && (
        sourceAgentMail.enabled !== undefined
          ? Boolean(sourceAgentMail.enabled)
          : existingAgentMail.enabled !== undefined
            ? Boolean(existingAgentMail.enabled)
            : DEFAULT_DESKTOP_SETTINGS.agentMail.enabled
      ),
    sessionMode: normalizeAgentMailSessionMode(
      sourceAgentMail.sessionMode ?? existingAgentMail.sessionMode,
    ),
    consumerId:
      typeof sourceAgentMail.consumerId === 'string'
        ? sourceAgentMail.consumerId.trim().slice(0, 128)
        : typeof existingAgentMail.consumerId === 'string'
          ? existingAgentMail.consumerId.trim().slice(0, 128)
          : DEFAULT_DESKTOP_SETTINGS.agentMail.consumerId,
    inboxSessionId:
      typeof sourceAgentMail.inboxSessionId === 'string'
        ? sourceAgentMail.inboxSessionId.trim()
        : typeof existingAgentMail.inboxSessionId === 'string'
          ? existingAgentMail.inboxSessionId.trim()
          : DEFAULT_DESKTOP_SETTINGS.agentMail.inboxSessionId,
    inboxSessionIds: Object.fromEntries(
      Object.entries(
        sourceAgentMail.inboxSessionIds && typeof sourceAgentMail.inboxSessionIds === 'object'
          ? sourceAgentMail.inboxSessionIds
          : existingAgentMail.inboxSessionIds && typeof existingAgentMail.inboxSessionIds === 'object'
            ? existingAgentMail.inboxSessionIds
            : {},
      )
        .filter(([key, value]) => (
          key.startsWith('mailbox:') &&
          typeof value === 'string' &&
          value.trim()
        ))
        .map(([key, value]) => [key, value.trim()]),
    ),
  };

  result.appearance = normalizeAppearance(source.appearance, result.appearance);
  result.appWidgets = { enabled: typeof source.appWidgets?.enabled === 'boolean' ? source.appWidgets.enabled : (existing.appWidgets?.enabled ?? true) };

  if (source.logRotationMaxSize !== undefined) {
    let size = Number.parseInt(String(source.logRotationMaxSize), 10);
    if (Number.isFinite(size) && size >= 1024 * 1024) {
      result.logRotationMaxSize = Math.min(size, 100 * 1024 * 1024);
    }
  } else if (result.logRotationMaxSize === undefined) {
    result.logRotationMaxSize = DEFAULT_DESKTOP_SETTINGS.logRotationMaxSize;
  }

  if (source.logRotationMaxFiles !== undefined) {
    let files = Number.parseInt(String(source.logRotationMaxFiles), 10);
    if (Number.isFinite(files) && files >= 1 && files <= 20) {
      result.logRotationMaxFiles = files;
    }
  } else if (result.logRotationMaxFiles === undefined) {
    result.logRotationMaxFiles = DEFAULT_DESKTOP_SETTINGS.logRotationMaxFiles;
  }

  if (source.mcp !== undefined) {
    result.mcp = normalizeMcpStore(source.mcp);
  } else if (result.mcp !== undefined) {
    result.mcp = normalizeMcpStore(result.mcp);
  } else {
    result.mcp = normalizeMcpStore(DEFAULT_DESKTOP_SETTINGS.mcp);
  }

  const sourceSkillHub = source.skillHub && typeof source.skillHub === 'object' ? source.skillHub : {};
  const existingSkillHub = result.skillHub && typeof result.skillHub === 'object'
    ? result.skillHub
    : {};
  const configuredSkillHubApiBaseUrl =
    typeof sourceSkillHub.apiBaseUrl === 'string'
      ? sourceSkillHub.apiBaseUrl.trim()
      : typeof source.skillHubApiBaseUrl === 'string'
        ? source.skillHubApiBaseUrl.trim()
        : typeof existingSkillHub.apiBaseUrl === 'string'
          ? existingSkillHub.apiBaseUrl
          : DEFAULT_DESKTOP_SETTINGS.skillHub.apiBaseUrl;
  result.skillHub = {
    ...existingSkillHub,
    apiBaseUrl: configuredSkillHubApiBaseUrl || DEFAULT_DESKTOP_SETTINGS.skillHub.apiBaseUrl,
  };

  const sourceExpertHub = source.expertHub && typeof source.expertHub === 'object' ? source.expertHub : {};
  const existingExpertHub = result.expertHub && typeof result.expertHub === 'object'
    ? result.expertHub
    : {};
  const configuredExpertHubBaseUrl =
    typeof sourceExpertHub.baseUrl === 'string'
      ? sourceExpertHub.baseUrl.trim()
      : typeof source.expertHubBaseUrl === 'string'
        ? source.expertHubBaseUrl.trim()
        : typeof existingExpertHub.baseUrl === 'string'
          ? existingExpertHub.baseUrl
          : DEFAULT_DESKTOP_SETTINGS.expertHub.baseUrl;
  result.expertHub = {
    ...existingExpertHub,
    baseUrl: configuredExpertHubBaseUrl || DEFAULT_DESKTOP_SETTINGS.expertHub.baseUrl,
  };

  // Adapter configuration moved into independently installed Apps.
  delete result.adapters;

  deleteLegacyServerSettings(result);
  return result;
}

const MODEL_RUNTIME_FIELDS = [
  'model', 'fastModel', 'declaredContextByModel', 'url', 'apiKey', 'maxTurns',
  'thinkingMode', 'thinkingBudgetTokens', 'image',
];

function normalizePersistedDesktopSettings(parsed) {
  const source = { ...parsed };
  const models = objectField(parsed, 'models');
  const text = objectField(models, 'text');
  const thinking = objectField(text, 'thinking');
  // Structured persisted settings are authoritative over stale legacy fields.
  // Flat fields remain supported for incremental updates from the settings UI.
  for (const [field, value] of Object.entries({
    model: text.model,
    fastModel: text.fastModel,
    declaredContextByModel: text.declaredContextByModel,
    url: text.baseUrl,
    apiKey: text.apiKey,
    maxTurns: text.maxTurns,
    thinkingMode: thinking.mode,
    thinkingBudgetTokens: thinking.budgetTokens,
    image: models.image,
  })) {
    if (value !== undefined) source[field] = value;
  }
  return normalizeDesktopSettings(source, source);
}

function loadDesktopSettings(settingsPath, log) {
  const result = {
    path: settingsPath,
    exists: false,
    loaded: false,
    parseError: '',
    appearancePersisted: false,
    value: { ...DEFAULT_DESKTOP_SETTINGS },
  };

  try {
    if (!fs.existsSync(settingsPath)) {
      return result;
    }

    result.exists = true;
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    result.appearancePersisted = hasPersistedAppearance(parsed);
    // 启动加载时，保留原始 JSON 中的所有 key，只对标准 key 进行合并/格式化
    const normalized = normalizePersistedDesktopSettings(parsed);
    result.value = {
      ...parsed,
      ...normalized,
      image: normalized.image || { ...DEFAULT_DESKTOP_SETTINGS.image },
    };
    delete result.value.sessionMemory;
    deleteLegacyServerSettings(result.value);
    result.loaded = true;
    return result;
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error);
    log('error', 'settings', 'Failed to load settings', { error: result.parseError });
    return result;
  }
}

export function buildThinkingConfig(settings) {
  if (settings?.thinkingMode === 'disabled') return { type: 'disabled' };
  if (settings?.thinkingMode === 'adaptive') return { type: 'adaptive' };
  if (settings?.thinkingMode === 'enabled') {
    return { type: 'enabled', budgetTokens: settings.thinkingBudgetTokens };
  }
  return { type: 'auto' };
}

function syncDesktopThinkingEnv(settings) {
  if (settings?.thinkingMode === 'disabled') {
    process.env.CLAUDE_CODE_DISABLE_THINKING = '1';
  } else {
    delete process.env.CLAUDE_CODE_DISABLE_THINKING;
  }
}

function syncDesktopModelEnv(settings) {
  const modelBaseUrl = normalizeMossBaseUrl(settings?.url || '');
  if (modelBaseUrl) {
    process.env.MOSS_MODEL_BASE_URL = modelBaseUrl;
  } else {
    delete process.env.MOSS_MODEL_BASE_URL;
  }
  if (settings?.apiKey) {
    process.env.MOSS_MODEL_AUTH_TOKEN = settings.apiKey;
  } else {
    delete process.env.MOSS_MODEL_AUTH_TOKEN;
  }
}

function saveDesktopSettingsFile(settingsPath, nextSettings, currentSettings) {
  // 读取现有文件，保留 env 等其他配置
  let existingFile = {};
  let existingEnv = {};
  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const existing = JSON.parse(raw);
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        existingFile = existing;
      }
      if (existing && existing.env && typeof existing.env === 'object') {
        existingEnv = existing.env;
      }
    }
  } catch (error) {
    throw new Error(`无法读取现有设置，已停止保存以保留配置：${error.message}`);
  }

  const normalizedSettings = normalizeDesktopSettings(nextSettings, currentSettings);
  const persistedSettings = normalizePersistedDesktopSettings(existingFile);
  // Startup credential hydration and unrelated autosaves must not overwrite
  // model settings edited on disk after this process loaded its snapshot.
  if (Object.keys(existingFile).length > 0) {
    for (const field of MODEL_RUNTIME_FIELDS) {
      if (JSON.stringify(normalizedSettings[field]) === JSON.stringify(currentSettings[field])) {
        normalizedSettings[field] = persistedSettings[field];
      }
    }
  }

  const env = { ...existingEnv };
  deleteManagedEndpointEnvKeys(env);

  const existingModels = existingFile.models && typeof existingFile.models === 'object'
    ? existingFile.models
    : {};
  const existingText = existingModels.text && typeof existingModels.text === 'object'
    ? existingModels.text
    : {};
  const existingTextThinking = existingText.thinking && typeof existingText.thinking === 'object'
    ? existingText.thinking
    : {};
  const imageModel = { model: normalizedSettings.image?.model?.trim() || 'gpt-image-2' };

  const existingRemoteDirect = existingFile.enterpriseAccount && typeof existingFile.enterpriseAccount === 'object'
    ? existingFile.enterpriseAccount
    : {};
  const enterpriseAccount = {
    ...existingRemoteDirect,
    serverUrl: normalizedSettings.enterpriseAccountServerUrl || '',
    credentialMode: normalizeRemoteDirectCredentialMode(
      normalizedSettings.enterpriseAccountCredentialMode,
    ),
    userName: normalizedSettings.enterpriseAccountUserName || '',
    userEmail: normalizedSettings.enterpriseAccountUserEmail || '',
    workspace: normalizedSettings.enterpriseAccountWorkspace || '',
  };
  delete enterpriseAccount.userPassword;
  delete enterpriseAccount.apiKey;
  delete enterpriseAccount.accessToken;
  delete enterpriseAccount.profileMode;

  const models = {
    ...existingModels,
    text: {
      ...existingText,
      baseUrl: normalizeMossBaseUrl(normalizedSettings.url),
      apiKey: normalizedSettings.apiKey || '',
      model: normalizedSettings.model,
      fastModel: normalizedSettings.fastModel || '',
      declaredContextByModel: Object.keys(normalizedSettings.declaredContextByModel).length
        ? normalizedSettings.declaredContextByModel : undefined,
      maxTurns: normalizedSettings.maxTurns,
      thinking: {
        ...existingTextThinking,
        mode: normalizedSettings.thinkingMode,
        budgetTokens: normalizedSettings.thinkingBudgetTokens,
      },
    },
    image: imageModel,
  };

  const toSave = {
    ...existingFile,
    ...normalizedSettings,
    models,
    enterpriseAccount,
    webSearch: {
      mode: normalizedSettings.webSearch?.mode || DEFAULT_DESKTOP_SETTINGS.webSearch.mode,
    },
    env,
  };
  deleteLegacyServerSettings(toSave);
  delete toSave.remoteEnabled;
  for (const key of Object.keys(toSave)) if (key.startsWith('remoteDirect')) delete toSave[key];
  delete toSave.enterpriseAccountServerUrl;
  delete toSave.enterpriseAccountCredentialMode;
  delete toSave.enterpriseAccountUserName;
  delete toSave.enterpriseAccountUserEmail;
  delete toSave.enterpriseAccountUserPassword;
  delete toSave.enterpriseAccountAccessToken;
  delete toSave.enterpriseAccountApiKey;
  delete toSave.enterpriseAccountWorkspace;
  delete toSave.enterpriseAccountProfileMode;
  delete toSave.model;
  delete toSave.fastModel;
  delete toSave.declaredContextByModel;
  delete toSave.maxTurns;
  delete toSave.thinkingMode;
  delete toSave.thinkingBudgetTokens;
  delete toSave.url;
  delete toSave.apiKey;
  delete toSave.image;
  delete toSave.sessionMemory;
  // 删除 undefined 字段
  Object.keys(toSave).forEach(k => toSave[k] === undefined && delete toSave[k]);
  if (!Object.keys(env).length) {
    delete toSave.env;
  }

  fs.writeFileSync(settingsPath, `${JSON.stringify(toSave, null, 2)}\n`, 'utf8');
  syncDesktopThinkingEnv(normalizedSettings);
  syncDesktopModelEnv(normalizedSettings);
  return {
    path: settingsPath,
    exists: true,
    loaded: true,
    parseError: '',
    appearancePersisted: true,
    value: normalizedSettings,
  };
}

export function createDesktopSettingsStore({ settingsPath, log = () => {} }) {
  const authConfig = loadLocalSettingsAuthConfig(settingsPath);
  let state = loadDesktopSettings(settingsPath, log);
  let value = state.value;
  syncDesktopThinkingEnv(value);
  syncDesktopModelEnv(value);
  log('info', 'settings', 'Settings loaded', { path: state.path, exists: state.exists });

  return {
    authConfig,
    get state() {
      return state;
    },
    get value() {
      return value;
    },
    getPayload(extra = {}) {
      return {
        ...value,
        webSearch: {
          mode: value.webSearch?.mode || DEFAULT_DESKTOP_SETTINGS.webSearch.mode,
          tavilyApiKey: '',
          braveApiKey: '',
          tavilyConfigured: Boolean(value.webSearch?.tavilyApiKey),
          braveConfigured: Boolean(value.webSearch?.braveApiKey),
        },
        settingsPath: state.path,
        settingsExists: state.exists,
        settingsLoaded: state.loaded,
        settingsParseError: state.parseError,
        appearancePersisted: state.appearancePersisted,
        ...extra,
      };
    },
    save(nextSettings) {
      state = saveDesktopSettingsFile(settingsPath, nextSettings, value);
      value = state.value;
      return { state, value };
    },
    hydrate(nextSettings) {
      // Credentials are kept in the encrypted store rather than settings.json.
      // Keep the in-memory snapshot in sync without writing those private values
      // back to the public settings file.
      value = normalizeDesktopSettings(nextSettings, value);
      syncDesktopThinkingEnv(value);
      syncDesktopModelEnv(value);
      return { state, value };
    },
    reload() {
      const loaded = loadDesktopSettings(settingsPath, log);
      if (!loaded.loaded && loaded.parseError) throw new Error(loaded.parseError);
      const previous = value;
      state = loaded;
      value = loaded.value;
      // Credentials hydrated from the secure store are intentionally absent on disk.
      value.webSearch = { ...previous.webSearch, mode: value.webSearch.mode };
      if (value.enterpriseAccountServerUrl === previous.enterpriseAccountServerUrl) {
        for (const key of ['enterpriseAccountAccessToken','enterpriseAccountUserPassword']) value[key] = previous[key];
        value.enterpriseAccount = { ...value.enterpriseAccount, accessToken:previous.enterpriseAccountAccessToken, userPassword:previous.enterpriseAccountUserPassword };
      }
      syncDesktopThinkingEnv(value);
      syncDesktopModelEnv(value);
      return { state, value };
    },
  };
}
