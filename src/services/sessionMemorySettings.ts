import {
  DEFAULT_SESSION_MEMORY_SETTINGS,
  normalizeSessionMemorySettings,
  sessionMemorySettingsSchema,
  type SessionMemorySettings,
} from '../../packages/direct-connect-protocol/src/index.js'
import { getSessionEnvironmentContext } from '../utils/sessionIdContext.js'
import { getInitialSettings } from '../utils/settings/settings.js'

export const MOSS_SESSION_MEMORY_SETTINGS_ENV = 'MOSS_SESSION_MEMORY_SETTINGS'
export const MOSS_RUNTIME_SESSION_MEMORY_SETTINGS_ENV =
  'MOSS_RUNTIME_SESSION_MEMORY_SETTINGS'

function parseEnvironmentSettings(
  raw: string | undefined,
): Partial<SessionMemorySettings> {
  if (!raw) return {}
  try {
    const parsed = sessionMemorySettingsSchema().safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : {}
  } catch {
    return {}
  }
}

export function getSessionMemorySettings(): SessionMemorySettings {
  const configured = getInitialSettings().sessionMemory ?? {}
  const sessionOverrides = parseEnvironmentSettings(
    getSessionEnvironmentContext()?.[
      MOSS_RUNTIME_SESSION_MEMORY_SETTINGS_ENV
    ] ?? process.env[MOSS_RUNTIME_SESSION_MEMORY_SETTINGS_ENV],
  )
  const processOverrides = parseEnvironmentSettings(
    process.env[MOSS_SESSION_MEMORY_SETTINGS_ENV],
  )
  return normalizeSessionMemorySettings({
    ...DEFAULT_SESSION_MEMORY_SETTINGS,
    ...configured,
    ...sessionOverrides,
    ...processOverrides,
  })
}
