
// Use a finite source mapping: renderer input must never become an IPC channel.
function cronPrefix(source) {
  if (source === 'local') return 'agent:cron';
  if (source === 'cloud') return 'agent:cloud-cron';
  throw new Error('Unknown cron source.');
}

export function createMossClient(transport, platform = {}) {
  return {
  // 通用 IPC 调用方法
  ipcInvoke: (channel, payload) => transport.invoke(channel, payload),
  ipcOn: (channel, callback) => {
    const handler = (...args) => {
      // 如果只有一个参数，直接传递，否则传递数组
      const data = args.length === 1 ? args[0] : args;
      callback(data);
    };
    transport.on(channel, handler);
    return handler;
  },
  ipcOff: (channel, handler) => {
    transport.off(channel, handler);
  },

  skillHub: {
    getInstalled: () => transport.invoke('public-skillhub:get-installed-skills'),
    fetchCategories: () => transport.invoke('public-skillhub:fetch-categories'),
    fetchSkills: (payload) => transport.invoke('public-skillhub:fetch-skills', payload),
    fetchDetail: (payload) => transport.invoke('public-skillhub:fetch-detail', payload),
    install: (payload) => transport.invoke('public-skillhub:install-skill', payload),
    uninstall: (payload) => transport.invoke('public-skillhub:uninstall-skill', payload),
    openImportDialog: () => transport.invoke('public-skillhub:open-import-dialog'),
    importLocal: (payload) => transport.invoke('public-skillhub:import-local', payload),
  },
  expertHub: {
    getInstalled: () => transport.invoke('public-experthub:get-installed-experts'),
    fetchCategories: (payload) => transport.invoke('public-experthub:fetch-categories', payload),
    fetchExperts: (payload) => transport.invoke('public-experthub:fetch-experts', payload),
    fetchFeatured: (payload) => transport.invoke('public-experthub:fetch-featured-experts', payload),
    fetchScenes: (payload) => transport.invoke('public-experthub:fetch-scenes', payload),
    fetchDetail: (payload) => transport.invoke('public-experthub:fetch-detail', payload),
    install: (payload) => transport.invoke('public-experthub:install-expert', payload),
    uninstall: (payload) => transport.invoke('public-experthub:uninstall-expert', payload),
  },
  getInstalledSkills: () => transport.invoke('skill-store:getInstalledSkills'),
  sessionCron: {
    list: (source) => transport.invoke(`${cronPrefix(source)}-list`),
    toggle: (source, payload) => transport.invoke(`${cronPrefix(source)}-toggle`, payload),
    remove: (source, payload) => transport.invoke(`${cronPrefix(source)}-remove`, payload),
    runNow: (source, payload) => transport.invoke(`${cronPrefix(source)}-run-now`, payload),
  },
  onConnectorsChanged: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('connector-hub:changed', handler);
    return () => transport.off('connector-hub:changed', handler);
  },

  computerUse: {
    status: () => transport.invoke('computer-use:status'),
    stop: () => transport.invoke('computer-use:stop'),
    revoke: (bundleId) => transport.invoke('computer-use:revoke', { bundleId }),
    decide: (id, decision) => transport.invoke('computer-use:decide', { id, decision }),
    onChanged: (callback) => { const handler = (status) => callback(status); transport.on('computer-use:changed', handler); return () => transport.off('computer-use:changed', handler); },
  },
  getStatus: () => transport.invoke('agent:get-status'),
  getCapabilities: () => transport.invoke('host:capabilities'),
  confirmations: {
    list: () => transport.invoke('host:confirmations-list'),
    respond: payload => transport.invoke('host:confirmations-respond', payload),
    onChanged: callback => {
      transport.on('host:confirmations-changed', callback);
      return () => transport.off('host:confirmations-changed', callback);
    },
  },
  getManagedRuntimeStatus: () => transport.invoke('agent:get-managed-runtime-status'),
  ensureManagedRuntimes: (payload) => transport.invoke('agent:ensure-managed-runtimes', payload),
  getAuthDebug: () => transport.invoke('agent:get-auth-debug'),
  getSettings: () => transport.invoke('agent:get-settings'),
  testModel: (payload) => transport.invoke('agent:test-model', payload),
  updateSettings: (payload) => transport.invoke('agent:update-settings', payload),
  probeWebSearch: () => transport.invoke('agent:probe-web-search'),
  usage: {
    getOverview: () => transport.invoke('usage:get-overview'),
    getCloudOverview: () => transport.invoke('usage:get-cloud-overview'),
    getSession: (payload) => transport.invoke('usage:get-session', payload),
  },

  memory: {
    dreamStatus: () => transport.invoke('memory:dream-status'),
    startDream: () => transport.invoke('memory:dream-start'),
    stopDream: () => transport.invoke('memory:dream-stop'),
    getCatalog: () => transport.invoke('memory:get-catalog'),
    readEntry: (payload) => transport.invoke('memory:read-entry', payload),
  },
  agentMail: {
    getStatus: () => transport.invoke('agent-mail:get-status'),
    listPending: () => transport.invoke('agent-mail:list-pending'),
    list: (direction, limit = 100) => transport.invoke('agent-mail:list', { direction, limit }),
    delete: (messageIds) => transport.invoke('agent-mail:delete', { messageIds }),
    onStatusChanged: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('agent-mail:status-changed', handler);
      return () => transport.off('agent-mail:status-changed', handler);
    },
  },
  authenticateRemoteServer: (payload) => transport.invoke('agent:remote-authenticate', payload),
  cancelRemoteServerAuthentication: () => transport.invoke('agent:remote-authenticate-cancel'),
  getRemoteServerIdentity: () => transport.invoke('agent:get-remote-identity'),
  authenticateMcpServer: (payload) => transport.invoke('agent:mcp-authenticate', payload),
  submitMcpAuthCallback: (payload) => transport.invoke('agent:mcp-submit-auth-callback', payload),
  clearMcpServerAuth: (payload) => transport.invoke('agent:mcp-clear-auth', payload),
  listProjectTemplates: () => transport.invoke('project:list-templates'),
  listProjects: (payload) => transport.invoke('project:list', payload),
  getProject: (payload) => transport.invoke('project:get', payload),
  createProject: (payload) => transport.invoke('project:create', payload),
  updateProject: (payload) => transport.invoke('project:update', payload),
  archiveProject: (payload) => transport.invoke('project:archive', payload),
  listProjectAssets: (payload) => transport.invoke('project:list-assets', payload),
  listProjectEvents: (payload) => transport.invoke('project:list-events', payload),
  getProjectMemory: (payload) => transport.invoke('project:get-memory', payload),
  organizeProjectMemory: (payload) => transport.invoke('project:organize-memory', payload),
  noteProjectMemory: (payload) => transport.invoke('project:note-memory', payload),
  readProjectMemory: (payload) => transport.invoke('project:read-memory', payload),
  addProjectAsset: (payload) => transport.invoke('project:add-asset', payload),
  removeProjectAsset: (payload) => transport.invoke('project:remove-asset', payload),
  listProjectTasks: (payload) => transport.invoke('project:list-tasks', payload),
  createProjectTask: (payload) => transport.invoke('project:create-task', payload),
  getProjectTask: (payload) => transport.invoke('project:get-task', payload),
  listSessions: () => transport.invoke('agent:list-sessions'),
  searchSessions: (payload) => transport.invoke('agent:search-sessions', payload),
  syncRemoteSessions: () => transport.invoke('agent:sync-remote-sessions'),
  createSession: (payload) => transport.invoke('agent:create-session', payload),
  forkSession: (payload) => transport.invoke('agent:fork-session', payload),
  openTerminal: (payload) => transport.invoke('terminal:open', payload),
  getSession: (payload) => transport.invoke('agent:get-session', payload),
  getCompactionRequest: (payload) => transport.invoke('agent:get-compaction-request', payload),
  getModelContext: (payload) => transport.invoke('agent:get-model-context', payload),
  getSessionEffort: (payload) => transport.invoke('agent:get-session-effort', payload),
  setSessionEffort: (payload) => transport.invoke('agent:set-session-effort', payload),
  listSessionTasks: (payload) => transport.invoke('agent:list-session-tasks', payload),
  getTurnChanges: (payload) => transport.invoke('agent:get-turn-changes', payload),
  getObservationDiff: (payload) => transport.invoke('agent:get-observation-diff', payload),
  onTurnObservation: (callback) => { transport.on('turn-observation:updated', callback); return () => transport.off('turn-observation:updated', callback); },
  previewTurnRewind: (payload) => transport.invoke('agent:preview-turn-rewind', payload),
  rewindTurn: (payload) => transport.invoke('agent:rewind-turn', payload),
  updateSession: (payload) => transport.invoke('agent:update-session', payload),
  setSessionToolDisplayMode: (payload) => transport.invoke('agent:set-session-tool-display-mode', payload),
  setSessionPermissionMode: (payload) => transport.invoke('agent:set-session-permission-mode', payload),
  deleteSession: (payload) => transport.invoke('agent:delete-session', payload),
  setSessionApps: (payload) => transport.invoke('agent:set-apps', payload),
  selectAppResource: (payload) => transport.invoke('app:composer:select', payload),
  setSessionConnectors: (payload) => transport.invoke('agent:set-session-connectors', payload),
  listWorkspaces: (payload) => transport.invoke('agent:list-workspaces', payload),
  createWorkspace: (payload) => transport.invoke('agent:create-workspace', payload),
  touchWorkspace: (payload) => transport.invoke('agent:touch-workspace', payload),
  agentTeams: {
    list: (payload) => transport.invoke('agent-teams:list', payload),
    refresh: (payload) => transport.invoke('agent-teams:refresh', payload),
    onChanged: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('agent-teams:changed', handler);
      return () => transport.off('agent-teams:changed', handler);
    },
  },
  agents: {
    list: (payload) => transport.invoke('agent:agents-list', payload),
    read: (payload) => transport.invoke('agent:agents-read', payload),
    create: (payload) => transport.invoke('agent:agents-create', payload),
    update: (payload) => transport.invoke('agent:agents-update', payload),
    delete: (payload) => transport.invoke('agent:agents-delete', payload),
    setEnabled: (payload) => transport.invoke('agent:agents-set-enabled', payload),
    onChanged: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('agent:agents-changed', handler);
      return () => transport.off('agent:agents-changed', handler);
    },
  },
  setConnectorAuthStatus: (payload) => transport.invoke('agent:set-connector-auth-status', payload),
  listConnectors: () => transport.invoke('connector-hub:list'),
  getInstalledConnectors: () => transport.invoke('connector-hub:get-installed'),
  refreshConnectorCliStatus: (payload) => transport.invoke('connector-hub:refresh-cli-status', payload),
  installConnector: (payload) => transport.invoke('connector-hub:install', payload),
  uninstallConnector: (payload) => transport.invoke('connector-hub:uninstall', payload),
  saveConnectorMcpToken: (payload) => transport.invoke('connector-hub:save-mcp-token', payload),
  saveConnectorCredentials: (payload) => transport.invoke('connector-hub:save-credentials', payload),
  provisionConnectorCredentials: (payload) => transport.invoke('connector-hub:provision-credentials', payload),
  pickDirectory: () => transport.invoke('agent:pick-directory'),
  pickFiles: () => transport.invoke('agent:pick-files'),
  setSessionWorkspace: (payload) => transport.invoke('agent:set-session-workspace', payload),
  openWorkspace: (payload) => transport.invoke('workspace:open', payload),
  copyFileToWorkspace: (payload) => transport.invoke('workspace:copyFileToWorkspace', payload),
  send: (payload) => transport.invoke('agent:send', payload),
  sessionInteraction: (payload) => transport.invoke('agent:session-interaction', payload),
  approvePlan: (payload) => transport.invoke('agent:approve-plan', payload),
  rejectPlan: (payload) => transport.invoke('agent:reject-plan', payload),
  answerQuestion: (payload) => transport.invoke('agent:answer-question', payload),
  rejectQuestion: (payload) => transport.invoke('agent:reject-question', payload),
  abort: (payload) => transport.invoke('agent:abort', payload),
  appDiscovery: (payload) => transport.invoke('app:discovery-preferences', payload),
  connectorApp: (payload) => transport.invoke('app:connector', payload),
  appMarketplace: {
    list: (payload) => transport.invoke('app-market:list', payload),
    getDetails: (payload) => transport.invoke('app-market:get-details', payload),
    install: (payload) => transport.invoke('app-market:install', payload),
  },
  listApps: () => transport.invoke('app:list'),
  importLegacyBuddy: (payload) => transport.invoke('app:import-legacy-buddy', payload),
  inspectAppMcpTools: (payload) => transport.invoke('app:inspect-mcp-tools', payload),
  resourceMonitor: {
    getSnapshot: (payload) => transport.invoke('resource-monitor:snapshot', payload),
  },
  listAppVersions: (payload) => transport.invoke('app:list-versions', payload),
  launchApp: (payload) => transport.invoke('app:launch', payload),
  openEmbeddedApp: (payload) => transport.invoke('app:embedded-open', payload),
  attachEmbeddedApp: (payload) => transport.invoke('app:embedded-attach', payload),
  closeEmbeddedApp: (payload) => transport.invoke('app:embedded-close', payload),
  rollbackApp: (payload) => transport.invoke('app:rollback', payload),
  deleteApp: (payload) => transport.invoke('app:delete', payload),
  installAppArchive: payload => transport.invoke('app:install-archive', payload),
  getAppInstallProgress: () => transport.invoke('app:get-install-progress'),
  onAppInstallProgress: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('app:install-progress', handler);
    return () => transport.off('app:install-progress', handler);
  },
  openAppResource: (uri) => transport.invoke('app:open-resource', { uri }),
  getAppRuntimeState: (payload) => transport.invoke('app:get-runtime-state', payload),
  listAppResources: (payload) => transport.invoke('app:composer:list', payload),
  getAppAuthoring: () => transport.invoke('app:authoring:get'),
  prepareAppAuthoring: (appId) => transport.invoke('app:authoring:prepare', { appId }),
  getAppAuthoringOperations: (sessionId) => transport.invoke('app:authoring:operations', { sessionId }),
  getAppAuthoringContext: (sessionId) => transport.invoke('app:authoring:context', { sessionId }),
  onAppAuthoringOperation: (callback) => {
    const listener = (payload) => callback(payload);
    transport.on('app:authoring:operation', listener);
    return () => transport.off('app:authoring:operation', listener);
  },
  cancelAppAuthoringOperation: (sessionId, operationRef) => transport.invoke('app:authoring:cancel', { sessionId, operationRef }),
  onAppComposerBound: (callback) => {
    const listener = (payload) => callback(payload);
    transport.on('app:composer:bound', listener);
    return () => transport.off('app:composer:bound', listener);
  },
  prepareAppResource: (payload) => transport.invoke('app:composer:resolve', payload),
  onAppPrepareComposer: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('app:composer:prepare', handler);
    return () => transport.off('app:composer:prepare', handler);
  },
  listAppCommands: (payload) => transport.invoke('app:list-commands', payload),
  listAppContributions: (payload) => transport.invoke('app:list-contributions', payload),
  invokeAppContribution: (payload) => transport.invoke('app:invoke-contribution', payload),
  setAppEnabled: (payload) => transport.invoke('app:set-enabled', payload),
  setAppGrants: (payload) => transport.invoke('app:set-grants', payload),
  listAppInstances: (payload) => transport.invoke('app:list-instances', payload),
  updateAppInstance: (payload) => transport.invoke('app:update-instance', payload),
  setAppInstanceEnabled: (payload) => transport.invoke('app:set-instance-enabled', payload),
  clearAppInstanceCredentials: (payload) => transport.invoke('app:clear-instance-credentials', payload),
  restartAppInstance: (payload) => transport.invoke('app:restart-instance', payload),
  getAppInstanceLogs: (payload) => transport.invoke('app:get-instance-logs', payload),
  listWorkspaceDir: (payload) => transport.invoke('workspace:list-dir', payload),
  readWorkspaceFile: (payload) => transport.invoke('workspace:read-file', payload),
  document: {
    convert: (payload) => transport.invoke('document.convert', payload),
    libreOffice: {
      isAvailable: () => transport.invoke('document.libreoffice.is-available'),
    },
  },
  libreOffice: {
    checkInstalled: () => transport.invoke('libreoffice.check-installed'),
    install: () => transport.invoke('libreoffice.install'),
    installFromLocalFile: (payload) => transport.invoke('libreoffice.install-from-local-file', payload),
    uninstall: () => transport.invoke('libreoffice.uninstall'),
    getInstallState: () => transport.invoke('libreoffice.get-install-state'),
    onInstallProgress: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('libreoffice.install-progress', handler);
      return () => transport.off('libreoffice.install-progress', handler);
    },
    onInstallResult: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('libreoffice.install-result', handler);
      return () => transport.off('libreoffice.install-result', handler);
    },
  },
  previewHistory: {
    list: (payload) => transport.invoke('previewHistory.list', payload),
    save: (payload) => transport.invoke('previewHistory.save', payload),
    getContent: (payload) => transport.invoke('previewHistory.getContent', payload),
  },
  preview: {
    resolveFiles: (payload) => transport.invoke('preview:resolve-files', payload),
    readFile: (payload) => transport.invoke('preview:read-file', payload),
    open: (payload) => transport.invoke('preview.open', payload),
    sync: (payload) => transport.invoke('preview.sync', payload),
    ready: () => transport.invoke('preview.ready'),
    close: () => transport.invoke('preview.close'),
    onOpen: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('preview.open', handler);
      return () => transport.off('preview.open', handler);
    },
    onSync: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('preview.sync', handler);
      return () => transport.off('preview.sync', handler);
    },
  },
  previewDocument: {
    acquire: payload => transport.invoke('preview-document:acquire', payload),
    update: payload => transport.invoke('preview-document:update', payload),
    save: payload => transport.invoke('preview-document:save', payload),
    acknowledge: payload => transport.invoke('preview-document:acknowledge', payload),
    release: payload => transport.invoke('preview-document:release', payload),
    on: (event, callback) => { transport.on('preview-document:' + event, callback); return () => transport.off('preview-document:' + event, callback); },
  },
  presentation: {
    refresh: payload => transport.invoke('presentation:refresh', payload),
    resolve: (payload) => transport.invoke('presentation:resolve', payload),
    snapshot: (payload) => transport.invoke('presentation:snapshot', payload),
    action: (payload) => transport.invoke('presentation:action', payload),
    open: (payload) => transport.invoke('presentation:open', payload),
    load: (payload) => transport.invoke('presentation:load', payload),
    acknowledge: (payload) => transport.invoke('presentation:ack', payload),
    popout: (payload) => transport.invoke('presentation:popout', payload),
    onResult: callback => { transport.on('presentation:result', callback); return () => transport.off('presentation:result', callback); },
    onChanged: (callback) => { transport.on('presentation:changed', callback); return () => transport.off('presentation:changed', callback); },
  },
  browser: {
    getState: (payload) => transport.invoke('browser:get-state', payload),
    openTab: (payload) => transport.invoke('browser:open-tab', payload),
    activateTab: (payload) => transport.invoke('browser:activate-tab', payload),
    closeTab: (payload) => transport.invoke('browser:close-tab', payload),
    navigate: (payload) => transport.invoke('browser:navigate', payload),
    goBack: (payload) => transport.invoke('browser:go-back', payload),
    goForward: (payload) => transport.invoke('browser:go-forward', payload),
    reload: (payload) => transport.invoke('browser:reload', payload),
    stop: (payload) => transport.invoke('browser:stop', payload),
    toggleDevTools: (payload) => transport.invoke('browser:toggle-devtools', payload),
    completeAuth: (payload) => transport.invoke('browser:complete-auth', payload),
    getPendingAuthNavigations: (payload) => transport.invoke('browser:get-pending-auth-navigations', payload),
    ackAuthNavigation: (payload) => transport.invoke('browser:ack-auth-navigation', payload),
    setHost: (payload) => transport.send('browser:set-host', payload),
    onOpen: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('browser:open', handler);
      return () => transport.off('browser:open', handler);
    },
    onState: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('browser:state', handler);
      return () => transport.off('browser:state', handler);
    },
    onAuthNavigation: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('browser:auth-navigation', handler);
      return () => transport.off('browser:auth-navigation', handler);
    },
    onExternalUrl: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('browser:external-url', handler);
      return () => transport.off('browser:external-url', handler);
    },
  },
  onAppOpenSession: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('app:open-session', handler);
    return () => transport.off('app:open-session', handler);
  },
  notifications: {
    list: () => transport.invoke('notification:list'),
    create: (notification, options) => transport.invoke('notification:create', { notification, options }),
    importLegacy: (notifications) => transport.invoke('notification:import-legacy', { notifications }),
    markRead: (id) => transport.invoke('notification:mark-read', { id }),
    markAllRead: () => transport.invoke('notification:mark-all-read'),
    remove: (id) => transport.invoke('notification:remove', { id }),
    clear: () => transport.invoke('notification:clear'),
    onChanged: (callback) => {
      const handler = (payload) => callback(payload);
      transport.on('notification:changed', handler);
      return () => transport.off('notification:changed', handler);
    },
  },
  decisions: {
    respond: (payload) => transport.invoke('decision:respond', payload),
  },
  workspace: {
    writeFile: (payload) => transport.invoke('workspace.write-file', payload),
  },
  workspaceVersions: {
    status: (payload) => transport.invoke('workspace-versions:status', payload),
    save: (payload) => transport.invoke('workspace-versions:save', payload),
    files: (payload) => transport.invoke('workspace-versions:files', payload),
    previewFile: (payload) => transport.invoke('workspace-versions:preview-file', payload),
    previewRestore: (payload) => transport.invoke('workspace-versions:preview-restore', payload),
    restore: (payload) => transport.invoke('workspace-versions:restore', payload),
  },
  shell: {
    openFile: (filePath) => transport.invoke('shell.open-file', filePath),
    openExternal: (url) => transport.invoke('shell.open-external', url),
    showItemInFolder: (filePath) => transport.invoke('shell.show-item-in-folder', filePath),
  },
  fs: {
    getPathForFile: (file) => platform.getPathForFile?.(file) || '',
    getImageBase64: (path) => transport.invoke('fs:getImageBase64', { path }),
    getFileMetadata: (path) => transport.invoke('fs:getFileMetadata', { path }),
    getHomeDir: () => transport.invoke('fs:getHomeDir'),
    createTempFile: (fileName) => transport.invoke('fs:createTempFile', { fileName }),
    writeFile: (path, data) => transport.invoke('fs:writeFile', { path, data }),
    getAppIcon: () => transport.invoke('fs:getAppIcon'),
    saveImageToWorkspace: (sessionId, fileName, data) => transport.invoke('workspace:saveImage', { sessionId, fileName, data }),
  },
  listBackgroundTasks: (payload) => transport.invoke('agent:list-background-tasks', payload),
  getTaskOutput: (payload) => transport.invoke('agent:task-output', payload),
  killTask: (payload) => transport.invoke('agent:kill-task', payload),
  onBackgroundTasks: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:background-tasks', handler);
    return () => transport.off('agent:background-tasks', handler);
  },
  onEvent: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:event', handler);
    return () => transport.off('agent:event', handler);
  },
  onState: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:state', handler);
    return () => transport.off('agent:state', handler);
  },
  onPermission: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:permission', handler);
    return () => transport.off('agent:permission', handler);
  },
  onQuestionRequest: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:question-request', handler);
    return () => transport.off('agent:question-request', handler);
  },
  onQuestionResolved: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:question-resolved', handler);
    return () => transport.off('agent:question-resolved', handler);
  },
  onSessionMeta: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:session-meta', handler);
    return () => transport.off('agent:session-meta', handler);
  },
  onSessionHistory: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:session-history', handler);
    return () => transport.off('agent:session-history', handler);
  },
  onSessionRemoved: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:session-removed', handler);
    return () => transport.off('agent:session-removed', handler);
  },
  onWorkspaceChanged: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('workspace:changed', handler);
    return () => transport.off('workspace:changed', handler);
  },
  onAppsChanged: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('app:changed', handler);
    return () => transport.off('app:changed', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:settings-changed', handler);
    return () => transport.off('agent:settings-changed', handler);
  },
  onProjectsChanged: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('project:changed', handler);
    return () => transport.off('project:changed', handler);
  },
  onAssistantsChanged: (callback) => {
    const handler = (payload) => callback(payload);
    transport.on('agent:assistants-changed', handler);
    return () => transport.off('agent:assistants-changed', handler);
  },
  listCoordinatorTasks: (sessionId) => transport.invoke('coordinator:list-tasks', { sessionId }),
  // Worker (sub-agent) results from SDK subagents directory
  getWorkerResults: (payload) => transport.invoke('agent:get-worker-results', payload),
  setWorkerSummaries: (payload) => transport.invoke('agent:set-worker-summaries', payload),
  // Cron task management
  cronList: () => transport.invoke('cron:list'),
  cronDelete: (taskId) => transport.invoke('cron:delete', { taskId }),
  // Assistant management
  getInstalledAssistants: () => transport.invoke('agent:getInstalledAssistants'),
  getAssistantContext: (assistantName) => transport.invoke('agent:getAssistantContext', { assistantName }),
  getSkillInfosByIds: (skillIds) => transport.invoke('agent:getSkillInfosByIds', { skillIds }),
  // Log management
  logGetPath: () => transport.invoke('log:get-path'),
  logDownload: () => transport.invoke('log:download'),
  logWrite: (payload) => transport.invoke('log:write', payload),

  // Update state and operations are owned by the main process.
  update: {
    getState: () => transport.invoke('update:get-state'),
    check: () => transport.invoke('update:check'),
    download: (params) => transport.invoke('update:download', params),
    cancel: () => transport.invoke('update:cancel'),
    dismiss: (params) => transport.invoke('update:dismiss', params),
    setAutoDownload: (params) => transport.invoke('update:set-auto-download', params),
    openDownloaded: (params) => transport.invoke('update:open-downloaded', params),
    showDownloaded: (params) => transport.invoke('update:show-downloaded', params),
    install: (params) => transport.invoke('update:install', params),
    openReleasePage: () => transport.invoke('update:open-release-page'),
    onOpenModal: (callback) => {
      const handler = () => callback();
      transport.on('update:open-modal', handler);
      return () => transport.off('update:open-modal', handler);
    },
    onState: (callback) => {
      const handler = (state) => callback(state);
      transport.on('update:state', handler);
      return () => transport.off('update:state', handler);
    },
  },
  };
}
