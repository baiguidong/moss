import fs from 'node:fs';

import { maskAdapterSettings, mergeAdapterSettings } from './adapter-settings.mjs';
import {
  DEFAULT_APPEARANCE,
  hasPersistedAppearance,
  normalizeAppearance,
} from './appearance-settings.mjs';
import { normalizeMcpStore } from './desktop-mcp-settings.mjs';

const DEFAULT_BYPASS_PERMISSIONS = process.env.CLAUDE_CODE_BYPASS_PERMISSIONS === 'true';

export const DEFAULT_DESKTOP_SETTINGS = Object.freeze({
  agentMode: 'local',
  localEnabled: true,
  remoteEnabled: false,
  bypassPermissions: DEFAULT_BYPASS_PERMISSIONS,
  model: 'claude-sonnet-4-6',
  maxTurns: 100,
  appendSystemPrompt: '',
  thinkingMode: 'adaptive',
  thinkingBudgetTokens: 16000,
  url: '',
  apiKey: '',
  image: {
    provider: 'minimax',
    url: 'https://api.minimaxi.com/v1/image_generation',
    apiKey: '',
    model: '',
  },
  sessionMemory: {
    enabled: true,
    compactEnabled: true,
    minimumMessageTokensToInit: 10000,
    minimumTokensBetweenUpdate: 5000,
    toolCallsBetweenUpdates: 3,
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
  adapters: {},
  remoteDirectServerUrl: '',
  remoteDirectCredentialMode: 'password',
  remoteDirectUserEmail: '',
  remoteDirectUserPassword: '',
  remoteDirectApiKey: '',
  remoteDirectWorkspace: '',
  remoteDirectProfileMode: 'session',
  coordinatorMode: false,
  logRotationMaxSize: 10 * 1024 * 1024, // 10MB
  logRotationMaxFiles: 5,
});


export function normalizeMossBaseUrl(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const normalizedPath = url.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
    return `${url.origin}${normalizedPath}${url.search}${url.hash}`;
  } catch {
    return trimmed.replace(/\/+$/, '').replace(/\/v1$/, '');
  }
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

function firstNonEmptyString(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0);
}

function boundedInt(value, min, max) {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, max) : undefined;
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
  return value === 'api-key' ? 'api-key' : 'password';
}

export function normalizeRemoteDirectProfileMode(value) {
  return value === 'user' ? 'user' : 'session';
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

export function normalizeDesktopSettings(input, existing = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const result = { ...existing };
  const sourceModels = objectField(source, 'models');
  const sourceText = objectField(sourceModels, 'text');
  const sourceTextThinking = objectField(sourceText, 'thinking');
  const existingModels = objectField(existing, 'models');
  const existingText = objectField(existingModels, 'text');
  const existingTextThinking = objectField(existingText, 'thinking');
  const sourceRemoteDirect = objectField(source, 'remoteDirect');
  const existingRemoteDirect = objectField(existing, 'remoteDirect');

  if (source.agentMode !== undefined) {
    result.agentMode = source.agentMode === 'remote-direct' ? 'remote-direct' : 'local';
  } else if (result.agentMode === undefined) {
    result.agentMode = DEFAULT_DESKTOP_SETTINGS.agentMode;
  }

  if (source.localEnabled !== undefined) {
    result.localEnabled = Boolean(source.localEnabled);
  } else if (result.localEnabled === undefined) {
    result.localEnabled = DEFAULT_DESKTOP_SETTINGS.localEnabled;
  }

  if (source.remoteEnabled !== undefined) {
    result.remoteEnabled = Boolean(source.remoteEnabled);
  } else if (result.remoteEnabled === undefined) {
    result.remoteEnabled = DEFAULT_DESKTOP_SETTINGS.remoteEnabled;
  }

  result.model =
    firstNonEmptyString(
      stringField(source, 'model'),
      stringField(sourceText, 'model'),
      stringField(result, 'model'),
      stringField(existingText, 'model'),
    ) || DEFAULT_DESKTOP_SETTINGS.model;

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

  result.thinkingMode =
    source.thinkingMode ??
    sourceTextThinking.mode ??
    result.thinkingMode ??
    existingTextThinking.mode ??
    DEFAULT_DESKTOP_SETTINGS.thinkingMode;

  result.thinkingBudgetTokens =
    boundedInt(source.thinkingBudgetTokens, 1024, 128_000) ??
    boundedInt(sourceTextThinking.budgetTokens, 1024, 128_000) ??
    boundedInt(result.thinkingBudgetTokens, 1024, 128_000) ??
    boundedInt(existingTextThinking.budgetTokens, 1024, 128_000) ??
    DEFAULT_DESKTOP_SETTINGS.thinkingBudgetTokens;

  if (source.bypassPermissions !== undefined) {
    result.bypassPermissions = Boolean(source.bypassPermissions);
  } else if (result.bypassPermissions === undefined) {
    result.bypassPermissions = DEFAULT_DESKTOP_SETTINGS.bypassPermissions;
  }

  result.url =
    normalizeMossBaseUrl(
      firstNonEmptyString(
        stringField(source, 'url'),
        stringField(sourceText, 'baseUrl'),
        stringField(result, 'url'),
        stringField(existingText, 'baseUrl'),
      ) || '',
    ) || DEFAULT_DESKTOP_SETTINGS.url;

  result.apiKey =
    firstNonEmptyString(
      stringField(source, 'apiKey'),
      stringField(sourceText, 'apiKey'),
      stringField(result, 'apiKey'),
      stringField(existingText, 'apiKey'),
    ) || DEFAULT_DESKTOP_SETTINGS.apiKey;

  const sourceImage = source.image && typeof source.image === 'object' ? source.image : objectField(sourceModels, 'image');
  const existingImage = result.image && typeof result.image === 'object' ? result.image : {};
  const existingModelImage = objectField(existingModels, 'image');
  result.image = {
    provider:
      typeof sourceImage.provider === 'string'
        ? sourceImage.provider.trim()
        : typeof existingImage.provider === 'string'
          ? existingImage.provider
          : typeof existingModelImage.provider === 'string'
            ? existingModelImage.provider
          : DEFAULT_DESKTOP_SETTINGS.image.provider,
    url:
      typeof sourceImage.baseUrl === 'string'
        ? sourceImage.baseUrl.trim()
        : typeof sourceImage.url === 'string'
          ? sourceImage.url.trim()
        : typeof existingModelImage.baseUrl === 'string'
          ? existingModelImage.baseUrl
          : typeof existingImage.url === 'string'
            ? existingImage.url
          : DEFAULT_DESKTOP_SETTINGS.image.url,
    apiKey:
      typeof sourceImage.apiKey === 'string'
        ? sourceImage.apiKey.trim()
        : typeof existingImage.apiKey === 'string'
          ? existingImage.apiKey
          : typeof existingModelImage.apiKey === 'string'
            ? existingModelImage.apiKey
          : DEFAULT_DESKTOP_SETTINGS.image.apiKey,
    model:
      typeof sourceImage.model === 'string'
        ? sourceImage.model.trim()
        : typeof existingImage.model === 'string'
          ? existingImage.model
          : typeof existingModelImage.model === 'string'
            ? existingModelImage.model
          : DEFAULT_DESKTOP_SETTINGS.image.model,
  };

  result.remoteDirectServerUrl =
    ownStringField(source, 'remoteDirectServerUrl') ??
    ownStringField(sourceRemoteDirect, 'serverUrl') ??
    stringField(result, 'remoteDirectServerUrl') ??
    stringField(existingRemoteDirect, 'serverUrl') ??
    DEFAULT_DESKTOP_SETTINGS.remoteDirectServerUrl;

  result.remoteDirectCredentialMode = normalizeRemoteDirectCredentialMode(
    source.remoteDirectCredentialMode ??
      sourceRemoteDirect.credentialMode ??
      result.remoteDirectCredentialMode ??
      existingRemoteDirect.credentialMode ??
      DEFAULT_DESKTOP_SETTINGS.remoteDirectCredentialMode,
  );

  result.remoteDirectUserEmail =
    ownStringField(source, 'remoteDirectUserEmail') ??
    ownStringField(sourceRemoteDirect, 'userEmail') ??
    stringField(result, 'remoteDirectUserEmail') ??
    stringField(existingRemoteDirect, 'userEmail') ??
    DEFAULT_DESKTOP_SETTINGS.remoteDirectUserEmail;

  result.remoteDirectUserPassword =
    ownRawStringField(source, 'remoteDirectUserPassword') ??
    ownRawStringField(sourceRemoteDirect, 'userPassword') ??
    (typeof result.remoteDirectUserPassword === 'string'
      ? result.remoteDirectUserPassword
      : typeof existingRemoteDirect.userPassword === 'string'
        ? existingRemoteDirect.userPassword
        : DEFAULT_DESKTOP_SETTINGS.remoteDirectUserPassword);

  result.remoteDirectApiKey =
    ownStringField(source, 'remoteDirectApiKey') ??
    ownStringField(sourceRemoteDirect, 'apiKey') ??
    stringField(result, 'remoteDirectApiKey') ??
    stringField(existingRemoteDirect, 'apiKey') ??
    DEFAULT_DESKTOP_SETTINGS.remoteDirectApiKey;

  result.remoteDirectWorkspace =
    ownStringField(source, 'remoteDirectWorkspace') ??
    ownStringField(sourceRemoteDirect, 'workspace') ??
    stringField(result, 'remoteDirectWorkspace') ??
    stringField(existingRemoteDirect, 'workspace') ??
    DEFAULT_DESKTOP_SETTINGS.remoteDirectWorkspace;

  result.remoteDirectProfileMode = normalizeRemoteDirectProfileMode(
    source.remoteDirectProfileMode ??
      sourceRemoteDirect.profileMode ??
      result.remoteDirectProfileMode ??
      existingRemoteDirect.profileMode ??
      DEFAULT_DESKTOP_SETTINGS.remoteDirectProfileMode,
  );

  result.remoteDirect = {
    serverUrl: result.remoteDirectServerUrl,
    credentialMode: result.remoteDirectCredentialMode,
    userEmail: result.remoteDirectUserEmail,
    userPassword: result.remoteDirectUserPassword,
    apiKey: result.remoteDirectApiKey,
    workspace: result.remoteDirectWorkspace,
    profileMode: result.remoteDirectProfileMode,
  };

  if (source.coordinatorMode !== undefined) {
    result.coordinatorMode = Boolean(source.coordinatorMode);
  } else if (result.coordinatorMode === undefined) {
    result.coordinatorMode = DEFAULT_DESKTOP_SETTINGS.coordinatorMode;
  }

  const sourceSessionMemory = source.sessionMemory && typeof source.sessionMemory === 'object' ? source.sessionMemory : {};
  const existingSessionMemory = result.sessionMemory && typeof result.sessionMemory === 'object' ? result.sessionMemory : {};
  const normalizePositiveInt = (value, fallback, min = 1, max = 1_000_000) => {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return Math.min(parsed, max);
  };
  result.sessionMemory = {
    enabled:
      sourceSessionMemory.enabled !== undefined
        ? Boolean(sourceSessionMemory.enabled)
        : existingSessionMemory.enabled !== undefined
          ? Boolean(existingSessionMemory.enabled)
          : DEFAULT_DESKTOP_SETTINGS.sessionMemory.enabled,
    compactEnabled:
      sourceSessionMemory.compactEnabled !== undefined
        ? Boolean(sourceSessionMemory.compactEnabled)
        : existingSessionMemory.compactEnabled !== undefined
          ? Boolean(existingSessionMemory.compactEnabled)
          : DEFAULT_DESKTOP_SETTINGS.sessionMemory.compactEnabled,
    minimumMessageTokensToInit: normalizePositiveInt(
      sourceSessionMemory.minimumMessageTokensToInit ?? existingSessionMemory.minimumMessageTokensToInit,
      DEFAULT_DESKTOP_SETTINGS.sessionMemory.minimumMessageTokensToInit,
      1,
      1_000_000,
    ),
    minimumTokensBetweenUpdate: normalizePositiveInt(
      sourceSessionMemory.minimumTokensBetweenUpdate ?? existingSessionMemory.minimumTokensBetweenUpdate,
      DEFAULT_DESKTOP_SETTINGS.sessionMemory.minimumTokensBetweenUpdate,
      1,
      1_000_000,
    ),
    toolCallsBetweenUpdates: normalizePositiveInt(
      sourceSessionMemory.toolCallsBetweenUpdates ?? existingSessionMemory.toolCallsBetweenUpdates,
      DEFAULT_DESKTOP_SETTINGS.sessionMemory.toolCallsBetweenUpdates,
      1,
      10_000,
    ),
  };

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

  result.appearance = normalizeAppearance(source.appearance, result.appearance);

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

  if (source.adapters !== undefined) {
    result.adapters = mergeAdapterSettings(result.adapters, source.adapters);
  } else if (result.adapters === undefined) {
    result.adapters = {};
  }

  deleteLegacyServerSettings(result);
  return result;
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
    const normalized = normalizeDesktopSettings(parsed, parsed);
    result.value = {
      ...parsed,
      ...normalized,
      image: normalized.image || { ...DEFAULT_DESKTOP_SETTINGS.image },
    };
    deleteLegacyServerSettings(result.value);
    result.loaded = true;
    return result;
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error);
    log('error', 'settings', 'Failed to load settings', { error: result.parseError });
    return result;
  }
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
  const normalizedSettings = normalizeDesktopSettings(nextSettings, currentSettings);

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
  } catch { /* ignore */ }

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
  const existingImage = existingModels.image && typeof existingModels.image === 'object'
    ? existingModels.image
    : {};
  const imageModel = {
    ...existingImage,
    provider: normalizedSettings.image?.provider ?? DEFAULT_DESKTOP_SETTINGS.image.provider,
    baseUrl: normalizedSettings.image?.url ?? DEFAULT_DESKTOP_SETTINGS.image.url,
    apiKey: normalizedSettings.image?.apiKey ?? DEFAULT_DESKTOP_SETTINGS.image.apiKey,
    model: normalizedSettings.image?.model ?? DEFAULT_DESKTOP_SETTINGS.image.model,
  };
  delete imageModel.url;

  const existingRemoteDirect = existingFile.remoteDirect && typeof existingFile.remoteDirect === 'object'
    ? existingFile.remoteDirect
    : {};
  const remoteDirect = {
    ...existingRemoteDirect,
    serverUrl: normalizedSettings.remoteDirectServerUrl || '',
    credentialMode: normalizeRemoteDirectCredentialMode(
      normalizedSettings.remoteDirectCredentialMode,
    ),
    userEmail: normalizedSettings.remoteDirectUserEmail || '',
    userPassword: normalizedSettings.remoteDirectUserPassword || '',
    apiKey: normalizedSettings.remoteDirectApiKey || '',
    workspace: normalizedSettings.remoteDirectWorkspace || '',
    profileMode: normalizeRemoteDirectProfileMode(
      normalizedSettings.remoteDirectProfileMode,
    ),
  };

  const models = {
    ...existingModels,
    text: {
      ...existingText,
      baseUrl: normalizeMossBaseUrl(normalizedSettings.url),
      apiKey: normalizedSettings.apiKey || '',
      model: normalizedSettings.model,
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
    remoteDirect,
    env,
  };
  deleteLegacyServerSettings(toSave);
  delete toSave.remoteDirectServerUrl;
  delete toSave.remoteDirectCredentialMode;
  delete toSave.remoteDirectUserEmail;
  delete toSave.remoteDirectUserPassword;
  delete toSave.remoteDirectApiKey;
  delete toSave.remoteDirectWorkspace;
  delete toSave.remoteDirectProfileMode;
  delete toSave.model;
  delete toSave.maxTurns;
  delete toSave.thinkingMode;
  delete toSave.thinkingBudgetTokens;
  delete toSave.url;
  delete toSave.apiKey;
  delete toSave.image;
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
        adapters: maskAdapterSettings(value.adapters),
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
  };
}
