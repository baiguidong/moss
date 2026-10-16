import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { createMossClient } from './client/moss-client.mjs';
import { createElectronTransport } from './client/electron-transport.mjs';

contextBridge.exposeInMainWorld('agentDesktop', createMossClient(
  createElectronTransport(ipcRenderer), { getPathForFile: file => webUtils.getPathForFile(file) },
));
