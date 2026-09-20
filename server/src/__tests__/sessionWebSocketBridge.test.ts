import { describe, expect, test } from 'bun:test'
import {
  consumeClientControlResponse,
  trackClientControlRequest,
} from '../sessionWebSocketBridge.js'

describe('session WebSocket control request routing', () => {
  test('routes a control response only to the client that sent the request', () => {
    const firstClient = new Set<string>()
    const secondClient = new Set<string>()
    const request = {
      type: 'control_request',
      request_id: 'permission-request-1',
      request: { subtype: 'set_permission_mode', mode: 'plan' },
    }
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'permission-request-1',
        response: {},
      },
    }

    trackClientControlRequest(request, firstClient)

    expect(consumeClientControlResponse(response, secondClient)).toBe(false)
    expect(consumeClientControlResponse(response, firstClient)).toBe(true)
    expect(consumeClientControlResponse(response, firstClient)).toBe(false)
  })

  test('does not track interrupt requests acknowledged by the WebSocket bridge', () => {
    const pending = new Set<string>()
    trackClientControlRequest({
      type: 'control_request',
      request_id: 'interrupt-request-1',
      request: { subtype: 'interrupt' },
    }, pending)
    expect(pending.size).toBe(0)
  })
})
