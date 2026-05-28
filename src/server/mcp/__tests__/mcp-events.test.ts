import { describe, it, expect, afterEach } from 'bun:test'
import { EventEmitter } from 'events'
import type { ServerResponse } from 'http'
import { broadcastMcpEvent, handleMcpSseConnection } from '../../api/mcpEvents.js'

class MockResponse extends EventEmitter {
  headers: Record<string, string> = {}
  written: string[] = []
  ended = false
  statusCode = 200

  writeHead(statusCode: number, headers: Record<string, string>) {
    this.statusCode = statusCode
    this.headers = headers
    return this
  }

  write(data: string) {
    this.written.push(data)
    return true
  }

  end() {
    this.ended = true
    this.emit('close')
    return this
  }
}

describe('McpEvents (SSE)', () => {
  afterEach(() => {
    // Clean up any lingering clients by forcing close
  })

  it('establishes SSE connection with correct headers', () => {
    const res = new MockResponse()
    handleMcpSseConnection(res as unknown as ServerResponse, 'org-1')

    expect(res.statusCode).toBe(200)
    expect(res.headers['Content-Type']).toBe('text/event-stream')
    expect(res.headers['Cache-Control']).toBe('no-cache')
    expect(res.written).toContain(':connected\n\n')
  })

  it('broadcasts events to matching org', () => {
    const res1 = new MockResponse()
    const res2 = new MockResponse()

    handleMcpSseConnection(res1 as unknown as ServerResponse, 'org-1')
    handleMcpSseConnection(res2 as unknown as ServerResponse, 'org-2')

    broadcastMcpEvent({ org_id: 'org-1', type: 'mcp.changed' })

    // res1 should receive the event
    const hasEvent = res1.written.some(d => d.includes('mcp.changed') && d.includes('org-1'))
    expect(hasEvent).toBe(true)

    // res2 should NOT receive the event (different org)
    const hasEvent2 = res2.written.some(d => d.includes('mcp.changed'))
    expect(hasEvent2).toBe(false)
  })

  it('handles client disconnect gracefully', () => {
    const res = new MockResponse()
    handleMcpSseConnection(res as unknown as ServerResponse, 'org-1')

    // Simulate disconnect
    res.emit('close')

    // Broadcasting should not throw
    expect(() => {
      broadcastMcpEvent({ org_id: 'org-1', type: 'mcp.policy.changed' })
    }).not.toThrow()
  })

  it('formats SSE events correctly', () => {
    const res = new MockResponse()
    handleMcpSseConnection(res as unknown as ServerResponse, 'org-1')

    broadcastMcpEvent({ org_id: 'org-1', type: 'mcp.changed' })

    const eventMessages = res.written.filter(d => d.startsWith('event:'))
    expect(eventMessages.length).toBe(1)
    expect(eventMessages[0]).toContain('event: mcp.changed')
    expect(eventMessages[0]).toContain('data: ')
    expect(eventMessages[0]).toContain('"type":"mcp.changed"')
    expect(eventMessages[0]).toContain('"org_id":"org-1"')
  })

  it('broadcasts policy change events', () => {
    const res = new MockResponse()
    handleMcpSseConnection(res as unknown as ServerResponse, 'org-1')

    broadcastMcpEvent({ org_id: 'org-1', type: 'mcp.policy.changed' })

    const hasPolicyEvent = res.written.some(d => d.includes('mcp.policy.changed'))
    expect(hasPolicyEvent).toBe(true)
  })
})
