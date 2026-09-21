import { describe, expect, it } from 'bun:test'
import type * as undici from 'undici'
import { makeUndiciDispatcherFetchCompatible } from '../mtls.js'

describe('Undici dispatcher compatibility', () => {
  it('wraps a current dispatcher for runtimes using the legacy fetch handler contract', () => {
    const inner = { dispatch() { return true } } as unknown as undici.Dispatcher
    class FakeDispatcher1Wrapper {
      constructor(readonly dispatcher: undici.Dispatcher) {}
    }
    const undiciModule = {
      Dispatcher1Wrapper: FakeDispatcher1Wrapper,
    } as unknown as typeof undici

    const compatible = makeUndiciDispatcherFetchCompatible(undiciModule, inner)

    expect(compatible).toBeInstanceOf(FakeDispatcher1Wrapper)
    expect((compatible as unknown as FakeDispatcher1Wrapper).dispatcher).toBe(inner)
  })

  it('keeps the dispatcher when the runtime does not expose the compatibility wrapper', () => {
    const inner = { dispatch() { return true } } as unknown as undici.Dispatcher
    const compatible = makeUndiciDispatcherFetchCompatible(
      {} as typeof undici,
      inner,
    )

    expect(compatible).toBe(inner)
  })
})
