import { abortError } from '../errors.mjs'
const cancelled = signal => abortError(signal)

/** Browser-safe client. Identity is bound by Main, never supplied by the App. */
export function createAppClient(bridge) {
  const pending = new Set()
  const subscriptions = new Set()
  let closed = false
  async function call(api, method, args, options = {}) {
    if (closed || options.signal?.aborted) throw cancelled(options.signal)
    const controller = new AbortController()
    const requestId = options.requestId ?? globalThis.crypto.randomUUID()
    const abort = () => controller.abort(options.signal?.reason)
    const cancel = () => { void api.cancel(requestId).catch(() => {}) }
    options.signal?.addEventListener('abort', abort, { once: true })
    controller.signal.addEventListener('abort', cancel, { once: true })
    pending.add(controller)
    try {
      const result = await api[method](...args, { requestId, timeoutMs: options.timeoutMs })
      if (controller.signal.aborted) throw cancelled(controller.signal)
      if (!result || typeof result.ok !== 'boolean') throw new Error('Invalid App response')
      if (!result.ok) {
        const error = new Error(result.error.message)
        error.code = result.error.code
        error.details = result.error.details
        throw error
      }
      return result.result
    } catch (error) {
      if (controller.signal.aborted) throw cancelled(controller.signal)
      throw error
    } finally {
      options.signal?.removeEventListener('abort', abort)
      controller.signal.removeEventListener('abort', cancel)
      pending.delete(controller)
    }
  }
  return {
    app: bridge.app, instances: bridge.instances, storage: bridge.storage,
    events: { on(name, listener) {
      if (closed) throw cancelled()
      const off = bridge.events.on(name, listener)
      const dispose = () => { off(); subscriptions.delete(dispose) }
      subscriptions.add(dispose)
      return dispose
    } }, composer: bridge.composer,
    actions: {
      invoke: (name, input, options) => call(bridge.actions, 'invoke', [name, input], options),
    },
    host: {
      async subscribe(protocol, name, listener, options = {}) {
        if (closed || options.signal?.aborted) throw cancelled(options.signal)
        const subscriptionId = globalThis.crypto.randomUUID()
        let stopped = false
        const report = error => { try { Promise.resolve(options.onError?.(error)).catch(() => {}) } catch {} }
        const off = bridge.host.onEvent(event => {
          if (stopped || event.subscriptionId !== subscriptionId) return
          if (event.closed) { dispose(); report(Object.assign(new Error(event.error?.message || 'Host subscription closed'), { code: event.error?.code || 'APP_ACTION_CANCELED' })); return }
          Promise.resolve().then(() => { if (!stopped) return listener(event.data, event.context) }).catch(report)
        })
        const dispose = () => {
          if (stopped) return
          stopped = true; off(); subscriptions.delete(dispose)
          options.signal?.removeEventListener('abort', dispose)
          void bridge.host.unsubscribe(subscriptionId).catch(() => {})
        }
        subscriptions.add(dispose)
        options.signal?.addEventListener('abort', dispose, { once: true })
        try {
          const result = await bridge.host.subscribe(protocol, name, subscriptionId)
          if (!result.ok) throw Object.assign(new Error(result.error.message), result.error)
          if (stopped) throw cancelled(options.signal)
          return dispose
        } catch (error) { dispose(); throw error }
      },
      request: (protocol, method, input = {}, options) => call(bridge.host, 'request', [protocol, method, input], options),
    },
    dispose() { closed = true; for (const controller of pending) controller.abort(); pending.clear(); for (const off of subscriptions) off(); subscriptions.clear() },
  }
}
