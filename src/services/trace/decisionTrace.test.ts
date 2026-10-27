import { describe, expect, test } from 'bun:test'
import {
  createPermissionDecisionTraceMetadata,
  recordPermissionDecisionTrace,
} from './decisionTrace.js'
import { setTraceCaptureFallback } from './traceOutput.js'

describe('permission decision trace', () => {
  test('builds a redaction-safe relationship metadata record', () => {
    const metadata = createPermissionDecisionTraceMetadata({
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      agentId: 'agent-1',
      decision: 'reject',
      source: 'user_reject',
      permissionMode: 'default',
      waitingForUserPermissionMs: 42,
    })
    expect(metadata).toEqual({
      turnId: 'turn-1',
      toolUseId: 'tool-1',
      toolName: 'Bash',
      agentId: 'agent-1',
      decision: 'reject',
      source: 'user_reject',
      permissionMode: 'default',
      waitingForUserPermissionMs: 42,
    })
    expect(JSON.stringify(metadata)).not.toContain('password')
  })

  test('records an event through the configured trace adapter', async () => {
    const events: unknown[] = []
    setTraceCaptureFallback(() => ({
      recordCall: async () => null,
      recordEvent: async event => {
        events.push(event)
        return event
      },
    }))
    try {
      recordPermissionDecisionTrace({
        sessionId: 'session-2',
        turnId: 'turn-2',
        toolUseId: 'tool-2',
        toolName: 'Write',
        decision: 'accept',
        source: 'hook',
      })
      await new Promise(resolve => setImmediate(resolve))
      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        sessionId: 'session-2',
        phase: 'permission_decision',
        severity: 'info',
        metadata: { turnId: 'turn-2', toolUseId: 'tool-2', decision: 'accept' },
      })
    } finally {
      setTraceCaptureFallback(undefined)
    }
  })
})
