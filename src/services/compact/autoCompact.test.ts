import { describe, expect, test } from 'bun:test'
import type { AutoCompactTrackingState } from './autoCompact.js'
import {
  MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES,
  isCompactionEffective,
  nextConsecutiveFailures,
} from './autoCompact.js'
import type { CompactionResult, RecompactionInfo } from './compact.js'

const THRESHOLD = 100_000

function result(truePostCompactTokenCount?: number): CompactionResult {
  // isCompactionEffective only reads truePostCompactTokenCount; the rest of the
  // shape is irrelevant to the decision under test.
  return { truePostCompactTokenCount } as unknown as CompactionResult
}

function info(
  overrides: Partial<RecompactionInfo> = {},
): RecompactionInfo {
  return {
    isRecompactionInChain: false,
    turnsSincePreviousCompact: -1,
    autoCompactThreshold: THRESHOLD,
    ...overrides,
  }
}

describe('isCompactionEffective', () => {
  test('effective when resulting payload is safely under threshold', () => {
    expect(isCompactionEffective(result(30_000), info())).toBe(true)
  })

  test('ineffective when payload alone meets/exceeds threshold (small window)', () => {
    // e.g. a small context window whose threshold is dwarfed by the ~50K
    // post-compact attachment budget.
    expect(isCompactionEffective(result(THRESHOLD), info())).toBe(false)
    expect(isCompactionEffective(result(THRESHOLD + 1), info())).toBe(false)
  })

  test('ineffective when re-compacting immediately after a prior compaction', () => {
    // Payload estimate is under threshold, but we are compacting again one turn
    // later — empirical proof the previous compaction did not fit (heavy fixed
    // system/tool overhead the payload estimate cannot see).
    expect(
      isCompactionEffective(
        result(30_000),
        info({ isRecompactionInChain: true, turnsSincePreviousCompact: 1 }),
      ),
    ).toBe(false)
    expect(
      isCompactionEffective(
        result(30_000),
        info({ isRecompactionInChain: true, turnsSincePreviousCompact: 0 }),
      ),
    ).toBe(false)
  })

  test('effective when a chained compaction happens many turns later', () => {
    // A natural later compaction after healthy usage is not a loop.
    expect(
      isCompactionEffective(
        result(30_000),
        info({ isRecompactionInChain: true, turnsSincePreviousCompact: 20 }),
      ),
    ).toBe(true)
  })

  test('effective when payload size is unknown and not an immediate re-compaction', () => {
    expect(isCompactionEffective(result(undefined), info())).toBe(true)
  })
})

describe('nextConsecutiveFailures', () => {
  const tracking = (
    consecutiveFailures?: number,
  ): AutoCompactTrackingState | undefined =>
    consecutiveFailures === undefined
      ? undefined
      : { compacted: true, turnCounter: 0, turnId: 't', consecutiveFailures }

  test('resets to 0 on an effective compaction regardless of prior count', () => {
    expect(nextConsecutiveFailures(result(30_000), info(), tracking(2))).toBe(0)
  })

  test('increments prior count on an ineffective compaction', () => {
    expect(nextConsecutiveFailures(result(THRESHOLD), info(), tracking(1))).toBe(
      2,
    )
  })

  test('treats a missing prior count as 0', () => {
    expect(
      nextConsecutiveFailures(result(THRESHOLD), info(), tracking(undefined)),
    ).toBe(1)
  })

  test('climbs to the breaker limit over repeated ineffective compactions', () => {
    // Simulates the query loop threading the count forward each turn. After
    // MAX consecutive ineffective compactions the caller trips the circuit
    // breaker and stops re-compacting.
    let count: number | undefined
    for (let i = 0; i < MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES; i++) {
      count = nextConsecutiveFailures(result(THRESHOLD), info(), tracking(count))
    }
    expect(count).toBe(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES)
  })
})
