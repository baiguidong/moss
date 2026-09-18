import { describe, expect, it } from 'bun:test'

import { DirectConnectSessionManager } from './directConnectManager.js'

function connectedManager() {
  const sent: string[] = []
  const manager = new DirectConnectSessionManager(
    { serverUrl: 'https://example.com', sessionId: 'session-1', wsUrl: 'wss://example.com' },
    { onMessage: () => {}, onPermissionRequest: () => {} },
  )
  const internals = manager as any
  internals.state = 'connected'
  internals.ws = {
    send: (line: string) => sent.push(line),
    close: () => {},
  }
  return { manager, internals, sent }
}

describe('DirectConnectSessionManager permission mode', () => {
  it('sends set_permission_mode and resolves its matching response', async () => {
    const { manager, internals, sent } = connectedManager()
    const pending = manager.setPermissionMode('dontAsk')
    const request = JSON.parse(sent[0]!)
    expect(request).toMatchObject({
      type: 'control_request',
      request: { subtype: 'set_permission_mode', mode: 'dontAsk' },
    })

    internals.handleIncomingText(JSON.stringify({
      type: 'control_response',
      response: { subtype: 'success', request_id: request.request_id, response: {} },
    }))
    await expect(pending).resolves.toBeUndefined()
  })

  it('surfaces a rejected remote permission change', async () => {
    const { manager, internals, sent } = connectedManager()
    const pending = manager.setPermissionMode('plan')
    const request = JSON.parse(sent[0]!)
    internals.handleIncomingText(JSON.stringify({
      type: 'control_response',
      response: { subtype: 'error', request_id: request.request_id, error: 'not allowed' },
    }))
    await expect(pending).rejects.toThrow('not allowed')
  })
})
