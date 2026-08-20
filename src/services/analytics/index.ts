/**
 * Analytics service - public API for event logging.
 *
 * Moss agent does not send product analytics. The public API remains as a
 * side-effect-free compatibility boundary for existing call sites.
 */

/**
 * Marker type for verifying analytics metadata doesn't contain sensitive data
 *
 * This type forces explicit verification that string values being logged
 * don't contain code snippets, file paths, or other sensitive information.
 *
 * Usage: `myString as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never

/**
 * Marker type for values that used to be routed through private proto fields.
 * Kept so call sites remain explicit about sensitive metadata.
 *
 * Usage: `rawName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED`
 */
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

/**
 * Strip `_PROTO_*` keys before metadata crosses the analytics boundary.
 *
 * Returns the input unchanged (same reference) when no _PROTO_ keys present.
 */
export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  let result: Record<string, V> | undefined
  for (const key in metadata) {
    if (key.startsWith('_PROTO_')) {
      if (result === undefined) {
        result = { ...metadata }
      }
      delete result[key]
    }
  }
  return result ?? metadata
}

type LogEventMetadata = { [key: string]: boolean | number | undefined }

export function logEvent(
  _eventName: string,
  // intentionally no strings unless AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  // to avoid accidentally logging code/filepaths
  _metadata: LogEventMetadata,
): void {
  return
}

export async function logEventAsync(
  _eventName: string,
  // intentionally no strings, to avoid accidentally logging code/filepaths
  _metadata: LogEventMetadata,
): Promise<void> {
  return
}

export function _resetForTesting(): void {
  return
}
