import {
  resetSyncCache as resetLeafCache,
  setEligibility,
} from './syncCacheState.js'

let cached: boolean | undefined

export function resetSyncCache(): void {
  cached = undefined
  resetLeafCache()
}

/**
 * Check if the current user is eligible for remote managed settings
 *
 * Moss Server remote-managed settings are disabled in this build. Keep this
 * helper so startup/cache call sites can short-circuit without conditional
 * imports.
 */
export function isRemoteManagedSettingsEligible(): boolean {
  if (cached !== undefined) return cached
  return (cached = setEligibility(false))
}
