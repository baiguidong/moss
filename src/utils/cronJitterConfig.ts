// feature flag-backed cron jitter configuration.
//
// Separated from cronScheduler.ts so the scheduler can be bundled in the
// Agent SDK public build without pulling in analytics/featureFlags.ts and
// its large transitive dependency set (settings/hooks/config cycle).
//
// Usage:
//   REPL (useScheduledTasks.ts): pass `getJitterConfig: getCronJitterConfig`
//   Daemon/SDK: omit getJitterConfig → DEFAULT_CRON_JITTER_CONFIG applies.

import {
  type CronJitterConfig,
  DEFAULT_CRON_JITTER_CONFIG,
} from './cronTasks.js'

/**
 * Return the local default jitter configuration.
 */
export function getCronJitterConfig(): CronJitterConfig {
  return DEFAULT_CRON_JITTER_CONFIG
}
