import { EventEmitter } from 'node:events';

export function createRequestRegistry(electronIpc) {
  const handlers = new Map();
  const events = new EventEmitter();
  events.setMaxListeners(100);
  return {
    handle(method, handler) {
      handlers.set(method, handler);
      electronIpc?.handle(method, handler);
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
