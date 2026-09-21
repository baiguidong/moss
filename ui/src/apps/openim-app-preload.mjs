import { contextBridge, ipcRenderer } from 'electron';
import './app-preload.mjs';

const updateOpenIMOnlineStatus = () => ipcRenderer.invoke('openim:sdk-call', 'networkStatusChanged');
window.addEventListener('online', updateOpenIMOnlineStatus);
window.addEventListener('offline', updateOpenIMOnlineStatus);

contextBridge.exposeInMainWorld('openIMRenderApi', {
  subscribe: (channel, callback) => {
    if (channel !== 'openim-sdk-ipc-event' || typeof callback !== 'function') {
      throw new TypeError('Unsupported OpenIM event subscription');
    }
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.off(channel, handler);
  },
  imMethodsInvoke: (method, ...args) => ipcRenderer.invoke('openim:sdk-call', method, ...args),
});

contextBridge.exposeInMainWorld('agentDesktop', {
  openIM: {
    getConfig: () => ipcRenderer.invoke('openim:get-config'),
    createSession: () => ipcRenderer.invoke('openim:create-session'),
    listDirectory: () => ipcRenderer.invoke('openim:list-directory'),
    prepareDirectConversation: (payload) => ipcRenderer.invoke('openim:prepare-direct-session', payload),
    prepareGroupConversation: (payload) => ipcRenderer.invoke('openim:prepare-group-session', payload),
    pickFiles: (payload) => ipcRenderer.invoke('openim:pick-files', payload),
    materializeFile: (payload) => ipcRenderer.invoke('openim:materialize-file', payload),
    createVideoThumbnail: (payload) => ipcRenderer.invoke('openim:create-video-thumbnail', payload),
    captureScreen: () => ipcRenderer.invoke('openim:capture-screen'),
    download: (payload) => ipcRenderer.invoke('openim:download', payload),
    openExternal: (url) => ipcRenderer.invoke('openim:open-external', url),
    getRtcToken: (payload) => ipcRenderer.invoke('openim:get-rtc-token', payload),
  },
});
