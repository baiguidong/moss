import { randomUUID } from 'node:crypto'
import { defaultInstanceId } from '../../../packages/app-runtime/src/state/index.mjs'
import { APP_ERROR_CODES, AppServiceError, serializeError } from '../../../packages/app-sdk/src/protocol/index.mjs'

function createSubscriptionLifetime(controller, remove) {
  let unsubscribe
  const cleanup = () => {
    const off = unsubscribe
    unsubscribe = undefined
    try { off?.() } finally { remove() }
  }
  controller.signal.addEventListener('abort', cleanup, { once: true })
  return {
    attach(off) { unsubscribe = off; if (controller.signal.aborted) cleanup() },
    close() { controller.abort(); cleanup() },
  }
}

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
    let endRequest = () => {}
    try {
      endRequest = beginRequest()
      const state = getState(event.sender), { subscriptionId, protocol, name } = input
      if (typeof subscriptionId !== 'string' || !subscriptionId || subscriptionId.length > 128) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid subscription id')
      const group = groupFor(event.sender), key = `subscription:${subscriptionId}`
      if (group.has(key)) throw new AppServiceError(APP_ERROR_CODES.conflict, 'Duplicate subscription')
      if (group.size >= 64) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Too many subscriptions')
      const controller = new AbortController()
      const subscription = createSubscriptionLifetime(controller, () => {
        if (group.get(key) === controller) group.delete(key)
      })
      close = subscription.close
      group.set(key, controller)
      subscription.attach(await state.runtime.subscribeHostEvent(state.id, defaultInstanceId(state.id), protocol, name,
        (data, context) => { if (!controller.signal.aborted) event.sender.send('app-ui:host:event', { subscriptionId, data, context }) },
        { signal: controller.signal, onClosed: error => {
          if (controller.signal.aborted) return
          close()
          if (!event.sender.isDestroyed?.()) event.sender.send('app-ui:host:event', { subscriptionId, closed: true, error: serializeError(error, APP_ERROR_CODES.actionCanceled) })
        } }))
      if (controller.signal.aborted) throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Subscription cancelled')
      return { ok: true, result: { subscriptionId } }
    } catch (error) { close(); return { ok: false, error: serializeError(error, APP_ERROR_CODES.hostUnavailable) } }
    finally { endRequest() }
  })
  cancelIpc.handle('app-ui:host:unsubscribe', (event, { subscriptionId } = {}) => {
    getState(event.sender)
    senders.get(event.sender.id)?.get(`subscription:${subscriptionId}`)?.abort()
    return { ok: true }
  })
  return { dispose }
}

// Transport-neutral page lifetime. Web supplies a Host-owned App binding, never
// a fabricated Electron sender or an App-provided identity.
export function createAppUiRequestScope({ getState, sourceId, send, invocation = () => ({ surface: 'app', origin: 'ui' }) }) {
  const requests = new Map();
  let closed = false;
  const cancel = key => requests.get(key)?.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Page closed or request cancelled'));
  return {
    close() { closed = true; for (const key of requests.keys()) cancel(key); requests.clear(); },
    async request(method, input = {}) {
      try {
        if (closed) throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Page closed');
        const state = getState();
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.hasOwn(input, 'instanceId')) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Expected a bound App request');
        const subscription = method === 'app-ui:host:subscribe' || method === 'app-ui:host:unsubscribe';
        const id = subscription ? input.subscriptionId : input.requestId;
        if (typeof id !== 'string' || !id || id.length > 128) throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid request id');
        const kind = subscription ? 'subscription' : method.includes(':actions:') ? 'actions' : 'host';
        const key = `${kind}:${id}`;
        if (method.endsWith(':cancel') || method.endsWith(':unsubscribe')) { cancel(key); return { ok: true, cancelled: requests.has(key) }; }
        if (requests.has(key) || requests.size >= 64) throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Too many or duplicate requests');
        const controller = new AbortController(); requests.set(key, controller);
        const options = { requestId: randomUUID(), timeoutMs: input.timeoutMs, signal: controller.signal, sourceId, invocation: invocation(state) };
        let subscribed = false, lifetime;
        try {
          const instanceId = defaultInstanceId(state.id);
          let result;
          if (method === 'app-ui:actions:invoke') result = await state.runtime.invoke(state.id, instanceId, input.name, input.input, options);
          else if (method === 'app-ui:host:request') result = await state.runtime.requestHostCapability(state.id, instanceId, input.protocol, input.method, input.input ?? {}, options);
          else if (method === 'app-ui:host:subscribe') {
            lifetime = createSubscriptionLifetime(controller, () => {
              if (requests.get(key) === controller) requests.delete(key);
            });
            lifetime.attach(await state.runtime.subscribeHostEvent(state.id, instanceId, input.protocol, input.name,
              (data, context) => { if (!controller.signal.aborted) send('app-ui:host:event', { subscriptionId: id, data, context }); },
              { ...options, onClosed: error => {
                if (controller.signal.aborted) return;
                lifetime.close();
                send('app-ui:host:event', { subscriptionId: id, closed: true, error: serializeError(error, APP_ERROR_CODES.actionCanceled) });
              } }));
            if (controller.signal.aborted) throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Subscription cancelled');
            subscribed = true; result = { subscriptionId: id };
          } else throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Unsupported App request');
          if (controller.signal.aborted) throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'Request cancelled');
          return { ok: true, result };
        } finally {
          if (!subscribed) lifetime?.close();
          if ((!subscribed || controller.signal.aborted) && requests.get(key) === controller) requests.delete(key);
        }
      } catch (error) { return { ok: false, error: serializeError(error, APP_ERROR_CODES.hostUnavailable) }; }
    },
  };
}
