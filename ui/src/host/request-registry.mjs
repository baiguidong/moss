import { EventEmitter } from 'node:events';
import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();
export const runWithHostRequestContext = (context, operation) => requestContext.run(context, operation);
export const getHostRequestContext = () => requestContext.getStore();

export function createRequestRegistry(electronIpc) {
  const handlers = new Map();
  const events = new EventEmitter();
  events.setMaxListeners(100);
  return {
    handle(method, handler) {
      const invoke = (context, ...args) => requestContext.run(context, () => handler(context, ...args));
      handlers.set(method, invoke);
      electronIpc?.handle(method, invoke);
    },
    removeHandler(method) {
      handlers.delete(method);
      electronIpc?.removeHandler(method);
    },
    on: (...args) => electronIpc?.on(...args),
    has: method => handlers.has(method),
    async invoke(method, context, ...args) {
      const handler = handlers.get(method);
      if (!handler) throw new Error(`Unknown Host method: ${method}`);
      // A Web caller has an authenticated context, never a fabricated sender.
      return handler(context, ...args);
    },
    publish(method, payload) { events.emit('event', method, payload); },
    subscribe(listener) {
      events.on('event', listener);
      return () => events.off('event', listener);
    },
  };
}
