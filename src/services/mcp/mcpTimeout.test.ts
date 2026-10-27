import { expect, test } from 'bun:test'
import {
  nextMcpTimeout,
  waitForMcpElicitation,
} from './mcpTimeout.js'

const policy = {
  firstByteTimeoutMs: 10_000,
  idleProgressTimeoutMs: 30_000,
  maxTotalTimeoutMs: 120_000,
}

test('progress timeout resets idle deadline but never moves total deadline', () => {
  const state = { startedAt: 0, firstByteAt: 5_000, lastProgressAt: 50_000 }
  expect(nextMcpTimeout(policy, state, 50_000)).toEqual({
    at: 80_000,
    reason: 'idle_progress',
  })
  expect(nextMcpTimeout(policy, { ...state, lastProgressAt: 110_000 }, 110_000)).toEqual({
    at: 120_000,
    reason: 'idle_progress',
  })
  expect(nextMcpTimeout(policy, { ...state, lastProgressAt: 110_000 }, 120_000).reason).toBe('total')
})

test('first-byte deadline is used before any progress arrives', () => {
  expect(nextMcpTimeout(policy, { startedAt: 2_000 }, 2_000)).toEqual({
    at: 12_000,
    reason: 'first_byte',
  })
})

test('elicitation timeout is distinguishable from an accepted response', async () => {
  const controller = new AbortController()
  const timeout = await waitForMcpElicitation({
    promise: new Promise(resolve => setTimeout(() => resolve('late'), 30)),
    signal: controller.signal,
    timeoutMs: 5,
  })
  expect(timeout).toEqual({ kind: 'timeout' })

  const accepted = await waitForMcpElicitation({
    promise: Promise.resolve('accept'),
    signal: controller.signal,
    timeoutMs: 100,
  })
  expect(accepted).toEqual({ kind: 'resolved', value: 'accept' })
})

