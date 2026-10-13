const { contextBridge, webUtils, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fixtureFiles', {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  capture: (name) => ipcRenderer.invoke('fixture:capture', name),
  input: (event) => ipcRenderer.invoke('fixture:input', event),
});
