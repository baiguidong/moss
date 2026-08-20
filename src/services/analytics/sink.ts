/**
 * Analytics sink implementation
 *
 * Moss agent does not send product analytics. This sink is intentionally kept
 * as a no-op compatibility layer so existing logEvent call sites can remain
 * lightweight and side-effect free.
 *
 * Usage: Call initializeAnalyticsSink() during app startup to attach the sink.
 */

import { attachAnalyticsSink, stripProtoFields } from './index.js'

// Local type matching the logEvent metadata signature
type LogEventMetadata = { [key: string]: boolean | number | undefined }

/**
 * Log an event (synchronous implementation)
 */
function logEventImpl(eventName: string, metadata: LogEventMetadata): void {
  void eventName
  void stripProtoFields(metadata)
}

/**
 * Log an event (asynchronous implementation)
 *
 * Kept to preserve the sink interface contract.
 */
function logEventAsyncImpl(
  eventName: string,
  metadata: LogEventMetadata,
): Promise<void> {
  logEventImpl(eventName, metadata)
  return Promise.resolve()
}

/**
 * Initialize the analytics sink.
 *
 * Call this during app startup to attach the analytics backend.
 * Any events logged before this is called will be queued and drained.
 *
 * Idempotent: safe to call multiple times (subsequent calls are no-ops).
 */
export function initializeAnalyticsSink(): void {
  attachAnalyticsSink({
    logEvent: logEventImpl,
    logEventAsync: logEventAsyncImpl,
  })
}
