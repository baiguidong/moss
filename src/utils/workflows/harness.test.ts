import { describe, expect, test } from 'bun:test'
import { createWorkflowSharedCounters } from './harness.js'
import type { WorkflowProgressEvent } from './types.js'

describe('workflow shared state', () => {
  test('assigns distinct phase rows across parent and nested workflows', () => {
    const shared = createWorkflowSharedCounters()
    const events: WorkflowProgressEvent[] = []
    const emit = (event: WorkflowProgressEvent) => events.push(event)

    expect(shared.resolvePhase('parent', 'Scan', emit)).toBe(1)
    expect(shared.resolvePhase('child', 'Scan', emit)).toBe(2)
    expect(shared.resolvePhase('parent', 'Scan', emit)).toBe(1)
    expect(events.filter(event => event.type === 'workflow_phase')).toHaveLength(2)
  })

  test('shares agent counters and failures across nested workflows', () => {
    const shared = createWorkflowSharedCounters()
    expect(shared.nextAgentIndex()).toBe(1)
    expect(shared.nextAgentIndex()).toBe(2)
    shared.recordFailure('failed')
    expect(shared.getFailures()).toEqual(['failed'])
  })
})
