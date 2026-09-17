import { describe, expect, test } from 'bun:test'
import { asSessionId } from '../types/ids.js'
import {
  emitModelUsageEvent,
  registerModelUsageEventListener,
  type ModelUsageEvent,
} from './modelUsageEvents.js'
import { runWithSessionIdContext } from './sessionIdContext.js'

const EVENT: ModelUsageEvent = {
  eventId: 'request-1',
  occurredAt: 1,
  model: 'model-a',
  querySource: 'sdk',
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

describe('model usage events', () => {
  test('routes an event to the current runtime and task session without duplicates', () => {
    const events: ModelUsageEvent[] = []
    const listener = (event: ModelUsageEvent) => events.push(event)
    const unregisterRuntime = registerModelUsageEventListener('runtime-session', listener)
    const unregisterTask = registerModelUsageEventListener('desktop-session', listener)

    try {
      runWithSessionIdContext(
        asSessionId('runtime-session'),
        null,
        () => emitModelUsageEvent(EVENT),
        { kind: 'session', sessionId: 'desktop-session' },
      )
      expect(events).toEqual([EVENT])
    } finally {
      unregisterRuntime()
      unregisterTask()
    }
  })

  test('does not emit after the listener is removed', () => {
    const events: ModelUsageEvent[] = []
    const unregister = registerModelUsageEventListener(
      'runtime-session',
      event => events.push(event),
    )
    unregister()
    runWithSessionIdContext(asSessionId('runtime-session'), null, () => {
      emitModelUsageEvent(EVENT)
    })
    expect(events).toEqual([])
  })
})
