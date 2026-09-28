import { contextBridge, ipcRenderer } from 'electron';

const subscribe = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

contextBridge.exposeInMainWorld('mossTerminal', {
  start: (payload) => ipcRenderer.invoke('terminal:start', payload),
  write: (payload) => ipcRenderer.invoke('terminal:write', payload),
  resize: (payload) => ipcRenderer.invoke('terminal:resize', payload),
  stop: (payload) => ipcRenderer.invoke('terminal:stop', payload),
  onData: (callback) => subscribe('terminal:data', callback),
  onExit: (callback) => subscribe('terminal:exit', callback),
});
