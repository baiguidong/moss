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
    getInstallationState: () => ipcRenderer.invoke('app-ui:get-installation-state'),
  },
  instances: {
    list: () => ipcRenderer.invoke('app-ui:instances:list'),
    create: (input) => ipcRenderer.invoke('app-ui:instances:create', input),
    update: (instanceId, patch) => ipcRenderer.invoke('app-ui:instances:update', { instanceId, ...patch }),
    setEnabled: (instanceId, enabled) => ipcRenderer.invoke('app-ui:instances:set-enabled', { instanceId, enabled }),
    clearCredentials: (instanceId) => ipcRenderer.invoke('app-ui:instances:clear-credentials', { instanceId }),
    remove: (instanceId, options) => ipcRenderer.invoke('app-ui:instances:remove', { instanceId, ...options }),
    getStatus: (instanceId) => ipcRenderer.invoke('app-ui:instances:get-status', { instanceId }),
  },
  actions: {
    invoke: (instanceId, name, input, options) => ipcRenderer.invoke('app-ui:actions:invoke', { instanceId, name, input, ...options }),
    cancel: (instanceId, requestId) => ipcRenderer.invoke('app-ui:actions:cancel', { instanceId, requestId }),
  },
  storage: {
    getItem: (key) => ipcRenderer.invoke('app-ui:storage:get', { key }),
    setItem: (key, value) => ipcRenderer.invoke('app-ui:storage:set', { key, value }),
    removeItem: (key) => ipcRenderer.invoke('app-ui:storage:remove', { key }),
    list: () => ipcRenderer.invoke('app-ui:storage:list'),
  },
  events: { on: (eventName, callback) => on(`app-ui:event:${String(eventName || '')}`, callback) },
})

contextBridge.exposeInMainWorld('appVersionInfo', { version: '2.0.0', name: 'Moss App Runtime' })
