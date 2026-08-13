import { contextBridge, ipcRenderer } from 'electron';

const mossApp = {
  app: {
    getInfo: () => ipcRenderer.invoke('plugin-app:get-info'),
    getVersions: () => ipcRenderer.invoke('plugin-app:list-versions'),
  },
  extensions: {
    getStatus: () => ipcRenderer.invoke('plugin-app:extensions:get-status'),
  },
  fs: {
    readText: (path) => ipcRenderer.invoke('fs:readText', { path }),
  },
  storage: {
    getItem: (key) => ipcRenderer.invoke('plugin-app:storage:get', { key }),
    setItem: (key, value) => ipcRenderer.invoke('plugin-app:storage:set', { key, value }),
    removeItem: (key) => ipcRenderer.invoke('plugin-app:storage:remove', { key }),
    list: () => ipcRenderer.invoke('plugin-app:storage:list'),
  },
  commands: {
    execute: (command, args) => ipcRenderer.invoke('plugin-app:commands:execute', { command, args }),
  },
  tools: {
    call: (name, args) => ipcRenderer.invoke('plugin-app:tools:call', { name, args }),
  },
  events: {
    on: (eventName, callback) => {
      const channel = `plugin-app:event:${String(eventName || '')}`;
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on(channel, handler);
      return () => ipcRenderer.off(channel, handler);
    },
  },
};

contextBridge.exposeInMainWorld('mossApp', mossApp);
contextBridge.exposeInMainWorld('appVersionInfo', {
  version: '2.0.0',
  name: 'Moss App Runtime',
});
