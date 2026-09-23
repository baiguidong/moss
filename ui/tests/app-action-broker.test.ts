import { describe, expect, it } from 'bun:test'
import { AppActionBroker } from '../../packages/app-runtime/src/actions/index.mjs'

describe('App Action Broker', () => {
  it('propagates a caller AbortSignal into an active Backend action', async () => {
    let backendSignal: AbortSignal | null = null
    const supervisor = {
      invoke: (_key: string, _action: string, _input: unknown, options: { signal: AbortSignal }) => {
        backendSignal = options.signal
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
        })
      },
      cancel: () => false,
    }
    const broker = new AppActionBroker({
      supervisor,
      authorize: () => {},
      packageResolver: async () => ({
        root: process.cwd(),
        manifest: { id: 'example.app', version: '1.0.0', backend: { actions: [{ name: 'wait' }] } },
      }),
    })
    const controller = new AbortController()
    const invocation = broker.invoke(
      { key: 'runtimeRecord-1', appId: 'example.app' },
      'wait',
      {},
      { requestId: 'request-1', signal: controller.signal },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()

    await expect(invocation).rejects.toMatchObject({ code: 'APP_ACTION_CANCELED' })
    expect(backendSignal?.aborted).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(broker.pendingTotal).toBe(0)
    expect(broker.requests.size).toBe(0)
  })

  it('rejects an already-aborted action before reserving queue capacity', async () => {
    const broker = new AppActionBroker({
      supervisor: { invoke: () => Promise.resolve(null), cancel: () => false },
      authorize: () => {},
      packageResolver: async () => ({ manifest: { backend: { actions: [{ name: 'wait' }] } } }),
    })
    const controller = new AbortController()
    controller.abort()

    await expect(broker.invoke(
      { key: 'runtimeRecord-1', appId: 'example.app' },
      'wait',
      {},
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: 'APP_ACTION_CANCELED' })
    expect(broker.pendingTotal).toBe(0)
  })
})
