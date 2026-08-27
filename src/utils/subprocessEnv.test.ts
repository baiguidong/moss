import { describe, expect, it } from 'bun:test'
import { asSessionId } from '../types/ids.js'
import {
  runWithSessionContextOverridesGenerator,
  runWithSessionIdContext,
} from './sessionIdContext.js'
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

  it('replaces root connector credentials with the worker assignment', async () => {
    const rootKey = 'MOSS_TEST_ROOT_CONNECTOR_SECRET'
    const workerKey = 'MOSS_TEST_WORKER_CONNECTOR_SECRET'
    const values = await runWithSessionIdContext(
      asSessionId('worker-env-test'),
      null,
      async () => {
        const observed: Array<[string | undefined, string | undefined]> = []
        const stream = runWithSessionContextOverridesGenerator(
          { environment: { [workerKey]: 'worker-secret' } },
          async function* () {
            observed.push([subprocessEnv()[rootKey], subprocessEnv()[workerKey]])
            await Promise.resolve()
            observed.push([subprocessEnv()[rootKey], subprocessEnv()[workerKey]])
            yield undefined
          },
        )
        for await (const _ of stream) {}
        return observed
      },
      undefined,
      { [rootKey]: 'root-secret' },
    )

    expect(values).toEqual([
      [undefined, 'worker-secret'],
      [undefined, 'worker-secret'],
    ])
  })
})
