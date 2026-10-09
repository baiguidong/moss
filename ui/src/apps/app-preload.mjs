import { contextBridge, ipcRenderer } from 'electron'

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const request = (channel, payload) => ipcRenderer.invoke(channel, payload)

contextBridge.exposeInMainWorld('mossApp', {
  app: {
    getInfo: () => ipcRenderer.invoke('app-ui:get-info'),
    getStatus: () => ipcRenderer.invoke('app-ui:get-status'),
    getVersions: () => ipcRenderer.invoke('app-ui:list-versions'),
    getInstallationState: () => ipcRenderer.invoke('app-ui:get-installation-state'),
  },
  composer: {
    prepare: (input) => ipcRenderer.invoke('app-ui:composer:prepare', input),
  },
  instances: {
    list: () => ipcRenderer.invoke('app-ui:instances:list'),
    update: (instanceId, patch) => ipcRenderer.invoke('app-ui:instances:update', { instanceId, ...patch }),
    setEnabled: (instanceId, enabled) => ipcRenderer.invoke('app-ui:instances:set-enabled', { instanceId, enabled }),
    clearCredentials: (instanceId) => ipcRenderer.invoke('app-ui:instances:clear-credentials', { instanceId }),
    getStatus: (instanceId) => ipcRenderer.invoke('app-ui:instances:get-status', { instanceId }),
  },
  actions: {
    invoke: (name, input, options = {}) => request('app-ui:actions:invoke', { name, input, requestId: options.requestId ?? globalThis.crypto.randomUUID(), timeoutMs: options.timeoutMs }),
    cancel: (requestId) => ipcRenderer.invoke('app-ui:actions:cancel', { requestId }),
  },
  storage: {
    getItem: (key) => ipcRenderer.invoke('app-ui:storage:get', { key }),
    setItem: (key, value) => ipcRenderer.invoke('app-ui:storage:set', { key, value }),
    removeItem: (key) => ipcRenderer.invoke('app-ui:storage:remove', { key }),
    list: () => ipcRenderer.invoke('app-ui:storage:list'),
  },
  host: {
    request: (protocol, method, input, options = {}) => request('app-ui:host:request', {
      protocol, method, input, requestId: options.requestId ?? globalThis.crypto.randomUUID(), timeoutMs: options.timeoutMs,
    }),
    cancel: (requestId) => ipcRenderer.invoke('app-ui:host:cancel', { requestId }),
  },
  events: { on: (eventName, callback) => on(`app-ui:event:${String(eventName || '')}`, callback) },
})

contextBridge.exposeInMainWorld('appVersionInfo', { version: '3.0.0', name: 'Moss App Runtime' })
