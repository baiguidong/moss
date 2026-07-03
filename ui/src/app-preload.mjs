import { contextBridge, ipcRenderer } from 'electron';

const mossApp = {
  storage: {
    getItem: (key) => ipcRenderer.invoke('app-runtime:storage:get', { key }),
    setItem: (key, value) => ipcRenderer.invoke('app-runtime:storage:set', { key, value }),
    removeItem: (key) => ipcRenderer.invoke('app-runtime:storage:remove', { key }),
    list: () => ipcRenderer.invoke('app-runtime:storage:list'),
  },
  fs: {
    list: (dirPath) => ipcRenderer.invoke('app-runtime:files:list', { path: dirPath }),
    readText: (filePath) => ipcRenderer.invoke('app-runtime:files:read-text', { path: filePath }),
    writeText: (filePath, content) => ipcRenderer.invoke('app-runtime:files:write-text', { path: filePath, content }),
    mkdir: (dirPath) => ipcRenderer.invoke('app-runtime:files:mkdir', { path: dirPath }),
    delete: (filePath) => ipcRenderer.invoke('app-runtime:files:delete', { path: filePath }),
    readGlobalText: (filePath) => ipcRenderer.invoke('fs:readText', { path: filePath }),
    writeGlobalBinary: (filePath, data) => ipcRenderer.invoke('fs:writeFile', { path: filePath, data }),
    deleteGlobal: (filePath) => ipcRenderer.invoke('fs:delete', { path: filePath }),
    listGlobal: (dirPath) => ipcRenderer.invoke('fs:list', { path: dirPath }),
    getHomeDir: () => ipcRenderer.invoke('fs:getHomeDir'),
    getImageBase64: (filePath) => ipcRenderer.invoke('fs:getImageBase64', { path: filePath }),
    getFileMetadata: (filePath) => ipcRenderer.invoke('fs:getFileMetadata', { path: filePath }),
    getAppIcon: () => ipcRenderer.invoke('fs:getAppIcon'),
    createTempFile: (fileName) => ipcRenderer.invoke('fs:createTempFile', { fileName }),
  },
  agent: {
    send: (payload) => ipcRenderer.invoke('app-runtime:agent:send', payload),
    cancel: (requestId) => ipcRenderer.invoke('app-runtime:agent:cancel', { requestId }),
    reset: () => ipcRenderer.invoke('app-runtime:agent:reset'),
  },
  cron: {
    list: () => ipcRenderer.invoke('cron:list'),
    get: (id) => ipcRenderer.invoke('cron:get', { id }),
    add: (item) => ipcRenderer.invoke('cron:add', { item }),
    update: (id, updates) => ipcRenderer.invoke('cron:update', { id, updates }),
    delete: (id) => ipcRenderer.invoke('cron:delete', { id }),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell.open-external', url),
    openFile: (filePath) => ipcRenderer.invoke('shell.open-file', filePath),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell.show-item-in-folder', filePath),
  },
  document: {
    convert: (filePath, to) => ipcRenderer.invoke('document.convert', { filePath, to }),
    isLibreOfficeAvailable: () => ipcRenderer.invoke('document.libreoffice.is-available'),
  },
  preview: {
    open: (data) => ipcRenderer.invoke('preview.open', data),
    close: () => ipcRenderer.invoke('preview.close'),
  },
  log: {
    write: (level, category, message, data) => ipcRenderer.invoke('log:write', { level, category, message, data }),
  },
  skillStore: {
    fetchSkills: (params) => ipcRenderer.invoke('skill-store:fetchSkills', params),
    fetchCategories: () => ipcRenderer.invoke('skill-store:fetchCategories'),
    fetchSkillDetail: (skillId) => ipcRenderer.invoke('skill-store:fetchSkillDetail', { skillId }),
    getInstalledSkills: () => ipcRenderer.invoke('skill-store:getInstalledSkills'),
    downloadAndInstall: (params) => ipcRenderer.invoke('skill-store:downloadAndInstall', params),
    uninstall: (skillName, sourcePath) => ipcRenderer.invoke('skill-store:uninstall', { skillName, sourcePath }),
    importLocal: (sourcePath) => ipcRenderer.invoke('skill-store:importLocal', { sourcePath }),
    openImportDialog: () => ipcRenderer.invoke('skill-store:openImportDialog'),
  },
  agentStore: {
    fetchAssistants: (params) => ipcRenderer.invoke('agent:fetchAssistants', params),
    fetchCategories: () => ipcRenderer.invoke('agent:fetchCategories'),
    fetchAssistantDetail: (assistantId) => ipcRenderer.invoke('agent:fetchAssistantDetail', { assistantId }),
    getInstalledAssistants: () => ipcRenderer.invoke('agent:getInstalledAssistants'),
    downloadAndInstall: (params) => ipcRenderer.invoke('agent:downloadAndInstall', params),
    uninstall: (assistantName, sourcePath) => ipcRenderer.invoke('agent:uninstall', { assistantName, sourcePath }),
    updateAssistantMeta: (assistantName, updates) => ipcRenderer.invoke('agent:updateAssistantMeta', { assistantName, updates }),
    getAssistantContext: (assistantName) => ipcRenderer.invoke('agent:getAssistantContext', { assistantName }),
    fetchSkillDetailsByIds: (skillIds) => ipcRenderer.invoke('agent:fetchSkillDetailsByIds', { skillIds }),
  },
  openDebug: () => ipcRenderer.invoke('app:open-debug', { name: document.title }),
  onAgentEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.off('agent:event', handler);
  },
  onAgentState: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('agent:state', handler);
    return () => ipcRenderer.off('agent:state', handler);
  },
  onPermission: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('agent:permission', handler);
    return () => ipcRenderer.off('agent:permission', handler);
  },
  onRuntimeEvent: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('app-runtime:event', handler);
    return () => ipcRenderer.off('app-runtime:event', handler);
  },
  callTool: (name, args) => ipcRenderer.invoke('app-runtime:call-tool', { name, args }),
  readResource: (uri) => ipcRenderer.invoke('app-runtime:read-resource', { uri }),
  listResources: () => ipcRenderer.invoke('app-runtime:list-resources'),
  listTools: () => ipcRenderer.invoke('app-runtime:list-tools'),
  getAppInfo: () => ipcRenderer.invoke('app-runtime:get-info'),
  getMeta: () => ipcRenderer.invoke('app-runtime:get-info'),
  getVersions: () => ipcRenderer.invoke('app-runtime:call-tool', { name: 'versions.list' }),
  rollback: (versionId) => ipcRenderer.invoke('app-runtime:call-tool', { name: 'versions.rollback', args: { versionId } }),
};

contextBridge.exposeInMainWorld('mossApp', mossApp);

contextBridge.exposeInMainWorld('appVersionInfo', {
  version: '1.0.0',
  name: 'Moss App Runtime',
});

contextBridge.exposeInMainWorld('mossDebug', {
  open: () => ipcRenderer.invoke('app:open-debug', { name: document.title }),
});
