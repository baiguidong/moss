type JsonObject = Record<string, unknown>

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function trackClientControlRequest(
  message: JsonObject | null,
  pendingRequestIds: Set<string>,
): void {
  if (message?.type !== 'control_request' || !isJsonObject(message.request)) {
    return
  }
  if (message.request.subtype === 'interrupt') {
    return
  }
  if (typeof message.request_id === 'string' && message.request_id) {
    pendingRequestIds.add(message.request_id)
  }
}

export function consumeClientControlResponse(
  message: JsonObject | null,
  pendingRequestIds: Set<string>,
): boolean {
  if (message?.type !== 'control_response' || !isJsonObject(message.response)) {
    return false
  }
  const requestId = message.response.request_id
  return typeof requestId === 'string' && pendingRequestIds.delete(requestId)
}
