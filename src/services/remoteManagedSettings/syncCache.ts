/**
 * Eligibility check for remote managed settings.
 *
 * The cache state itself lives in syncCacheState.ts (a leaf, no auth import).
 * This file keeps isRemoteManagedSettingsEligible — the one function that
 * needs Moss server endpoint checks — plus resetSyncCache wrapped to clear
 * the local eligibility mirror alongside the leaf's state.
 */

import {
  getMossServerApiUrl,
  getMossServerAuthHeaders,
} from '../../constants/api.js'

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
 * Eligibility:
 * - Moss server users with a configured server token are eligible.
 *
 * This is a pre-check to determine if we should query the API.
 * The API will return empty settings for users without managed settings.
 *
 * IMPORTANT: This function must NOT call getSettings() or any function that calls
 * getSettings() to avoid circular dependencies during settings loading.
 */
export function isRemoteManagedSettingsEligible(): boolean {
  if (cached !== undefined) return cached

  // Cowork runs in a VM with its own permission model; server-managed settings
  // (designed for CLI/CCD) don't apply there, and per-surface settings don't
  // exist yet. MDM/file-based managed settings still apply via settings.ts —
  // those require physical deployment and a different IT intent.
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') {
    return (cached = setEligibility(false))
  }

  return (cached = setEligibility(
    Boolean(getMossServerApiUrl('/api/v1/settings/remote-managed')) &&
      Object.keys(getMossServerAuthHeaders()).length > 0,
  ))
}
