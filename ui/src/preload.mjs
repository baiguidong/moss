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
  probeWebSearch: () => ipcRenderer.invoke('agent:probe-web-search'),
  usage: {
    getOverview: () => ipcRenderer.invoke('usage:get-overview'),
  },
  memory: {
    getCatalog: () => ipcRenderer.invoke('memory:get-catalog'),
    readEntry: (payload) => ipcRenderer.invoke('memory:read-entry', payload),
  },
  workflows: {
    list: (payload) => ipcRenderer.invoke('workflow:list', payload),
    get: (payload) => ipcRenderer.invoke('workflow:get', payload),
    publish: (payload) => ipcRenderer.invoke('workflow:publish', payload),
    unpublish: (payload) => ipcRenderer.invoke('workflow:unpublish', payload),
    duplicate: (payload) => ipcRenderer.invoke('workflow:duplicate', payload),
    archive: (payload) => ipcRenderer.invoke('workflow:archive', payload),
    restore: (payload) => ipcRenderer.invoke('workflow:restore', payload),
    delete: (payload) => ipcRenderer.invoke('workflow:delete', payload),
    onChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('workflow:changed', handler);
      return () => ipcRenderer.off('workflow:changed', handler);
    },
  },
  agentMail: {
    getStatus: () => ipcRenderer.invoke('agent-mail:get-status'),
    listPending: () => ipcRenderer.invoke('agent-mail:list-pending'),
    list: (direction, limit = 100) => ipcRenderer.invoke('agent-mail:list', { direction, limit }),
    delete: (messageIds) => ipcRenderer.invoke('agent-mail:delete', { messageIds }),
    onStatusChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('agent-mail:status-changed', handler);
      return () => ipcRenderer.off('agent-mail:status-changed', handler);
    },
  },
  authenticateRemoteServer: (payload) => ipcRenderer.invoke('agent:remote-authenticate', payload),
  cancelRemoteServerAuthentication: () => ipcRenderer.invoke('agent:remote-authenticate-cancel'),
  getRemoteServerIdentity: () => ipcRenderer.invoke('agent:get-remote-identity'),
  listMcpServers: () => ipcRenderer.invoke('agent:mcp-list'),
  upsertMcpServer: (payload) => ipcRenderer.invoke('agent:mcp-upsert', payload),
  removeMcpServer: (payload) => ipcRenderer.invoke('agent:mcp-remove', payload),
  setMcpServerEnabled: (payload) => ipcRenderer.invoke('agent:mcp-set-enabled', payload),
  authenticateMcpServer: (payload) => ipcRenderer.invoke('agent:mcp-authenticate', payload),
  submitMcpAuthCallback: (payload) => ipcRenderer.invoke('agent:mcp-submit-auth-callback', payload),
  clearMcpServerAuth: (payload) => ipcRenderer.invoke('agent:mcp-clear-auth', payload),
  listProjectTemplates: () => ipcRenderer.invoke('project:list-templates'),
  listProjects: (payload) => ipcRenderer.invoke('project:list', payload),
  getProject: (payload) => ipcRenderer.invoke('project:get', payload),
  createProject: (payload) => ipcRenderer.invoke('project:create', payload),
  updateProject: (payload) => ipcRenderer.invoke('project:update', payload),
  archiveProject: (payload) => ipcRenderer.invoke('project:archive', payload),
  listProjectAssets: (payload) => ipcRenderer.invoke('project:list-assets', payload),
  listProjectEvents: (payload) => ipcRenderer.invoke('project:list-events', payload),
  listProjectDecisions: (payload) => ipcRenderer.invoke('project:list-decisions', payload),
  resolveProjectDecision: (payload) => ipcRenderer.invoke('project:resolve-decision', payload),
  rejectProjectDecision: (payload) => ipcRenderer.invoke('project:reject-decision', payload),
  getProjectMemory: (payload) => ipcRenderer.invoke('project:get-memory', payload),
  addProjectAsset: (payload) => ipcRenderer.invoke('project:add-asset', payload),
  removeProjectAsset: (payload) => ipcRenderer.invoke('project:remove-asset', payload),
  listProjectTasks: (payload) => ipcRenderer.invoke('project:list-tasks', payload),
  createProjectTask: (payload) => ipcRenderer.invoke('project:create-task', payload),
  getProjectTask: (payload) => ipcRenderer.invoke('project:get-task', payload),
  library: {
    getOverview: () => ipcRenderer.invoke('library:get-overview'),
    getExtensionStatus: () => ipcRenderer.invoke('library:get-extension-status'),
    acknowledgeExtensionGuide: () => ipcRenderer.invoke('library:acknowledge-extension-guide'),
    installExtensions: (payload) => ipcRenderer.invoke('library:install-extensions', payload),
    listCollections: () => ipcRenderer.invoke('library:list-collections'),
    createCollection: (payload) => ipcRenderer.invoke('library:create-collection', payload),
    updateCollection: (payload) => ipcRenderer.invoke('library:update-collection', payload),
    deleteCollection: (payload) => ipcRenderer.invoke('library:delete-collection', payload),
    listSources: (payload) => ipcRenderer.invoke('library:list-sources', payload),
    pickSources: (payload) => ipcRenderer.invoke('library:pick-sources', payload),
    selectDirectory: () => ipcRenderer.invoke('library:select-directory'),
    prepareDirectoryImport: (payload) => ipcRenderer.invoke('library:prepare-directory-import', payload),
    addProjectSource: (payload) => ipcRenderer.invoke('library:add-project-source', payload),
    removeSource: (payload) => ipcRenderer.invoke('library:remove-source', payload),
    refreshSource: (payload) => ipcRenderer.invoke('library:refresh-source', payload),
    listResources: (payload) => ipcRenderer.invoke('library:list-resources', payload),
    getResource: (payload) => ipcRenderer.invoke('library:get-resource', payload),
    search: (payload) => ipcRenderer.invoke('library:search', payload),
    diagnoseSearch: (payload) => ipcRenderer.invoke('library:diagnose-search', payload),
    getEvaluationOverview: () => ipcRenderer.invoke('library:get-evaluation-overview'),
    saveEvaluationCase: (payload) => ipcRenderer.invoke('library:save-evaluation-case', payload),
    deleteEvaluationCase: (payload) => ipcRenderer.invoke('library:delete-evaluation-case', payload),
    runEvaluation: (payload) => ipcRenderer.invoke('library:run-evaluation', payload),
    openResource: (payload) => ipcRenderer.invoke('library:open-resource', payload),
    showResourceInFolder: (payload) => ipcRenderer.invoke('library:show-resource-in-folder', payload),
    listJobs: (payload) => ipcRenderer.invoke('library:list-jobs', payload),
    cancelJob: (payload) => ipcRenderer.invoke('library:cancel-job', payload),
    repairIndex: () => ipcRenderer.invoke('library:repair-index'),
    saveTaskArtifact: (payload) => ipcRenderer.invoke('library:save-task-artifact', payload),
    getMigrationPreview: () => ipcRenderer.invoke('library:get-migration-preview'),
    migrateLegacy: () => ipcRenderer.invoke('library:migrate-legacy'),
    dismissLegacyMigration: () => ipcRenderer.invoke('library:dismiss-legacy-migration'),
    onChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('library:changed', handler);
      return () => ipcRenderer.off('library:changed', handler);
    },
  },
  listSessions: () => ipcRenderer.invoke('agent:list-sessions'),
  searchSessions: (payload) => ipcRenderer.invoke('agent:search-sessions', payload),
  syncRemoteSessions: () => ipcRenderer.invoke('agent:sync-remote-sessions'),
  createSession: (payload) => ipcRenderer.invoke('agent:create-session', payload),
  forkSession: (payload) => ipcRenderer.invoke('agent:fork-session', payload),
  getSession: (payload) => ipcRenderer.invoke('agent:get-session', payload),
  getTurnChanges: (payload) => ipcRenderer.invoke('agent:get-turn-changes', payload),
  previewTurnRewind: (payload) => ipcRenderer.invoke('agent:preview-turn-rewind', payload),
  rewindTurn: (payload) => ipcRenderer.invoke('agent:rewind-turn', payload),
  updateSession: (payload) => ipcRenderer.invoke('agent:update-session', payload),
  setSessionToolDisplayMode: (payload) => ipcRenderer.invoke('agent:set-session-tool-display-mode', payload),
  setSessionPermissionMode: (payload) => ipcRenderer.invoke('agent:set-session-permission-mode', payload),
  deleteSession: (payload) => ipcRenderer.invoke('agent:delete-session', payload),
  setSessionConnectors: (payload) => ipcRenderer.invoke('agent:set-session-connectors', payload),
  listWorkspaces: (payload) => ipcRenderer.invoke('agent:list-workspaces', payload),
  createWorkspace: (payload) => ipcRenderer.invoke('agent:create-workspace', payload),
  touchWorkspace: (payload) => ipcRenderer.invoke('agent:touch-workspace', payload),
  agentTeams: {
    list: (payload) => ipcRenderer.invoke('agent-teams:list', payload),
    refresh: (payload) => ipcRenderer.invoke('agent-teams:refresh', payload),
    onChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('agent-teams:changed', handler);
      return () => ipcRenderer.off('agent-teams:changed', handler);
    },
  },
  agents: {
    list: (payload) => ipcRenderer.invoke('agent:agents-list', payload),
    read: (payload) => ipcRenderer.invoke('agent:agents-read', payload),
    create: (payload) => ipcRenderer.invoke('agent:agents-create', payload),
    update: (payload) => ipcRenderer.invoke('agent:agents-update', payload),
    delete: (payload) => ipcRenderer.invoke('agent:agents-delete', payload),
    setEnabled: (payload) => ipcRenderer.invoke('agent:agents-set-enabled', payload),
    onChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('agent:agents-changed', handler);
      return () => ipcRenderer.off('agent:agents-changed', handler);
    },
  },
  setConnectorAuthStatus: (payload) => ipcRenderer.invoke('agent:set-connector-auth-status', payload),
  listConnectors: () => ipcRenderer.invoke('connector-hub:list'),
  getInstalledConnectors: () => ipcRenderer.invoke('connector-hub:get-installed'),
  refreshConnectorCliStatus: (payload) => ipcRenderer.invoke('connector-hub:refresh-cli-status', payload),
  installConnector: (payload) => ipcRenderer.invoke('connector-hub:install', payload),
  uninstallConnector: (payload) => ipcRenderer.invoke('connector-hub:uninstall', payload),
  saveConnectorMcpToken: (payload) => ipcRenderer.invoke('connector-hub:save-mcp-token', payload),
  saveConnectorCredentials: (payload) => ipcRenderer.invoke('connector-hub:save-credentials', payload),
  provisionConnectorCredentials: (payload) => ipcRenderer.invoke('connector-hub:provision-credentials', payload),
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
  appMarketplace: {
    list: (payload) => ipcRenderer.invoke('app-market:list', payload),
    getDetails: (payload) => ipcRenderer.invoke('app-market:get-details', payload),
    install: (payload) => ipcRenderer.invoke('app-market:install', payload),
  },
  listApps: () => ipcRenderer.invoke('app:list'),
  listAppVersions: (payload) => ipcRenderer.invoke('app:list-versions', payload),
  launchApp: (payload) => ipcRenderer.invoke('app:launch', payload),
  openEmbeddedApp: (payload) => ipcRenderer.invoke('app:embedded-open', payload),
  attachEmbeddedApp: (payload) => ipcRenderer.invoke('app:embedded-attach', payload),
  closeEmbeddedApp: (payload) => ipcRenderer.invoke('app:embedded-close', payload),
  rollbackApp: (payload) => ipcRenderer.invoke('app:rollback', payload),
  deleteApp: (payload) => ipcRenderer.invoke('app:delete', payload),
  installAppArchive: () => ipcRenderer.invoke('app:install-archive'),
  getAppRuntimeState: (payload) => ipcRenderer.invoke('app:get-runtime-state', payload),
  listAppContributions: (payload) => ipcRenderer.invoke('app:list-contributions', payload),
  invokeAppContribution: (payload) => ipcRenderer.invoke('app:invoke-contribution', payload),
  setAppEnabled: (payload) => ipcRenderer.invoke('app:set-enabled', payload),
  setAppGrants: (payload) => ipcRenderer.invoke('app:set-grants', payload),
  listAppInstances: (payload) => ipcRenderer.invoke('app:list-instances', payload),
  createAppInstance: (payload) => ipcRenderer.invoke('app:create-instance', payload),
  updateAppInstance: (payload) => ipcRenderer.invoke('app:update-instance', payload),
  setAppInstanceEnabled: (payload) => ipcRenderer.invoke('app:set-instance-enabled', payload),
  clearAppInstanceCredentials: (payload) => ipcRenderer.invoke('app:clear-instance-credentials', payload),
  removeAppInstance: (payload) => ipcRenderer.invoke('app:remove-instance', payload),
  restartAppInstance: (payload) => ipcRenderer.invoke('app:restart-instance', payload),
  getAppInstanceLogs: (payload) => ipcRenderer.invoke('app:get-instance-logs', payload),
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
    sync: (payload) => ipcRenderer.invoke('preview.sync', payload),
    ready: () => ipcRenderer.invoke('preview.ready'),
    close: () => ipcRenderer.invoke('preview.close'),
    onOpen: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('preview.open', handler);
      return () => ipcRenderer.off('preview.open', handler);
    },
    onSync: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('preview.sync', handler);
      return () => ipcRenderer.off('preview.sync', handler);
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
    getEvent: (payload) => ipcRenderer.invoke('audit:get-event', payload),
    getPendingAlerts: () => ipcRenderer.invoke('audit:get-pending-alerts'),
    run: (payload) => ipcRenderer.invoke('audit:run', payload),
    updateRule: (payload) => ipcRenderer.invoke('audit:update-rule', payload),
    updateFinding: (payload) => ipcRenderer.invoke('audit:update-finding', payload),
    updateFindings: (payload) => ipcRenderer.invoke('audit:update-findings', payload),
    markReported: (payload) => ipcRenderer.invoke('audit:mark-reported', payload),
    onChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('audit:changed', handler);
      return () => ipcRenderer.off('audit:changed', handler);
    },
  },
  notifications: {
    list: () => ipcRenderer.invoke('notification:list'),
    create: (notification, options) => ipcRenderer.invoke('notification:create', { notification, options }),
    importLegacy: (notifications) => ipcRenderer.invoke('notification:import-legacy', { notifications }),
    markRead: (id) => ipcRenderer.invoke('notification:mark-read', { id }),
    markAllRead: () => ipcRenderer.invoke('notification:mark-all-read'),
    remove: (id) => ipcRenderer.invoke('notification:remove', { id }),
    clear: () => ipcRenderer.invoke('notification:clear'),
    onChanged: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('notification:changed', handler);
      return () => ipcRenderer.off('notification:changed', handler);
    },
  },
  decisions: {
    respond: (payload) => ipcRenderer.invoke('decision:respond', payload),
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
  onQuestionResolved: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('agent:question-resolved', handler);
    return () => ipcRenderer.off('agent:question-resolved', handler);
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
