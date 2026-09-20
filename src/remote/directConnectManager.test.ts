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
    off: () => {},
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

  it('acknowledges a remote turn interrupt', async () => {
    const { manager, internals, sent } = connectedManager()
    const pending = manager.sendInterrupt()
    const request = JSON.parse(sent[0]!)
    expect(request).toMatchObject({
      type: 'control_request',
      request: { subtype: 'interrupt' },
    })

    internals.handleIncomingText(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: request.request_id,
        response: { interrupted: true },
      },
    }))
    await expect(pending).resolves.toEqual({ interrupted: true })
    expect(manager.isConnected()).toBe(true)
  })

  it('preserves a false interrupt acknowledgement for a queued turn', async () => {
    const { manager, internals, sent } = connectedManager()
    const pending = manager.sendInterrupt()
    const request = JSON.parse(sent[0]!)

    internals.handleIncomingText(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: request.request_id,
        response: { interrupted: false },
      },
    }))
    await expect(pending).resolves.toEqual({ interrupted: false })
  })

  it('never replays sent prompts after reconnecting', () => {
    const { manager, internals, sent } = connectedManager()
    expect(manager.sendMessage('first prompt', { uuid: 'message-1' })).toBe(true)
    expect(sent).toHaveLength(1)

    sent.length = 0
    internals.state = 'reconnecting'
    internals.hasEverConnected = true
    internals.handleOpen()

    expect(sent).toEqual([])
    manager.disconnect()
  })

  it('rejects prompts while disconnected instead of queueing them', () => {
    const { manager, internals, sent } = connectedManager()
    internals.state = 'reconnecting'

    expect(manager.sendMessage('must be retried by the user', { uuid: 'message-2' })).toBe(false)
    expect(sent).toEqual([])
    manager.disconnect()
  })
})
