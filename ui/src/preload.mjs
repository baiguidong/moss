import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('agentDesktop', {
  // 通用 IPC 调用方法
  ipcInvoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  ipcOn: (channel, callback) => {
    const handler = (_event, ...args) => {
      // 如果只有一个参数，直接传递，否则传递数组
      const data = args.length === 1 ? args[0] : args;
      callback(data);
    };
    ipcRenderer.on(channel, handler);
    return handler;
  },
  ipcOff: (channel, handler) => {
    ipcRenderer.removeListener(channel, handler);
  },

  getStatus: () => ipcRenderer.invoke('agent:get-status'),
  getManagedRuntimeStatus: () => ipcRenderer.invoke('agent:get-managed-runtime-status'),
  ensureManagedRuntimes: (payload) => ipcRenderer.invoke('agent:ensure-managed-runtimes', payload),
  getAuthDebug: () => ipcRenderer.invoke('agent:get-auth-debug'),
  getSettings: () => ipcRenderer.invoke('agent:get-settings'),
  updateSettings: (payload) => ipcRenderer.invoke('agent:update-settings', payload),
  listMcpServers: () => ipcRenderer.invoke('agent:mcp-list'),
  upsertMcpServer: (payload) => ipcRenderer.invoke('agent:mcp-upsert', payload),
  removeMcpServer: (payload) => ipcRenderer.invoke('agent:mcp-remove', payload),
  setMcpServerEnabled: (payload) => ipcRenderer.invoke('agent:mcp-set-enabled', payload),
  authenticateMcpServer: (payload) => ipcRenderer.invoke('agent:mcp-authenticate', payload),
  submitMcpAuthCallback: (payload) => ipcRenderer.invoke('agent:mcp-submit-auth-callback', payload),
  clearMcpServerAuth: (payload) => ipcRenderer.invoke('agent:mcp-clear-auth', payload),
  getAdapterConfig: () => ipcRenderer.invoke('agent:get-adapter-config'),
  updateAdapterConfig: (payload) => ipcRenderer.invoke('agent:update-adapter-config', payload),
  listProjectTemplates: () => ipcRenderer.invoke('project:list-templates'),
  listProjects: (payload) => ipcRenderer.invoke('project:list', payload),
  getProject: (payload) => ipcRenderer.invoke('project:get', payload),
  createProject: (payload) => ipcRenderer.invoke('project:create', payload),
  updateProject: (payload) => ipcRenderer.invoke('project:update', payload),
  archiveProject: (payload) => ipcRenderer.invoke('project:archive', payload),
  listProjectAssets: (payload) => ipcRenderer.invoke('project:list-assets', payload),
  addProjectAsset: (payload) => ipcRenderer.invoke('project:add-asset', payload),
  removeProjectAsset: (payload) => ipcRenderer.invoke('project:remove-asset', payload),
  listProjectSessions: (payload) => ipcRenderer.invoke('project:list-sessions', payload),
  bindSessionToProject: (payload) => ipcRenderer.invoke('project:bind-session', payload),
  unbindSessionFromProject: (payload) => ipcRenderer.invoke('project:unbind-session', payload),
  listProjectTasks: (payload) => ipcRenderer.invoke('project:list-tasks', payload),
  createProjectTask: (payload) => ipcRenderer.invoke('project:create-task', payload),
  updateProjectTask: (payload) => ipcRenderer.invoke('project:update-task', payload),
  getProjectTask: (payload) => ipcRenderer.invoke('project:get-task', payload),
  listProjectTeamRuns: (payload) => ipcRenderer.invoke('project:list-team-runs', payload),
  getProjectTeamRun: (payload) => ipcRenderer.invoke('project:get-team-run', payload),
  createProjectTeamRun: (payload) => ipcRenderer.invoke('project:create-team-run', payload),
  updateProjectTeamRun: (payload) => ipcRenderer.invoke('project:update-team-run', payload),
  addProjectTeamMember: (payload) => ipcRenderer.invoke('project:add-team-member', payload),
  updateProjectTeamMember: (payload) => ipcRenderer.invoke('project:update-team-member', payload),
  removeProjectTeamMember: (payload) => ipcRenderer.invoke('project:remove-team-member', payload),
  startProjectTeamMember: (payload) => ipcRenderer.invoke('project:start-team-member', payload),
  closeProjectTeamRun: (payload) => ipcRenderer.invoke('project:close-team-run', payload),
  listSessions: () => ipcRenderer.invoke('agent:list-sessions'),
  createSession: (payload) => ipcRenderer.invoke('agent:create-session', payload),
  getSession: (payload) => ipcRenderer.invoke('agent:get-session', payload),
  updateSession: (payload) => ipcRenderer.invoke('agent:update-session', payload),
  deleteSession: (payload) => ipcRenderer.invoke('agent:delete-session', payload),
  setSessionConnectors: (payload) => ipcRenderer.invoke('agent:set-session-connectors', payload),
  listConnectors: () => ipcRenderer.invoke('connector-hub:list'),
  getInstalledConnectors: () => ipcRenderer.invoke('connector-hub:get-installed'),
  refreshConnectorCliStatus: (payload) => ipcRenderer.invoke('connector-hub:refresh-cli-status', payload),
  installConnector: (payload) => ipcRenderer.invoke('connector-hub:install', payload),
  uninstallConnector: (payload) => ipcRenderer.invoke('connector-hub:uninstall', payload),
  saveConnectorMcpToken: (payload) => ipcRenderer.invoke('connector-hub:save-mcp-token', payload),
  saveConnectorCredentials: (payload) => ipcRenderer.invoke('connector-hub:save-credentials', payload),
  pickDirectory: () => ipcRenderer.invoke('agent:pick-directory'),
  pickFiles: () => ipcRenderer.invoke('agent:pick-files'),
  setSessionWorkspace: (payload) => ipcRenderer.invoke('agent:set-session-workspace', payload),
  openWorkspace: (payload) => ipcRenderer.invoke('workspace:open', payload),
  copyFileToWorkspace: (payload) => ipcRenderer.invoke('workspace:copyFileToWorkspace', payload),
  send: (payload) => ipcRenderer.invoke('agent:send', payload),
  approvePlan: (payload) => ipcRenderer.invoke('agent:approve-plan', payload),
  rejectPlan: (payload) => ipcRenderer.invoke('agent:reject-plan', payload),
  answerQuestion: (payload) => ipcRenderer.invoke('agent:answer-question', payload),
  rejectQuestion: (payload) => ipcRenderer.invoke('agent:reject-question', payload),
  abort: (payload) => ipcRenderer.invoke('agent:abort', payload),
  listApps: () => ipcRenderer.invoke('app:list'),
  listAppVersions: (payload) => ipcRenderer.invoke('app:list-versions', payload),
  launchApp: (payload) => ipcRenderer.invoke('app:launch', payload),
  openEmbeddedApp: (payload) => ipcRenderer.invoke('app:embedded-open', payload),
  attachEmbeddedApp: (payload) => ipcRenderer.invoke('app:embedded-attach', payload),
  closeEmbeddedApp: (payload) => ipcRenderer.invoke('app:embedded-close', payload),
  rollbackApp: (payload) => ipcRenderer.invoke('app:rollback', payload),
  deleteApp: (payload) => ipcRenderer.invoke('app:delete', payload),
  listWorkspaceDir: (payload) => ipcRenderer.invoke('workspace:list-dir', payload),
  readWorkspaceFile: (payload) => ipcRenderer.invoke('workspace:read-file', payload),
  document: {
    convert: (payload) => ipcRenderer.invoke('document.convert', payload),
    libreOffice: {
      isAvailable: () => ipcRenderer.invoke('document.libreoffice.is-available'),
    },
  },
  libreOffice: {
    checkInstalled: () => ipcRenderer.invoke('libreoffice.check-installed'),
    install: () => ipcRenderer.invoke('libreoffice.install'),
    installFromLocalFile: (payload) => ipcRenderer.invoke('libreoffice.install-from-local-file', payload),
    uninstall: () => ipcRenderer.invoke('libreoffice.uninstall'),
    getInstallState: () => ipcRenderer.invoke('libreoffice.get-install-state'),
    onInstallProgress: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('libreoffice.install-progress', handler);
      return () => ipcRenderer.off('libreoffice.install-progress', handler);
    },
    onInstallResult: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('libreoffice.install-result', handler);
      return () => ipcRenderer.off('libreoffice.install-result', handler);
    },
  },
  previewHistory: {
    list: (payload) => ipcRenderer.invoke('previewHistory.list', payload),
    save: (payload) => ipcRenderer.invoke('previewHistory.save', payload),
    getContent: (payload) => ipcRenderer.invoke('previewHistory.getContent', payload),
  },
  preview: {
    open: (payload) => ipcRenderer.invoke('preview.open', payload),
    close: () => ipcRenderer.invoke('preview.close'),
    onOpen: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('preview.open', handler);
      return () => ipcRenderer.off('preview.open', handler);
    },
  },
  browser: {
    getState: (payload) => ipcRenderer.invoke('browser:get-state', payload),
    openTab: (payload) => ipcRenderer.invoke('browser:open-tab', payload),
    activateTab: (payload) => ipcRenderer.invoke('browser:activate-tab', payload),
    closeTab: (payload) => ipcRenderer.invoke('browser:close-tab', payload),
    navigate: (payload) => ipcRenderer.invoke('browser:navigate', payload),
    goBack: (payload) => ipcRenderer.invoke('browser:go-back', payload),
    goForward: (payload) => ipcRenderer.invoke('browser:go-forward', payload),
    reload: (payload) => ipcRenderer.invoke('browser:reload', payload),
    stop: (payload) => ipcRenderer.invoke('browser:stop', payload),
    toggleDevTools: (payload) => ipcRenderer.invoke('browser:toggle-devtools', payload),
    completeAuth: (payload) => ipcRenderer.invoke('browser:complete-auth', payload),
    getPendingAuthNavigations: (payload) => ipcRenderer.invoke('browser:get-pending-auth-navigations', payload),
    ackAuthNavigation: (payload) => ipcRenderer.invoke('browser:ack-auth-navigation', payload),
    setHost: (payload) => ipcRenderer.send('browser:set-host', payload),
    onOpen: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('browser:open', handler);
      return () => ipcRenderer.off('browser:open', handler);
    },
    onState: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('browser:state', handler);
      return () => ipcRenderer.off('browser:state', handler);
    },
    onAuthNavigation: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('browser:auth-navigation', handler);
      return () => ipcRenderer.off('browser:auth-navigation', handler);
    },
    onExternalUrl: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('browser:external-url', handler);
      return () => ipcRenderer.off('browser:external-url', handler);
    },
  },
  audit: {
    getDashboard: () => ipcRenderer.invoke('audit:get-dashboard'),
    run: (payload) => ipcRenderer.invoke('audit:run', payload),
    updateRule: (payload) => ipcRenderer.invoke('audit:update-rule', payload),
    updateFinding: (payload) => ipcRenderer.invoke('audit:update-finding', payload),
    updateFindings: (payload) => ipcRenderer.invoke('audit:update-findings', payload),
    onChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('audit:changed', handler);
      return () => ipcRenderer.off('audit:changed', handler);
    },
  },
  workspace: {
    writeFile: (payload) => ipcRenderer.invoke('workspace.write-file', payload),
  },
  shell: {
    openFile: (filePath) => ipcRenderer.invoke('shell.open-file', filePath),
    openExternal: (url) => ipcRenderer.invoke('shell.open-external', url),
    showItemInFolder: (filePath) => ipcRenderer.invoke('shell.show-item-in-folder', filePath),
  },
  fs: {
    getImageBase64: (path) => ipcRenderer.invoke('fs:getImageBase64', { path }),
    getFileMetadata: (path) => ipcRenderer.invoke('fs:getFileMetadata', { path }),
    getHomeDir: () => ipcRenderer.invoke('fs:getHomeDir'),
    createTempFile: (fileName) => ipcRenderer.invoke('fs:createTempFile', { fileName }),
    writeFile: (path, data) => ipcRenderer.invoke('fs:writeFile', { path, data }),
    getAppIcon: () => ipcRenderer.invoke('fs:getAppIcon'),
    saveImageToWorkspace: (sessionId, fileName, data) => ipcRenderer.invoke('workspace:saveImage', { sessionId, fileName, data }),
  },
  listBackgroundTasks: (payload) => ipcRenderer.invoke('agent:list-background-tasks', payload),
  getTaskOutput: (payload) => ipcRenderer.invoke('agent:task-output', payload),
  killTask: (payload) => ipcRenderer.invoke('agent:kill-task', payload),
  onBackgroundTasks: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:background-tasks', handler);
    return () => ipcRenderer.off('agent:background-tasks', handler);
  },
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:event', handler);
    return () => ipcRenderer.off('agent:event', handler);
  },
  onState: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:state', handler);
    return () => ipcRenderer.off('agent:state', handler);
  },
  onPermission: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:permission', handler);
    return () => ipcRenderer.off('agent:permission', handler);
  },
  onQuestionRequest: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:question-request', handler);
    return () => ipcRenderer.off('agent:question-request', handler);
  },
  onSessionMeta: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:session-meta', handler);
    return () => ipcRenderer.off('agent:session-meta', handler);
  },
  onSessionHistory: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:session-history', handler);
    return () => ipcRenderer.off('agent:session-history', handler);
  },
  onSessionRemoved: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:session-removed', handler);
    return () => ipcRenderer.off('agent:session-removed', handler);
  },
  onWorkspaceChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.off('workspace:changed', handler);
  },
  onAppsChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app:changed', handler);
    return () => ipcRenderer.off('app:changed', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:settings-changed', handler);
    return () => ipcRenderer.off('agent:settings-changed', handler);
  },
  onProjectsChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('project:changed', handler);
    return () => ipcRenderer.off('project:changed', handler);
  },
  onAssistantsChanged: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:assistants-changed', handler);
    return () => ipcRenderer.off('agent:assistants-changed', handler);
  },
  listCoordinatorTasks: (sessionId) => ipcRenderer.invoke('coordinator:list-tasks', { sessionId }),
  // Worker (sub-agent) results from SDK subagents directory
  getWorkerResults: (payload) => ipcRenderer.invoke('agent:get-worker-results', payload),
  setWorkerSummaries: (payload) => ipcRenderer.invoke('agent:set-worker-summaries', payload),
  // Cron task management
  cronList: () => ipcRenderer.invoke('cron:list'),
  cronDelete: (taskId) => ipcRenderer.invoke('cron:delete', { taskId }),
  // Assistant management
  getInstalledAssistants: () => ipcRenderer.invoke('agent:getInstalledAssistants'),
  getRemoteInstalledAssistants: () => ipcRenderer.invoke('agent:getRemoteInstalledAssistants'),
  getAssistantContext: (assistantName) => ipcRenderer.invoke('agent:getAssistantContext', { assistantName }),
  getSkillInfosByIds: (skillIds) => ipcRenderer.invoke('agent:getSkillInfosByIds', { skillIds }),
  // Log management
  logGetPath: () => ipcRenderer.invoke('log:get-path'),
  logDownload: () => ipcRenderer.invoke('log:download'),
  logWrite: (payload) => ipcRenderer.invoke('log:write', payload),

  // Update / Auto-update
  update: {
    check: (params) => ipcRenderer.invoke('update:check', params),
    download: (params) => ipcRenderer.invoke('update:download', params),
    onOpenModal: (callback) => {
      const handler = () => callback();
      ipcRenderer.on('update:open-modal', handler);
      return () => ipcRenderer.off('update:open-modal', handler);
    },
    onDownloadProgress: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('update:download-progress', handler);
      return () => ipcRenderer.off('update:download-progress', handler);
    },
  },
  autoUpdate: {
    check: (params) => ipcRenderer.invoke('auto-update:check', params),
    download: () => ipcRenderer.invoke('auto-update:download'),
    quitAndInstall: () => ipcRenderer.invoke('auto-update:quit-and-install'),
    getDownloadedFilePath: () => ipcRenderer.invoke('auto-update:get-downloaded-file-path'),
    getMirrorStatus: () => ipcRenderer.invoke('auto-update:get-mirror-status'),
    onStatus: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('auto-update:status', handler);
      return () => ipcRenderer.off('auto-update:status', handler);
    },
  },
});
