import { describe, expect, it } from 'bun:test'

import { DirectConnectSessionManager } from './directConnectManager.js'
import { setDirectConnectFetchImplementation } from './directConnectFetch.js'
import { EventEmitter } from 'node:events'

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

describe('DirectConnectSessionManager', () => {
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

  it('rejects pending controls on disconnect and ignores their late responses after reconnect', async () => {
    const { manager, internals, sent } = connectedManager()
    internals.hasEverConnected = true
    const pending = manager.setPermissionMode('plan')
    const rejected = pending.catch(error => error as Error)
    const oldRequest = JSON.parse(sent[0]!)
    internals.handleSocketClose(1006)
    expect((await rejected as Error).message).toContain('disconnected')
    expect(internals.pendingControlRequests.size).toBe(0)
    expect(manager.isConnected()).toBe(false)
    clearTimeout(internals.reconnectTimer)
    internals.reconnectTimer = null
    internals.ws = { send: (line: string) => sent.push(line), off: () => {}, close: () => {} }
    internals.handleOpen()
    try {
      let resolved = false
      const next = manager.setPermissionMode('default').then(() => { resolved = true })
      const currentRequest = JSON.parse(sent.at(-1)!)
      const reply = (requestId: string) => internals.handleIncomingText(JSON.stringify({
        type: 'control_response', response: { subtype: 'success', request_id: requestId, response: {} },
      }))
      reply(oldRequest.request_id)
      await Promise.resolve()
      expect(resolved).toBe(false)
      expect(internals.pendingControlRequests.size).toBe(1)
      reply(currentRequest.request_id)
      await next
      expect(internals.pendingControlRequests.size).toBe(0)
    } finally { manager.disconnect() }
  })

  it('detaches every socket listener and cancels reconnect work on explicit disconnect', () => {
    const { manager, internals } = connectedManager()
    const socket = Object.assign(new EventEmitter(), { close: () => {}, send: () => {} })
    internals.ws = socket
    for (const [event, handler] of [
      ['open', internals.onNodeOpen], ['message', internals.onNodeMessage],
      ['error', internals.onNodeError], ['close', internals.onNodeClose], ['pong', internals.onPong],
    ]) socket.on(event, handler)
    internals.reconnectTimer = setTimeout(() => { throw new Error('must be canceled') }, 1000)
    manager.disconnect()
    manager.disconnect()
    expect(socket.eventNames()).toEqual([])
    expect(internals.reconnectTimer).toBeNull()
    expect(internals.pingInterval).toBeNull()
    expect(internals.ws).toBeNull()
  })

  for (const restart of [false, true]) {
    it(`ignores a pending reattach after disconnect${restart ? ' and a new connection' : ''}`, async () => {
      const { manager, internals } = connectedManager()
      let respond!: (response: Response) => void
      let started!: () => void
      const ready = new Promise<void>(resolve => { started = resolve })
      setDirectConnectFetchImplementation((async () => {
        started()
        return new Promise<Response>(resolve => { respond = resolve })
      }) as typeof fetch)
      let opened = 0
      internals.openSocket = async () => { opened++; internals.state = 'connecting' }
      try {
        internals.state = 'reconnecting'
        const pending = internals.reattachAndReconnect()
        await ready
        manager.disconnect()
        if (restart) manager.connect()
        respond(Response.json({
          session: {
            sessionId: 'session-1', transcriptSessionId: 'engine-1', workDir: '/workspace',
            userId: 'user', orgId: 'org', role: 'user', scopes: [],
            runtime: { backend: 'host', profileDir: '/profile', transcriptDir: '/transcripts' },
            status: 'running', desiredState: 'active', createdAt: 1, lastActiveAt: 1,
          }, ws_url: 'wss://example.com/new-socket',
        }))
        await pending
        expect(opened).toBe(restart ? 1 : 0)
        expect(internals.config.wsUrl).toBe('wss://example.com')
        expect(internals.state).toBe(restart ? 'connecting' : 'closed')
      } finally {
        setDirectConnectFetchImplementation()
        manager.disconnect()
      }
    })
  }
})
