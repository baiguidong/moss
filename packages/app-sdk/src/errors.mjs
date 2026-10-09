export const APP_ERROR_CODES = Object.freeze({
  invalidManifest: 'APP_INVALID_MANIFEST',
  incompatibleHost: 'APP_INCOMPATIBLE_HOST_API',
  invalidPackage: 'APP_INVALID_PACKAGE',
  integrityFailed: 'APP_INTEGRITY_FAILED',
  disabled: 'APP_DISABLED',
  instanceDisabled: 'APP_INSTANCE_DISABLED',
  actionNotFound: 'APP_ACTION_NOT_FOUND',
  invalidInput: 'APP_INVALID_ACTION_INPUT',
  invalidOutput: 'APP_INVALID_ACTION_OUTPUT',
  actionTimeout: 'APP_ACTION_TIMEOUT',
  actionCanceled: 'APP_ACTION_CANCELED',
  backendUnavailable: 'APP_BACKEND_UNAVAILABLE',
  handshakeFailed: 'APP_HANDSHAKE_FAILED',
  staleGeneration: 'APP_STALE_GENERATION',
  crashLoop: 'APP_CRASH_LOOP',
  unauthorized: 'APP_UNAUTHORIZED',
  permissionDenied: 'APP_PERMISSION_DENIED',
  hostUnavailable: 'APP_HOST_UNAVAILABLE',
  hostTimeout: 'APP_HOST_TIMEOUT',
  hostProtocol: 'APP_HOST_PROTOCOL_ERROR',
  conflict: 'APP_CONFLICT',
  resourceExhausted: 'APP_RESOURCE_EXHAUSTED',
  notFound: 'APP_NOT_FOUND',
})

export class AppServiceError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'AppServiceError'
    this.code = code
    if (details !== undefined) this.details = details
  }
}

export function serializeError(error, fallbackCode = APP_ERROR_CODES.backendUnavailable) {
  // Native SDKs can reject with response objects instead of Error instances.
  // Keep their diagnostic fields structured so the Host can redact them.
  const message = [error?.message, error?.errDlt, error?.errMsg, error]
    .find(value => typeof value === 'string' && value.trim())
  const nativeDetails = error?.errCode !== undefined ? {
    errCode: error.errCode,
    errMsg: error.errMsg,
    errDlt: error.errDlt,
    operationID: error.operationID,
  } : undefined
  return {
    code: String(error?.code || error?.errCode || fallbackCode),
    message: message || 'Unknown App Backend error',
    details: error?.details ?? nativeDetails,
  }
}

export function abortError(signal, fallbackCode = APP_ERROR_CODES.actionCanceled) {
  return typeof signal?.reason?.code === 'string' ? signal.reason
    : new AppServiceError(fallbackCode, signal?.reason?.message || 'App request cancelled')
}
export function requestTimeout(value, fallback = 30000, maximum = 300000) {
  const duration = value ?? fallback
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 100 || duration > maximum) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `timeoutMs must be between 100 and ${maximum}`)
  }
  return duration
}
