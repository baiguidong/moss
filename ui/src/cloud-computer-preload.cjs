const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mossDesktopShell', Object.freeze({
  returnToLocal: () => ipcRenderer.invoke('desktop:return-local'),
  getPresentation: () => ipcRenderer.invoke('desktop:cloud-presentation'),
  updateAppearance: appearance => ipcRenderer.invoke('desktop:cloud-appearance', appearance),
  onPresentation: callback => {
    const listener = (_event, value) => callback(value);
    ipcRenderer.on('desktop:presentation', listener);
    return () => ipcRenderer.removeListener('desktop:presentation', listener);
  },
}));
