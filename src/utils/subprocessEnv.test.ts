import { describe, expect, it } from 'bun:test'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from './sessionIdContext.js'
import { subprocessEnv } from './subprocessEnv.js'

describe('session subprocess environment', () => {
  it('adds connector credentials only inside the active session context', () => {
    const key = 'MOSS_TEST_CONNECTOR_SECRET'
    expect(subprocessEnv()[key]).toBeUndefined()

    const value = runWithSessionIdContext(
      asSessionId('connector-env-test'),
      null,
      () => subprocessEnv()[key],
      undefined,
      { [key]: 'session-secret' },
    )

    expect(value).toBe('session-secret')
    expect(subprocessEnv()[key]).toBeUndefined()
  })
})
