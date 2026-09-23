import { contextBridge, ipcRenderer } from 'electron'

function on(channel, callback) {
  const handler = (_event, payload) => callback(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

contextBridge.exposeInMainWorld('mossApp', {
  app: {
    getInfo: () => ipcRenderer.invoke('app-ui:get-info'),
    getVersions: () => ipcRenderer.invoke('app-ui:list-versions'),
    getInstallationState: (options) => ipcRenderer.invoke('app-ui:get-installation-state', options),
  },
  instances: {
    list: (options) => ipcRenderer.invoke('app-ui:instances:list', options),
    create: (input, options) => ipcRenderer.invoke('app-ui:instances:create', { ...input, ...options }),
    update: (instanceId, patch, options) => ipcRenderer.invoke('app-ui:instances:update', { instanceId, ...patch, ...options }),
    setEnabled: (instanceId, enabled, options) => ipcRenderer.invoke('app-ui:instances:set-enabled', { instanceId, enabled, ...options }),
    clearCredentials: (instanceId, options) => ipcRenderer.invoke('app-ui:instances:clear-credentials', { instanceId, ...options }),
    remove: (instanceId, options) => ipcRenderer.invoke('app-ui:instances:remove', { instanceId, ...options }),
    getStatus: (instanceId, options) => ipcRenderer.invoke('app-ui:instances:get-status', { instanceId, ...options }),
  },
  actions: {
    invoke: (instanceId, name, input, options) => ipcRenderer.invoke('app-ui:actions:invoke', { instanceId, name, input, ...options }),
    cancel: (instanceId, requestId, options) => ipcRenderer.invoke('app-ui:actions:cancel', { instanceId, requestId, ...options }),
  },
  storage: {
    getItem: (key) => ipcRenderer.invoke('app-ui:storage:get', { key }),
    setItem: (key, value) => ipcRenderer.invoke('app-ui:storage:set', { key, value }),
    removeItem: (key) => ipcRenderer.invoke('app-ui:storage:remove', { key }),
    list: () => ipcRenderer.invoke('app-ui:storage:list'),
  },
  host: {
    request: (instanceId, protocol, method, input, options) => ipcRenderer.invoke('app-ui:host:request', {
      instanceId,
      protocol,
      method,
      input,
      ...options,
    }),
  },
  events: { on: (eventName, callback) => on(`app-ui:event:${String(eventName || '')}`, callback) },
})

contextBridge.exposeInMainWorld('appVersionInfo', { version: '2.1.0', name: 'Moss App Runtime' })
