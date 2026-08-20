import { initializeErrorLogSink } from './errorLogSink.js'

/**
 * Attach error log sinks. Called from setup() for the default command; other
 * entrypoints call this directly since they bypass setup().
 *
 * Leaf module kept out of setup.ts to avoid setup/commands import cycles.
 */
export function initSinks(): void {
  initializeErrorLogSink()
}
