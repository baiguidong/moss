function cancelled(signal) {
  const error = new Error(signal?.reason?.message || 'App request cancelled')
  error.code = 'APP_ACTION_CANCELED'
  return error
}

/** Browser-safe client. Identity is bound by Main, never supplied by the App. */
export function createAppClient(bridge) {
  const pending = new Set()
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
    events: bridge.events, composer: bridge.composer,
    actions: {
      invoke: (name, input, options) => call(bridge.actions, 'invoke', [name, input], options),
    },
    host: {
      request: (protocol, method, input = {}, options) => call(bridge.host, 'request', [protocol, method, input], options),
    },
    dispose() { closed = true; for (const controller of pending) controller.abort(); pending.clear() },
  }
}
