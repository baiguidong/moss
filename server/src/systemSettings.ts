import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { getMossServerHomeDir } from './lib/env.js'
import type { ServerConfig } from './types.js'

export type ThinkingMode = 'adaptive' | 'enabled' | 'disabled'

export type SystemSettingsImage = {
  provider: string
  url: string
  apiKey: string
  model: string
}

export type SystemSettingsServerRuntime = {
  dockerImage: string
}

export type SystemSettingsOpenIM = {
  configured: boolean
  enabled: boolean
  instanceId: string
  apiUrl: string
  wsUrl: string
  chatUrl: string
  adminUserId: string
  secret: string
  webhookSecret: string
  requestTimeoutMs: number
}

export type SystemSettingsPayload = {
  bypassPermissions: boolean
  model: string
  maxTurns: number
  thinkingMode: ThinkingMode
  thinkingBudgetTokens: number
  url: string
  apiKey: string
  image: SystemSettingsImage
  serverRuntime: SystemSettingsServerRuntime
  openIM: SystemSettingsOpenIM
  settingsPath: string
  settingsExists: boolean
  settingsLoaded: boolean
  settingsParseError: string
}

type PersistedSystemSettings = Record<string, unknown> & Omit<
  SystemSettingsPayload,
  'settingsPath' | 'settingsExists' | 'settingsLoaded' | 'settingsParseError'
>

const DEFAULT_BYPASS_PERMISSIONS =
  process.env.CLAUDE_CODE_BYPASS_PERMISSIONS === 'true'
export const SYSTEM_SETTINGS_PATH = path.join(
  getMossServerHomeDir(),
  'settings.json',
)

function getSystemSettingsPath(): string {
  return path.join(getMossServerHomeDir(), 'settings.json')
}

const DEFAULT_SYSTEM_SETTINGS: Omit<
  SystemSettingsPayload,
  'settingsPath' | 'settingsExists' | 'settingsLoaded' | 'settingsParseError'
> = {
  bypassPermissions: DEFAULT_BYPASS_PERMISSIONS,
  model: 'claude-sonnet-4-6',
  maxTurns: 100,
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
  serverRuntime: {
    dockerImage: 'moss-runtime:latest',
  },
  openIM: {
    configured: false,
    enabled: false,
    instanceId: 'default',
    apiUrl: '',
    wsUrl: '',
    chatUrl: '',
    adminUserId: 'imAdmin',
    secret: '',
    webhookSecret: '',
    requestTimeoutMs: 15_000,
  },
}

type SystemSettingsState = {
  path: string
  exists: boolean
  loaded: boolean
  parseError: string
  value: PersistedSystemSettings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeThinkingMode(value: unknown): ThinkingMode | null {
  if (
    value === 'adaptive' ||
    value === 'enabled' ||
    value === 'disabled'
  ) {
    return value
  }
  return null
}

function recordField(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return isRecord(source[key]) ? source[key] : {}
}

function stringField(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof source[key] === 'string' ? source[key].trim() : undefined
}

function firstNonEmptyString(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find(value => typeof value === 'string' && value.length > 0)
}

function boundedInt(
  value: unknown,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) {
    return undefined
  }
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) && parsed >= min
    ? Math.min(parsed, max)
    : undefined
}

function stringValue(
  source: Record<string, unknown>,
  key: string,
  fallback: string,
): string {
  return typeof source[key] === 'string' ? source[key].trim() : fallback
}

function deleteManagedEndpointEnvKeys(env: Record<string, unknown>): void {
  for (const key of Object.keys(env)) {
    if (
      /^MOSS_(MODEL_)?(BASE_URL|AUTH_TOKEN)$/.test(key) ||
      key === 'MOSS_SERVER_URL' ||
      key === 'MOSS_SERVER_AUTH_TOKEN'
    ) {
      delete env[key]
    }
  }
}

function normalizeSystemSettings(
  input: unknown,
  existing: Record<string, unknown> = {},
): PersistedSystemSettings {
  const source = isRecord(input) ? input : {}
  const result: Record<string, unknown> = { ...existing }
  const sourceModels = recordField(source, 'models')
  const sourceText = recordField(sourceModels, 'text')
  const sourceTextThinking = recordField(sourceText, 'thinking')
  const existingModels = recordField(existing, 'models')
  const existingText = recordField(existingModels, 'text')
  const existingTextThinking = recordField(existingText, 'thinking')

  result.model =
    firstNonEmptyString(
      stringField(source, 'model'),
      stringField(sourceText, 'model'),
      stringField(result, 'model'),
      stringField(existingText, 'model'),
    ) ?? DEFAULT_SYSTEM_SETTINGS.model

  result.maxTurns =
    boundedInt(source.maxTurns, 1, 10_000) ??
    boundedInt(sourceText.maxTurns, 1, 10_000) ??
    boundedInt(result.maxTurns, 1, 10_000) ??
    boundedInt(existingText.maxTurns, 1, 10_000) ??
    DEFAULT_SYSTEM_SETTINGS.maxTurns

  if (source.bypassPermissions !== undefined) {
    result.bypassPermissions = Boolean(source.bypassPermissions)
  } else if (result.bypassPermissions === undefined) {
    result.bypassPermissions = DEFAULT_SYSTEM_SETTINGS.bypassPermissions
  }

  result.thinkingMode =
    normalizeThinkingMode(source.thinkingMode) ??
    normalizeThinkingMode(sourceTextThinking.mode) ??
    normalizeThinkingMode(result.thinkingMode) ??
    normalizeThinkingMode(existingTextThinking.mode) ??
    DEFAULT_SYSTEM_SETTINGS.thinkingMode

  result.thinkingBudgetTokens =
    boundedInt(source.thinkingBudgetTokens, 1024, 128_000) ??
    boundedInt(sourceTextThinking.budgetTokens, 1024, 128_000) ??
    boundedInt(result.thinkingBudgetTokens, 1024, 128_000) ??
    boundedInt(existingTextThinking.budgetTokens, 1024, 128_000) ??
    DEFAULT_SYSTEM_SETTINGS.thinkingBudgetTokens

  result.url =
    firstNonEmptyString(
      stringField(source, 'url'),
      stringField(sourceText, 'baseUrl'),
      stringField(result, 'url'),
      stringField(existingText, 'baseUrl'),
    ) ?? DEFAULT_SYSTEM_SETTINGS.url

  result.apiKey =
    firstNonEmptyString(
      stringField(source, 'apiKey'),
      stringField(sourceText, 'apiKey'),
      stringField(result, 'apiKey'),
      stringField(existingText, 'apiKey'),
    ) ?? DEFAULT_SYSTEM_SETTINGS.apiKey

  const sourceImage = isRecord(source.image)
    ? source.image
    : recordField(sourceModels, 'image')
  const existingImage = isRecord(result.image) ? result.image : {}
  const existingModelImage = recordField(existingModels, 'image')
  result.image = {
    provider:
      typeof sourceImage.provider === 'string'
        ? sourceImage.provider.trim()
        : typeof existingImage.provider === 'string'
          ? existingImage.provider
          : typeof existingModelImage.provider === 'string'
            ? existingModelImage.provider
          : DEFAULT_SYSTEM_SETTINGS.image.provider,
    url:
      typeof sourceImage.baseUrl === 'string'
        ? sourceImage.baseUrl.trim()
        : typeof sourceImage.url === 'string'
          ? sourceImage.url.trim()
        : typeof existingModelImage.baseUrl === 'string'
          ? existingModelImage.baseUrl
          : typeof existingImage.url === 'string'
            ? existingImage.url
          : DEFAULT_SYSTEM_SETTINGS.image.url,
    apiKey:
      typeof sourceImage.apiKey === 'string'
        ? sourceImage.apiKey.trim()
        : typeof existingImage.apiKey === 'string'
          ? existingImage.apiKey
          : typeof existingModelImage.apiKey === 'string'
            ? existingModelImage.apiKey
          : DEFAULT_SYSTEM_SETTINGS.image.apiKey,
    model:
      typeof sourceImage.model === 'string'
        ? sourceImage.model.trim()
        : typeof existingImage.model === 'string'
          ? existingImage.model
          : typeof existingModelImage.model === 'string'
            ? existingModelImage.model
          : DEFAULT_SYSTEM_SETTINGS.image.model,
  }

  const sourceServerRuntime = isRecord(source.serverRuntime)
    ? source.serverRuntime
    : {}
  const existingServerRuntime = isRecord(result.serverRuntime)
    ? result.serverRuntime
    : {}
  result.serverRuntime = {
    dockerImage:
      firstNonEmptyString(
        stringField(sourceServerRuntime, 'dockerImage'),
        stringField(existingServerRuntime, 'dockerImage'),
      ) ?? DEFAULT_SYSTEM_SETTINGS.serverRuntime.dockerImage,
  }

  const sourceOpenIM = isRecord(source.openIM)
    ? source.openIM
    : isRecord(source.openim)
      ? source.openim
      : {}
  const existingOpenIM = isRecord(result.openIM)
    ? result.openIM
    : isRecord(result.openim)
      ? result.openim
      : {}
  const hasOpenIMPatch = isRecord(source.openIM) || isRecord(source.openim)
  result.openIM = {
    configured: hasOpenIMPatch
      ? true
      : typeof existingOpenIM.configured === 'boolean'
        ? existingOpenIM.configured
        : DEFAULT_SYSTEM_SETTINGS.openIM.configured,
    enabled: typeof sourceOpenIM.enabled === 'boolean'
      ? sourceOpenIM.enabled
      : typeof existingOpenIM.enabled === 'boolean'
        ? existingOpenIM.enabled
        : DEFAULT_SYSTEM_SETTINGS.openIM.enabled,
    instanceId: stringValue(
      sourceOpenIM,
      'instanceId',
      stringValue(existingOpenIM, 'instanceId', DEFAULT_SYSTEM_SETTINGS.openIM.instanceId),
    ) || DEFAULT_SYSTEM_SETTINGS.openIM.instanceId,
    apiUrl: stringValue(
      sourceOpenIM,
      'apiUrl',
      stringValue(existingOpenIM, 'apiUrl', DEFAULT_SYSTEM_SETTINGS.openIM.apiUrl),
    ).replace(/\/+$/, ''),
    wsUrl: stringValue(
      sourceOpenIM,
      'wsUrl',
      stringValue(existingOpenIM, 'wsUrl', DEFAULT_SYSTEM_SETTINGS.openIM.wsUrl),
    ).replace(/\/+$/, ''),
    chatUrl: stringValue(
      sourceOpenIM,
      'chatUrl',
      stringValue(existingOpenIM, 'chatUrl', DEFAULT_SYSTEM_SETTINGS.openIM.chatUrl),
    ).replace(/\/+$/, ''),
    adminUserId: stringValue(
      sourceOpenIM,
      'adminUserId',
      stringValue(existingOpenIM, 'adminUserId', DEFAULT_SYSTEM_SETTINGS.openIM.adminUserId),
    ) || DEFAULT_SYSTEM_SETTINGS.openIM.adminUserId,
    secret: stringValue(
      sourceOpenIM,
      'secret',
      stringValue(existingOpenIM, 'secret', DEFAULT_SYSTEM_SETTINGS.openIM.secret),
    ),
    webhookSecret: stringValue(
      sourceOpenIM,
      'webhookSecret',
      stringValue(existingOpenIM, 'webhookSecret', DEFAULT_SYSTEM_SETTINGS.openIM.webhookSecret),
    ),
    requestTimeoutMs:
      boundedInt(sourceOpenIM.requestTimeoutMs, 1_000, 120_000) ??
      boundedInt(existingOpenIM.requestTimeoutMs, 1_000, 120_000) ??
      DEFAULT_SYSTEM_SETTINGS.openIM.requestTimeoutMs,
  }
  delete result.openim

  return result as PersistedSystemSettings
}

function readSystemSettingsState(): SystemSettingsState {
  const settingsPath = getSystemSettingsPath()
  const result: SystemSettingsState = {
    path: settingsPath,
    exists: false,
    loaded: false,
    parseError: '',
    value: { ...DEFAULT_SYSTEM_SETTINGS },
  }

  try {
    if (!existsSync(settingsPath)) {
      return result
    }

    result.exists = true
    const raw = readFileSync(settingsPath, 'utf8')
    const parsed = JSON.parse(raw)
    const rawSettings = isRecord(parsed) ? parsed : {}
    const normalized = normalizeSystemSettings(rawSettings, rawSettings)

    result.value = {
      ...rawSettings,
      ...normalized,
      image: normalized.image || { ...DEFAULT_SYSTEM_SETTINGS.image },
      openIM: normalized.openIM || { ...DEFAULT_SYSTEM_SETTINGS.openIM },
    }
    result.loaded = true
    return result
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error)
    return result
  }
}

function toSystemSettingsPayload(
  state: SystemSettingsState,
): SystemSettingsPayload {
  return {
    bypassPermissions: state.value.bypassPermissions,
    model: state.value.model,
    maxTurns: state.value.maxTurns,
    thinkingMode: state.value.thinkingMode,
    thinkingBudgetTokens: state.value.thinkingBudgetTokens,
    url: state.value.url,
    apiKey: state.value.apiKey,
    image: state.value.image,
    serverRuntime: state.value.serverRuntime,
    openIM: state.value.openIM,
    settingsPath: state.path,
    settingsExists: state.exists,
    settingsLoaded: state.loaded,
    settingsParseError: state.parseError,
  }
}

export function getSystemSettings(): SystemSettingsPayload {
  return toSystemSettingsPayload(readSystemSettingsState())
}

export function toOpenIMServerConfig(
  settings: SystemSettingsOpenIM,
): NonNullable<ServerConfig['openim']> {
  return {
    enabled: settings.enabled,
    instanceId: settings.instanceId,
    apiUrl: settings.apiUrl || undefined,
    wsUrl: settings.wsUrl || undefined,
    chatUrl: settings.chatUrl || undefined,
    adminUserId: settings.adminUserId,
    secret: settings.secret || undefined,
    webhookSecret: settings.webhookSecret || undefined,
    requestTimeoutMs: settings.requestTimeoutMs,
  }
}

export function updateSystemSettings(patch: unknown): SystemSettingsPayload {
  const settingsPath = getSystemSettingsPath()
  const state = readSystemSettingsState()
  const currentSettings = state.value
  const nextSettings = {
    ...currentSettings,
    ...normalizeSystemSettings(patch, currentSettings),
  }

  let existingFile: Record<string, unknown> = {}
  let existingEnv: Record<string, unknown> = {}

  try {
    if (existsSync(settingsPath)) {
      const raw = readFileSync(settingsPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (isRecord(parsed)) {
        existingFile = parsed
        if (isRecord(parsed.env)) {
          existingEnv = { ...parsed.env }
        }
      }
    }
  } catch {
    // Preserve the current save path even when the previous file is malformed.
  }

  const env: Record<string, unknown> = { ...existingEnv }
  deleteManagedEndpointEnvKeys(env)

  const existingModels = isRecord(existingFile.models) ? existingFile.models : {}
  const existingText = isRecord(existingModels.text)
    ? existingModels.text
    : {}
  const existingTextThinking = isRecord(existingText.thinking)
    ? existingText.thinking
    : {}
  const existingImage = isRecord(existingModels.image)
    ? existingModels.image
    : {}
  const imageModel: Record<string, unknown> = {
    ...existingImage,
    provider: nextSettings.image.provider,
    baseUrl: nextSettings.image.url,
    apiKey: nextSettings.image.apiKey,
    model: nextSettings.image.model,
  }
  delete imageModel.url

  const models = {
    ...existingModels,
    text: {
      ...existingText,
      baseUrl: nextSettings.url,
      apiKey: nextSettings.apiKey,
      model: nextSettings.model,
      maxTurns: nextSettings.maxTurns,
      thinking: {
        ...existingTextThinking,
        mode: nextSettings.thinkingMode,
        budgetTokens: nextSettings.thinkingBudgetTokens,
      },
    },
    image: imageModel,
  }

  const toSave: Record<string, unknown> = {
    ...existingFile,
    bypassPermissions: nextSettings.bypassPermissions,
    models,
    serverRuntime: nextSettings.serverRuntime,
    openIM: nextSettings.openIM,
    env,
  }

  delete toSave.image
  delete toSave.model
  delete toSave.maxTurns
  delete toSave.thinkingMode
  delete toSave.thinkingBudgetTokens
  delete toSave.url
  delete toSave.apiKey
  delete toSave.serverUrl
  delete toSave.serverAuthToken
  delete toSave.skillStore
  delete toSave.openim
  if (Object.keys(env).length === 0) {
    delete toSave.env
  }

  mkdirSync(path.dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, `${JSON.stringify(toSave, null, 2)}\n`, 'utf8')
  chmodSync(settingsPath, 0o600)

  return {
    bypassPermissions: nextSettings.bypassPermissions,
    model: nextSettings.model,
    maxTurns: nextSettings.maxTurns,
    thinkingMode: nextSettings.thinkingMode,
    thinkingBudgetTokens: nextSettings.thinkingBudgetTokens,
    url: nextSettings.url,
    apiKey: nextSettings.apiKey,
    image: nextSettings.image,
    serverRuntime: nextSettings.serverRuntime,
    openIM: nextSettings.openIM,
    settingsPath,
    settingsExists: true,
    settingsLoaded: true,
    settingsParseError: '',
  }
}
