import {
  advancedSettingsSchema,
  DEFAULT_ADVANCED_SETTINGS,
  type AdvancedSettings,
} from '../../packages/direct-connect-protocol/src/index.js'
import { getSessionEnvironmentContext } from '../utils/sessionIdContext.js'
import {
  getFeatureFlagConfigOverrides,
  getFeatureFlagEnvOverrides,
} from './analytics/featureFlags.js'

export const MOSS_RUNTIME_ADVANCED_SETTINGS_ENV =
  'MOSS_RUNTIME_ADVANCED_SETTINGS'

export type AdvancedSettingKey = keyof AdvancedSettings

const ADVANCED_SETTING_KEYS = Object.keys(
  DEFAULT_ADVANCED_SETTINGS,
) as AdvancedSettingKey[]

function applySettingValue<Key extends AdvancedSettingKey>(
  target: Partial<AdvancedSettings>,
  source: Partial<AdvancedSettings>,
  key: Key,
): void {
  const value = source[key]
  if (value !== undefined) target[key] = value
}

function parseSettingEntries(value: unknown): Partial<AdvancedSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const parsed = advancedSettingsSchema().safeParse(value)
  if (parsed.success) return parsed.data

  const source = value as Record<string, unknown>
  const settings: Partial<AdvancedSettings> = {}
  for (const key of ADVANCED_SETTING_KEYS) {
    if (!(key in source)) continue
    const entry = advancedSettingsSchema().safeParse({ [key]: source[key] })
    if (entry.success) applySettingValue(settings, entry.data, key)
  }
  return settings
}

function parseEnvironmentSettings(
  raw: string | undefined,
): Partial<AdvancedSettings> {
  if (!raw) return {}
  try {
    return parseSettingEntries(JSON.parse(raw))
  } catch {
    return {}
  }
}

export function getAdvancedSettings(): AdvancedSettings {
  const featureValues = parseSettingEntries(getFeatureFlagConfigOverrides())
  const sessionOverrides = parseEnvironmentSettings(
    getSessionEnvironmentContext()?.[MOSS_RUNTIME_ADVANCED_SETTINGS_ENV] ??
      process.env[MOSS_RUNTIME_ADVANCED_SETTINGS_ENV],
  )
  const environmentOverrides = parseSettingEntries(
    getFeatureFlagEnvOverrides(),
  )
  const merged: AdvancedSettings = {
    ...DEFAULT_ADVANCED_SETTINGS,
    ...featureValues,
    ...sessionOverrides,
    ...environmentOverrides,
  }
  return merged
}

export function getAdvancedSetting<Key extends AdvancedSettingKey>(
  key: Key,
): AdvancedSettings[Key] {
  return getAdvancedSettings()[key]
}

export function getAdvancedSettingsEnvironment(): Record<string, string> {
  return {
    [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify(
      getAdvancedSettings(),
    ),
  }
}
