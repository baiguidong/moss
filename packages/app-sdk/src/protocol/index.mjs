import { randomUUID } from 'node:crypto'

export const APP_SERVICE_PROTOCOL_VERSION = 1
export const APP_BACKEND_API_VERSION = 1
export const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024

export const HOST_MESSAGE_TYPES = Object.freeze([
  'service.init',
  'action.invoke',
  'action.cancel',
  'host.response',
  'host.event',
  'host.event.cancel',
  'service.ping',
  'service.shutdown',
])

export const BACKEND_MESSAGE_TYPES = Object.freeze([
  'service.hello',
  'service.ready',
  'service.status',
  'action.result',
  'action.error',
  'host.request',
  'host.cancel',
  'host.event.response',
  'event.emit',
  'service.pong',
  'log.write',
])

export { APP_ERROR_CODES, AppServiceError, serializeError } from '../errors.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../errors.mjs'

export function createEnvelope(type, payload = {}, options = {}) {
  return {
    version: APP_SERVICE_PROTOCOL_VERSION,
    id: String(options.id || randomUUID()),
    type: String(type),
    timestamp: Number(options.timestamp || Date.now()),
    payload,
  }
}

export function getEnvelopeByteLength(envelope) {
  return Buffer.byteLength(JSON.stringify(envelope), 'utf8')
}

export function validateEnvelope(raw, options = {}) {
  const allowedTypes = options.allowedTypes || [...HOST_MESSAGE_TYPES, ...BACKEND_MESSAGE_TYPES]
  const maxBytes = Number(options.maxBytes) || DEFAULT_MAX_MESSAGE_BYTES
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol message must be an object')
  }
  if (raw.version !== APP_SERVICE_PROTOCOL_VERSION) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, `Unsupported protocol version: ${raw.version}`)
  }
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 128) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol message id is invalid')
  }
  if (!allowedTypes.includes(raw.type)) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, `Unknown protocol message type: ${raw.type}`)
  }
  if (!Number.isFinite(raw.timestamp) || raw.timestamp <= 0) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol timestamp is invalid')
  }
  if (getEnvelopeByteLength(raw) > maxBytes) {
    throw new AppServiceError(APP_ERROR_CODES.handshakeFailed, 'Protocol message exceeds the size limit')
  }
  return raw
}
