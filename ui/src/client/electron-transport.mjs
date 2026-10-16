// The shared client receives data only; Electron sender objects stay in preload.
export function createElectronTransport(ipcRenderer) {
  const listeners = new Map();
  return {
    invoke: (method, ...args) => ipcRenderer.invoke(method, ...args),
    send: (method, payload) => ipcRenderer.send(method, payload),
    on(method, callback) {
      let entries = listeners.get(callback);
      if (!entries) listeners.set(callback, entries = new Map());
      const listener = (_event, ...args) => callback(...args);
      entries.set(method, listener);
      ipcRenderer.on(method, listener);
    },
    off(method, callback) {
      const entries = listeners.get(callback);
      const listener = entries?.get(method);
      if (listener) ipcRenderer.removeListener(method, listener);
      entries?.delete(method);
      if (!entries?.size) listeners.delete(callback);
    },
  };
}
