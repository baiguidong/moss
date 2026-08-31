import {
  advancedSettingsSchema,
  DEFAULT_ADVANCED_SETTINGS,
  normalizeAdvancedSettings,
  type AdvancedSettings,
} from '../../packages/direct-connect-protocol/src/index.js'
import { getSessionEnvironmentContext } from '../utils/sessionIdContext.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  hasFeatureFlagEnvOverride,
} from './analytics/featureFlags.js'

export const MOSS_RUNTIME_ADVANCED_SETTINGS_ENV =
  'MOSS_RUNTIME_ADVANCED_SETTINGS'

export type AdvancedSettingKey = keyof AdvancedSettings

const ADVANCED_SETTING_KEYS = Object.keys(
  DEFAULT_ADVANCED_SETTINGS,
) as AdvancedSettingKey[]

function parseEnvironmentSettings(
  raw: string | undefined,
): Partial<AdvancedSettings> {
  if (!raw) return {}
  try {
    const parsed = advancedSettingsSchema().safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

function applySettingValue<Key extends AdvancedSettingKey>(
  target: AdvancedSettings,
  source: AdvancedSettings,
  key: Key,
): void {
  target[key] = source[key]
}

export function getAdvancedSettings(): AdvancedSettings {
  const featureValues = Object.fromEntries(
    ADVANCED_SETTING_KEYS.map(key => [
      key,
      getFeatureValue_CACHED_MAY_BE_STALE(
        key,
        DEFAULT_ADVANCED_SETTINGS[key],
      ),
    ]),
  ) as AdvancedSettings
  const sessionOverrides = parseEnvironmentSettings(
    getSessionEnvironmentContext()?.[MOSS_RUNTIME_ADVANCED_SETTINGS_ENV] ??
      process.env[MOSS_RUNTIME_ADVANCED_SETTINGS_ENV],
  )
  const merged = normalizeAdvancedSettings({
    ...featureValues,
    ...sessionOverrides,
  })

  // Explicit process environment overrides remain the highest-precedence
  // mechanism for diagnostics and managed deployments.
  for (const key of ADVANCED_SETTING_KEYS) {
    if (hasFeatureFlagEnvOverride(key)) {
      applySettingValue(merged, featureValues, key)
    }
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
