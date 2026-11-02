const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mossDesktopShell', Object.freeze({
  returnToLocal: () => ipcRenderer.invoke('desktop:return-local'),
}));
