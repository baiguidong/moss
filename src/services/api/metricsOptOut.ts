import {
  getMossServerApiUrl,
  getMossServerAuthHeaders,
} from '../../constants/api.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { logError } from '../../utils/log.js'
import { memoizeWithTTLAsync } from '../../utils/memoize.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'

type MetricsEnabledResponse = {
  metrics_logging_enabled: boolean
}

type MetricsStatus = {
  enabled: boolean
  hasError: boolean
}

// In-memory TTL — dedupes calls within a single process
const CACHE_TTL_MS = 60 * 60 * 1000

// Disk TTL — org settings rarely change. When disk cache is fresher than this,
// we skip the network entirely (no background refresh). This is what collapses
// N `claude -p` invocations into ~1 API call/day.
const DISK_CACHE_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Internal function to call the API and check if metrics are enabled
 * This is wrapped by memoizeWithTTLAsync to add caching behavior
 */
async function _fetchMetricsEnabled(): Promise<MetricsEnabledResponse> {
  const endpoint = getMossServerApiUrl('/api/v1/telemetry/metrics-enabled')
  const hasServerAuth = Object.keys(getMossServerAuthHeaders()).length > 0
  return { metrics_logging_enabled: Boolean(endpoint && hasServerAuth) }
}

async function _checkMetricsEnabledAPI(): Promise<MetricsStatus> {
  // Incident kill switch: skip the network call when nonessential traffic is disabled.
  // Returning enabled:false sheds load at the consumer (bigqueryExporter skips
  // export). Matches the normal disabled response shape below.
  if (isEssentialTrafficOnly()) {
    return { enabled: false, hasError: false }
  }

  try {
    const data = await _fetchMetricsEnabled()

    logForDebugging(
      `Metrics opt-out local status: enabled=${data.metrics_logging_enabled}`,
    )

    return {
      enabled: data.metrics_logging_enabled,
      hasError: false,
    }
  } catch (error) {
    logForDebugging('Failed to check metrics opt-out status')
    logError(error)
    return { enabled: false, hasError: true }
  }
}

// Create memoized version with custom error handling
const memoizedCheckMetrics = memoizeWithTTLAsync(
  _checkMetricsEnabledAPI,
  CACHE_TTL_MS,
)

/**
 * Fetch (in-memory memoized) and persist to disk on change.
 * Errors are not persisted — a transient failure should not overwrite a
 * known-good disk value.
 */
async function refreshMetricsStatus(): Promise<MetricsStatus> {
  const result = await memoizedCheckMetrics()
  if (result.hasError) {
    return result
  }

  const cached = getGlobalConfig().metricsStatusCache
  const unchanged = cached !== undefined && cached.enabled === result.enabled
  // Skip write when unchanged AND timestamp still fresh — avoids config churn
  // when concurrent callers race past a stale disk entry and all try to write.
  if (unchanged && Date.now() - cached.timestamp < DISK_CACHE_TTL_MS) {
    return result
  }

  saveGlobalConfig(current => ({
    ...current,
    metricsStatusCache: {
      enabled: result.enabled,
      timestamp: Date.now(),
    },
  }))
  return result
}

/**
 * Check if metrics are enabled for the current organization.
 *
 * Until Moss server exposes organization-level controls, metrics are enabled
 * only when a Moss server endpoint and auth token are configured.
 */
export async function checkMetricsEnabled(): Promise<MetricsStatus> {
  const hasMossServerTelemetry =
    Boolean(getMossServerApiUrl('/api/v1/telemetry/metrics-enabled')) &&
    Object.keys(getMossServerAuthHeaders()).length > 0
  if (!hasMossServerTelemetry) {
    return { enabled: false, hasError: false }
  }
  return refreshMetricsStatus()
}

// Export for testing purposes only
export const _clearMetricsEnabledCacheForTesting = (): void => {
  memoizedCheckMetrics.cache.clear()
}
