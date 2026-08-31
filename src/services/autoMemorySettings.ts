import {
  autoMemorySettingsSchema,
  DEFAULT_AUTO_MEMORY_SETTINGS,
  normalizeAutoMemorySettings,
  type AutoMemorySettings,
} from '../../packages/direct-connect-protocol/src/index.js'
import { getSessionEnvironmentContext } from '../utils/sessionIdContext.js'
import { getInitialSettings } from '../utils/settings/settings.js'

export const MOSS_AUTO_MEMORY_SETTINGS_ENV = 'MOSS_AUTO_MEMORY_SETTINGS'
export const MOSS_RUNTIME_AUTO_MEMORY_SETTINGS_ENV =
  'MOSS_RUNTIME_AUTO_MEMORY_SETTINGS'

function parseEnvironmentSettings(raw: string | undefined): Partial<AutoMemorySettings> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    const result = autoMemorySettingsSchema().safeParse(parsed)
    return result.success ? result.data : {}
  } catch {
    return {}
  }
}

export function getAutoMemorySettings(): AutoMemorySettings {
  const settings = getInitialSettings()
  const configured = settings.autoMemory ?? {}
  const legacy = {
    ...(settings.autoMemoryEnabled === undefined
      ? {}
      : { enabled: settings.autoMemoryEnabled }),
    ...(settings.autoDreamEnabled === undefined
      ? {}
      : { dreamEnabled: settings.autoDreamEnabled }),
  }
  const processOverrides = parseEnvironmentSettings(
    process.env[MOSS_AUTO_MEMORY_SETTINGS_ENV],
  )
  const sessionOverrides = parseEnvironmentSettings(
    getSessionEnvironmentContext()?.[MOSS_RUNTIME_AUTO_MEMORY_SETTINGS_ENV] ??
      process.env[MOSS_RUNTIME_AUTO_MEMORY_SETTINGS_ENV],
  )
  return normalizeAutoMemorySettings({
    ...DEFAULT_AUTO_MEMORY_SETTINGS,
    ...legacy,
    ...configured,
    ...sessionOverrides,
    ...processOverrides,
  })
}

export function isAutoMemoryExtractionEnabled(): boolean {
  return getAutoMemorySettings().extractionEnabled
}

export function isPastContextSearchEnabled(): boolean {
  return getAutoMemorySettings().pastContextSearchEnabled
}
