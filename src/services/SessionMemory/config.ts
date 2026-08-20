import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/featureFlags.js'
import { getInitialSettings } from '../../utils/settings/settings.js'

export function isSessionMemoryEnabled(): boolean {
  const setting = getInitialSettings().sessionMemory?.enabled
  if (setting !== undefined) return setting
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_session_memory', true)
}

export function isSessionMemoryCompactEnabled(): boolean {
  const setting = getInitialSettings().sessionMemory?.compactEnabled
  if (setting !== undefined) return setting
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_sm_compact', true)
}
