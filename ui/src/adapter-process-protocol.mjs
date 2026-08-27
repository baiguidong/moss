import { randomUUID } from 'node:crypto';

export const ADAPTER_BRIDGE_VERSION = 1;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createAdapterBridgeMessage(type, payload = {}, options = {}) {
  if (typeof type !== 'string' || !type.trim()) {
    throw new Error('Adapter bridge message type is required.');
  }
  return {
    version: ADAPTER_BRIDGE_VERSION,
    id: options.id || randomUUID(),
    type: type.trim(),
    timestamp: options.timestamp || Date.now(),
    payload,
  };
}

export function createAdapterBridgeResponse(request, result) {
  return {
    version: ADAPTER_BRIDGE_VERSION,
    replyTo: request.id,
    ok: true,
    result,
  };
}

export function createAdapterBridgeErrorResponse(request, error, code = 'ADAPTER_REQUEST_FAILED') {
  return {
    version: ADAPTER_BRIDGE_VERSION,
    replyTo: request.id,
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error || 'Adapter request failed.'),
    },
  };
}

export function parseAdapterBridgeRequest(value) {
  if (!isRecord(value)) return null;
  if (value.version !== ADAPTER_BRIDGE_VERSION) return null;
  if (typeof value.id !== 'string' || !value.id.trim()) return null;
  if (typeof value.type !== 'string' || !value.type.trim()) return null;
  return {
    version: ADAPTER_BRIDGE_VERSION,
    id: value.id.trim(),
    type: value.type.trim(),
    timestamp: Number(value.timestamp) || Date.now(),
    payload: value.payload,
  };
}
