import { MOSS_PROTOCOL_VERSION } from './methods.mjs';
import { stringifyWire, parseWire } from './wire.mjs';

export function createWebTransport({ url, WebSocketImpl = WebSocket, onStatus = () => {}, onSnapshot = () => {} }) {
  const listeners = new Map();
  const pending = new Map();
  let socket; let timer; let stopped = false; let ready = false;
  let epoch; let sequence = 0; let backoff = 500;
  const emit = (method, ...args) => { for (const fn of listeners.get(method) || []) fn(...args); };
  function connect() {
    if (stopped) return;
    onStatus('connecting');
    socket = new WebSocketImpl(url);
    socket.addEventListener('open', () => socket.send(stringifyWire({ type: 'hello', version: MOSS_PROTOCOL_VERSION, epoch, sequence })));
    socket.addEventListener('message', event => {
      const message = parseWire(String(event.data));
      if (message.type === 'hello') {
        if (!message.replay) sequence = message.sequence;
        epoch = message.epoch;
      } else if (message.type === 'event') {
        if (message.epoch !== epoch || message.sequence <= sequence) return;
        sequence = message.sequence;
        emit(message.method, message.payload);
      } else if (message.type === 'ready') {
        ready = true; backoff = 500;
        onSnapshot(message.snapshot);
        onStatus('connected');
        for (const entry of pending.values()) socket.send(stringifyWire(entry.request));
      } else if (message.type === 'result') {
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        if (message.ok) entry.resolve(message.value);
        else entry.reject(new Error(message.error));
      }
    });
    socket.addEventListener('error', () => {});
    socket.addEventListener('close', event => {
      ready = false;
      if ([4401, 4406].includes(event.code)) {
        stopped = true;
        onStatus(event.code === 4401 ? 'unauthenticated' : 'incompatible');
        for (const entry of pending.values()) entry.reject(new Error('连接需要重新登录或刷新，已接受的任务仍由 Host 管理。'));
        pending.clear();
      }
      if (!stopped) { onStatus('disconnected'); timer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 10_000); }
    });
  }
  connect();
  return {
    invoke(method, ...args) {
      if (stopped) return Promise.reject(new Error('连接已关闭，请刷新页面。'));
      const request = { type: 'request', id: crypto.randomUUID(), createdAt: Date.now(), method, args };
      return new Promise((resolve, reject) => {
        pending.set(request.id, { request, resolve, reject });
        if (ready) socket.send(stringifyWire(request));
      });
    },
    send() {}, // Electron browser-view layout has no server-side window in Web mode.
    on(method, fn) { if (!listeners.has(method)) listeners.set(method, new Set()); listeners.get(method).add(fn); },
    off(method, fn) { listeners.get(method)?.delete(fn); },
    close() {
      stopped = true; clearTimeout(timer); socket?.close();
      for (const entry of pending.values()) entry.reject(new Error('连接已关闭。'));
      pending.clear(); listeners.clear();
    },
  };
}
