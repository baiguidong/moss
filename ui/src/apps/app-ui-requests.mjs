import { randomUUID } from 'node:crypto'
import { defaultInstanceId } from '../../../packages/app-runtime/src/state/index.mjs'
import { APP_ERROR_CODES, AppServiceError, serializeError } from '../../../packages/app-sdk/src/protocol/index.mjs'

/** Each renderer owns its request ids; trusted Main binds the App and default instance. */
export function registerAppUiRequests({ ipc, cancelIpc = ipc, getState, invocation = () => undefined, beginRequest = () => () => {} }) {
  const senders = new Map()
  const watched = new WeakSet()
  const dispose = id => {
    const group = senders.get(id)
    if (!group) return
    for (const entry of group.values()) entry.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Window closed'))
    senders.delete(id)
  }
  const groupFor = sender => {
    if (!senders.has(sender.id)) {
      senders.set(sender.id, new Map())
    }
    if (!watched.has(sender)) {
      watched.add(sender)
      sender.once('destroyed', () => dispose(sender.id))
      sender.on('render-process-gone', () => dispose(sender.id))
      sender.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) dispose(sender.id)
      })
    }
    return senders.get(sender.id)
  }
  for (const kind of ['actions', 'host']) {
    const method = kind === 'actions' ? 'invoke' : 'request'
    ipc.handle(`app-ui:${kind}:${method}`, async (event, input = {}) => {
      let cleanup = () => {}
      let endRequest = () => {}
      try {
        endRequest = beginRequest()
        const state = getState(event.sender)
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'instanceId')) {
          throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Expected a bound App request')
        }
        const { requestId, timeoutMs } = input
        if (typeof requestId !== 'string' || !requestId || requestId.length > 128) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid request id')
        const group = groupFor(event.sender), key = `${kind}:${requestId}`
        if (group.has(key)) throw new AppServiceError(APP_ERROR_CODES.conflict, 'Duplicate request id')
        if (group.size >= 64) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Too many UI requests')
        const controller = new AbortController()
        group.set(key, controller)
        cleanup = () => { group.delete(key) }
        const options = { requestId: randomUUID(), timeoutMs, signal: controller.signal, sourceId: event.sender.id, invocation: invocation(state) }
        const instanceId = defaultInstanceId(state.id)
        const result = kind === 'actions'
          ? await state.runtime.invoke(state.id, instanceId, input.name, input.input, { ...options, invocation: invocation(state) })
          : await state.runtime.requestHostCapability(state.id, instanceId, input.protocol, input.method, input.input ?? {}, options)
        return { ok: true, result }
      } catch (error) { return { ok: false, error: serializeError(error, kind === 'host' ? APP_ERROR_CODES.hostUnavailable : APP_ERROR_CODES.backendUnavailable) } }
      finally { cleanup(); endRequest() }
    })
    cancelIpc.handle(`app-ui:${kind}:cancel`, (event, { requestId } = {}) => {
      getState(event.sender)
      const entry = senders.get(event.sender.id)?.get(`${kind}:${requestId}`)
      entry?.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Request cancelled'))
      return { cancelled: Boolean(entry) }
    })
  }
  ipc.handle('app-ui:host:subscribe', async (event, input = {}) => {
    let close = () => {}
    try {
      const state = getState(event.sender), { subscriptionId, protocol, name } = input
      if (typeof subscriptionId !== 'string' || !subscriptionId || subscriptionId.length > 128) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid subscription id')
      const group = groupFor(event.sender), key = `subscription:${subscriptionId}`
      if (group.has(key)) throw new AppServiceError(APP_ERROR_CODES.conflict, 'Duplicate subscription')
      if (group.size >= 64) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Too many subscriptions')
      const controller = new AbortController()
      let unsubscribe = () => {}
      close = () => { controller.abort(); unsubscribe(); group.delete(key) }
      controller.signal.addEventListener('abort', () => { unsubscribe(); group.delete(key) }, { once: true })
      group.set(key, controller)
      unsubscribe = await state.runtime.subscribeHostEvent(state.id, defaultInstanceId(state.id), protocol, name,
        (data, context) => { if (!controller.signal.aborted) event.sender.send('app-ui:host:event', { subscriptionId, data, context }) },
        { signal: controller.signal, onClosed: error => {
          if (!event.sender.isDestroyed?.()) event.sender.send('app-ui:host:event', { subscriptionId, closed: true, error: serializeError(error, APP_ERROR_CODES.actionCanceled) })
          close()
        } })
      if (controller.signal.aborted) { unsubscribe(); throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Subscription cancelled') }
      return { ok: true, result: { subscriptionId } }
    } catch (error) { close(); return { ok: false, error: serializeError(error, APP_ERROR_CODES.hostUnavailable) } }
  })
  cancelIpc.handle('app-ui:host:unsubscribe', (event, { subscriptionId } = {}) => {
    getState(event.sender)
    senders.get(event.sender.id)?.get(`subscription:${subscriptionId}`)?.abort()
    return { ok: true }
  })
  return { dispose }
}
