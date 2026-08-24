export type PendingPlanApproval = {
  kind: 'plan';
  originalPrompt: string;
  plan: string;
  requestedAt: number;
};

export type SessionSummary = {
  id: string;
  title: string;
  agentMode?: 'local' | 'remote-direct';
  composerIntent?: 'chat' | 'coordinator';
  workspace: string;
  createdAt: number;
  updatedAt: number;
  busy: boolean;
  messageCount: number;
  sessionId: string | null;
  preview: string;
  pendingPlanApproval?: PendingPlanApproval | null;
  resumeReadOnlyReason?: string | null;
  assistantName?: string | null;
};

export type SessionDetail = SessionSummary & {
  history: AgentEvent[];
  workerSummariesJson: string | null;
  todos?: SessionTodo[];
};

export type AgentEvent = Record<string, any>;

export type SessionTodoStatus = 'pending' | 'in_progress' | 'completed';

export type SessionTodo = {
  id: string;
  content: string;
  status: SessionTodoStatus;
  activeForm?: string;
};

export type AskUserQuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

export type AskUserQuestion = {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
};

export type AskUserQuestionRequest = {
  requestId: string;
  sessionId: string;
  input: {
    questions?: AskUserQuestion[];
    metadata?: Record<string, unknown>;
  };
  requestedAt: number;
};

export type AskUserQuestionAnnotations = Record<string, {
  preview?: string;
  notes?: string;
}>;

export type PairedUser = {
  userId: string | number
  displayName: string
  pairedAt: number
}

export type PairingState = {
  code?: string | null
  expiresAt?: number | null
  createdAt?: number | null
}

export type AdapterFileConfig = {
  serverUrl?: string
  defaultProjectDir?: string
  pairing?: PairingState
  telegram?: {
    botToken?: string
    allowedUsers?: number[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
  }
  feishu?: {
    appId?: string
    appSecret?: string
    encryptKey?: string
    verificationToken?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    streamingCard?: boolean
  }
}

export type McpServerConfig =
  | {
      type?: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      type: 'http' | 'sse';
      url: string;
      headers?: Record<string, string>;
    };

export type McpServerEntry = {
  name: string;
  enabled: boolean;
  config: McpServerConfig;
  updatedAt?: number;
};

export type McpSettingsPayload = {
  servers: McpServerEntry[];
  configPath: string;
  agentConfigPath: string;
  resetSessionCount?: number;
  skippedBusySessionCount?: number;
};

export type DesktopSettings = {
  agentMode: 'local' | 'remote-direct';
  localEnabled: boolean;
  remoteEnabled: boolean;
  bypassPermissions: boolean;
  model: string;
  maxTurns: number;
  appendSystemPrompt: string;
  thinkingMode: 'adaptive' | 'enabled' | 'disabled';
  thinkingBudgetTokens: number;
  url: string;
  apiKey: string;
  image: {
    provider: string;
    url: string;
    apiKey: string;
    model: string;
  };
  sessionMemory?: {
    enabled?: boolean;
    compactEnabled?: boolean;
    minimumMessageTokensToInit?: number;
    minimumTokensBetweenUpdate?: number;
    toolCallsBetweenUpdates?: number;
  };
  managedRuntimes?: {
    node?: boolean;
    python?: boolean;
    git?: boolean;
  };
  appearance: {
    themeMode: 'dark' | 'light' | 'system';
    cssThemeId: 'default' | 'grid-theme' | 'dot-theme' | 'gradient-theme';
  };
  mcp?: {
    version?: number;
    servers?: Record<string, {
      enabled?: boolean;
      config?: McpServerConfig;
      updatedAt?: number;
    }>;
  };
  remoteDirect?: {
    serverUrl: string;
    credentialMode: 'password' | 'api-key';
    userEmail: string;
    userPassword: string;
    apiKey: string;
    workspace: string;
    profileMode: 'session' | 'user';
  };
  remoteDirectServerUrl: string;
  remoteDirectCredentialMode: 'password' | 'api-key';
  // Legacy key name; stores either username or email for password login.
  remoteDirectUserEmail: string;
  remoteDirectUserPassword: string;
  remoteDirectApiKey: string;
  remoteDirectWorkspace: string;
  remoteDirectProfileMode: 'session' | 'user';
  settingsPath: string;
  settingsExists: boolean;
  settingsLoaded: boolean;
  settingsParseError: string;
  appearancePersisted?: boolean;
  skippedSessionCount?: number;
  coordinatorMode?: boolean;
};

export type ManagedRuntimeEntry = {
  path?: string;
  installed?: boolean;
  skipped?: boolean;
  resourceAvailable?: boolean;
};

export type ManagedRuntimeStatus = {
  node: ManagedRuntimeEntry;
  python: ManagedRuntimeEntry;
  git: ManagedRuntimeEntry;
  registryPath: string;
  resourcesRoot: string;
  installing?: boolean;
};

export type StoredApp = {
  id?: string;
  kind?: 'plugin-app';
  name: string;
  displayName?: string;
  title: string;
  description: string;
  icon: string;
  width: number;
  height: number;
  resizable: boolean;
  createdAt: number;
  updatedAt: number;
  versionCount?: number;
  latestVersionId?: string | null;
  latestVersion?: string | null;
  currentVersionId?: string | null;
  currentVersion?: string | null;
  publishedVersion?: string | null;
  extensionDependencies?: Record<string, string>;
  capabilitySummary?: string[];
  runtimeStatus?: {
    state: 'ready' | 'missing-extension' | 'permission-required' | 'error';
    missingExtensions?: string[];
    error?: string;
  };
};

export type AppVersion = {
  id: string;
  version: string;
  createdAt: number;
  reason: string;
  note: string;
  description: string;
  width: number;
  height: number;
  resizable: boolean;
  isCurrent?: boolean;
  isLatest?: boolean;
  kind?: 'plugin-app';
  extensionLock?: Record<string, unknown>;
  checksumStatus?: string;
};

export type FileTreeNode = {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
  children?: FileTreeNode[];
};

export type WorkspacePreviewContentType =
  | 'markdown'
  | 'html'
  | 'image'
  | 'pdf'
  | 'diff'
  | 'word'
  | 'excel'
  | 'ppt'
  | 'url'
  | 'text'
  | 'code'
  | 'unsupported';

export type WorkspacePreviewData = {
  path: string;
  relativePath: string;
  content: string;
  size?: number;
  truncated?: boolean;
  contentType: WorkspacePreviewContentType;
  language?: string;
  mimeType?: string;
  metadata?: Record<string, unknown>;
};

export type PreviewHistoryTarget = {
  contentType: WorkspacePreviewContentType;
  filePath?: string;
  workspace?: string;
  fileName?: string;
  title?: string;
  language?: string;
  conversationId?: string;
};

export type PreviewSnapshotInfo = {
  id: string;
  label: string;
  createdAt: number;
  size: number;
  contentType: WorkspacePreviewContentType;
  fileName?: string;
  filePath?: string;
};

declare namespace JSX {
  interface IntrinsicElements {
    webview: any;
  }
}

export type BackgroundTaskInfo = {
  id: string;
  description: string;
  command: string;
  kind: 'shell' | 'monitor';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed';
  isBackgrounded: boolean;
  startTime: number | null;
  endTime: number | null;
  exitCode: number | null;
};

declare global {
  interface Window {
    agentDesktop: {
      // 通用 IPC 方法
      ipcInvoke: (channel: string, payload?: any) => Promise<any>;
      ipcOn: (channel: string, callback: (payload: any) => void) => void;
      ipcOff: (channel: string, handler: any) => void;

      getStatus: () => Promise<any>;
      getManagedRuntimeStatus: () => Promise<ManagedRuntimeStatus>;
      ensureManagedRuntimes: (payload?: { node?: boolean; python?: boolean; git?: boolean }) => Promise<Record<string, unknown>>;
      getAuthDebug: () => Promise<any>;
      getSettings: () => Promise<DesktopSettings>;
      updateSettings: (payload: Partial<DesktopSettings>) => Promise<DesktopSettings>;
      listMcpServers: () => Promise<McpSettingsPayload>;
      upsertMcpServer: (payload: { previousName?: string; name: string; enabled: boolean; config: McpServerConfig }) => Promise<McpSettingsPayload>;
      removeMcpServer: (payload: { name: string }) => Promise<McpSettingsPayload>;
      setMcpServerEnabled: (payload: { name: string; enabled: boolean }) => Promise<McpSettingsPayload>;
      getAdapterConfig: () => Promise<AdapterFileConfig>;
      updateAdapterConfig: (patch: Partial<AdapterFileConfig>) => Promise<AdapterFileConfig>;
      listSessions: () => Promise<SessionSummary[]>;
      createSession: (payload?: { workspace?: string; title?: string; assistant_name?: string }) => Promise<{ summary: SessionSummary; detail: SessionDetail }>;
      getSession: (payload: { sessionId: string }) => Promise<SessionDetail>;
      updateSession: (payload: { sessionId: string; title: string }) => Promise<SessionDetail>;
      deleteSession: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      pickDirectory: () => Promise<string | null>;
      pickFiles: () => Promise<Array<{ name: string; path: string }>>;
      setSessionWorkspace: (payload: { sessionId: string; workspace: string }) => Promise<SessionDetail>;
      openWorkspace: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      copyFileToWorkspace: (payload: { sessionId: string; sourcePath: string; fileName: string }) => Promise<{ path: string } | { error: string }>;
      send: (payload: {
        sessionId: string;
        prompt: string;
        skills?: Array<{ name: string; displayName?: string; source?: string }>;
        mode?: 'chat' | 'plan' | 'coordinator';
        appName?: string;
        files?: string[];
        coordinatorMode?: boolean;
      }) => Promise<any>;
      approvePlan: (payload: { sessionId: string }) => Promise<any>;
      rejectPlan: (payload: { sessionId: string }) => Promise<any>;
      answerQuestion: (payload: {
        requestId: string;
        sessionId: string;
        answers: Record<string, string>;
        annotations?: AskUserQuestionAnnotations;
      }) => Promise<{ ok: boolean }>;
      rejectQuestion: (payload: {
        requestId: string;
        sessionId: string;
        message?: string;
      }) => Promise<{ ok: boolean }>;
      abort: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      listApps: () => Promise<StoredApp[]>;
      listAppVersions: (payload: { name: string }) => Promise<AppVersion[]>;
      launchApp: (payload: { name: string }) => Promise<{ ok: boolean; error?: string }>;
      openEmbeddedApp: (payload: { name: string }) => Promise<{
        ok: boolean;
        error?: string;
        embedId?: string;
        url?: string;
        preload?: string;
        app?: {
          id: string;
          name: string;
          displayName: string;
          description: string;
        };
      }>;
      attachEmbeddedApp: (payload: { embedId: string; webContentsId: number }) => Promise<{ ok: boolean; error?: string }>;
      closeEmbeddedApp: (payload: { embedId: string }) => Promise<{ ok: boolean; error?: string }>;
      rollbackApp: (payload: { name: string; versionId: string }) => Promise<{ ok: boolean; app: StoredApp; error?: string }>;
      deleteApp: (payload: { name: string }) => Promise<{ ok: boolean; error?: string }>;
      saveApp: (payload: { sessionId: string; launch?: boolean }) => Promise<{ ok: boolean; app?: StoredApp; error?: string }>;
      listWorkspaceDir: (payload: { sessionId: string; dirPath?: string }) => Promise<any>;
      readWorkspaceFile: (payload: { sessionId: string; filePath: string }) => Promise<WorkspacePreviewData>;
      document: {
        convert: (payload: { filePath: string; to: 'libreoffice-pdf' | 'markdown' | 'word-html' | 'excel-json' | 'ppt-json' | 'pptx-arraybuffer' }) => Promise<any>;
        libreOffice: {
          isAvailable: () => Promise<boolean>;
        };
      };
      libreOffice: {
        checkInstalled: () => Promise<any>;
        install: () => Promise<any>;
        installFromLocalFile: (payload: { filePath: string }) => Promise<any>;
        uninstall: () => Promise<any>;
        getInstallState: () => Promise<any>;
        onInstallProgress: (callback: (payload: { phase: string; percent?: number }) => void) => () => void;
        onInstallResult: (callback: (payload: { success: boolean; msg?: string }) => void) => () => void;
      };
      previewHistory: {
        list: (payload: { target: PreviewHistoryTarget }) => Promise<PreviewSnapshotInfo[]>;
        save: (payload: { target: PreviewHistoryTarget; content: string }) => Promise<PreviewSnapshotInfo>;
        getContent: (payload: { target: PreviewHistoryTarget; snapshotId: string }) => Promise<{ snapshot: PreviewSnapshotInfo; content: string } | null>;
      };
      preview: {
        open: (payload: { content: string; contentType: WorkspacePreviewContentType; metadata?: Record<string, unknown> }) => Promise<{ ok: boolean }>;
        close: () => Promise<{ ok: boolean }>;
        onOpen: (callback: (payload: { content: string; contentType: WorkspacePreviewContentType; metadata?: Record<string, unknown> }) => void) => () => void;
      };
      browser: {
        onOpen: (callback: (payload: { url: string; sessionId?: string | null }) => void) => () => void;
      };
      workspace: {
        writeFile: (payload: { sessionId: string; filePath: string; content: string }) => Promise<WorkspacePreviewData>;
      };
      shell: {
        openFile: (filePath: string) => Promise<string>;
        openExternal: (url: string) => Promise<{ ok: boolean }>;
        showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
      };
      fs: {
        getImageBase64: (path: string) => Promise<string | null>;
        getFileMetadata: (path: string) => Promise<{ size: number } | null>;
        getHomeDir: () => Promise<string>;
        createTempFile: (fileName: string) => Promise<string | null>;
        writeFile: (path: string, data: number[]) => Promise<boolean>;
        saveImageToWorkspace: (sessionId: string, fileName: string, data: number[]) => Promise<{ path: string } | { error: string }>;
        getAppIcon: () => Promise<string | null>;
      };
      listBackgroundTasks: (payload: { sessionId: string }) => Promise<{ tasks: BackgroundTaskInfo[] }>;
      getTaskOutput: (payload: { sessionId: string; taskId: string; maxBytes?: number }) => Promise<{ content: string; truncated: boolean }>;
      killTask: (payload: { sessionId: string; taskId: string }) => Promise<{ ok: boolean; error?: string }>;
      onBackgroundTasks: (callback: (payload: { sessionId: string; tasks: BackgroundTaskInfo[] }) => void) => () => void;
      onEvent: (callback: (payload: any) => void) => () => void;
      onState: (callback: (payload: any) => void) => () => void;
      onPermission: (callback: (payload: any) => void) => () => void;
      onQuestionRequest: (callback: (payload: AskUserQuestionRequest) => void) => () => void;
      onSessionMeta: (callback: (payload: SessionSummary) => void) => () => void;
      onSessionHistory: (callback: (payload: {
        sessionId: string;
        summary?: SessionSummary;
        history?: AgentEvent[];
        todos?: SessionTodo[];
      }) => void) => () => void;
      onSessionRemoved: (callback: (payload: { sessionId: string }) => void) => () => void;
      onWorkspaceChanged: (callback: (payload: any) => void) => () => void;
      onAppsChanged: (callback: (payload: any) => void) => () => void;
      onSettingsChanged: (callback: (payload: DesktopSettings) => void) => () => void;
      listCoordinatorTasks: (sessionId?: string) => Promise<{ tasks: CoordinatorTask[] }>;
      getWorkerResults: (payload: { sessionId: string }) => Promise<{ results: Record<string, WorkerSubagentResult> }>;
      setWorkerSummaries: (payload: { sessionId: string; workerSummariesJson: string | null }) => Promise<{ ok: boolean }>;
      cronList: () => Promise<CronTask[]>;
      cronDelete: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
      getInstalledAssistants: () => Promise<{ success: boolean; data?: InstalledAssistant[]; error?: string }>;
      getRemoteInstalledAssistants: () => Promise<{ success: boolean; data?: InstalledAssistant[]; error?: string }>;
      getAssistantContext: (assistantName: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      getSkillInfosByIds: (skillIds: string[]) => Promise<{ success: boolean; data?: Array<{ name: string; path: string }>; error?: string }>;
      logWrite: (payload: { level?: string; category?: string; message: string; data?: unknown }) => Promise<void>;
      update: {
        check: (params?: { includePrerelease?: boolean }) => Promise<{ success: boolean; data?: UpdateCheckResult; msg?: string }>;
        download: (params: { url: string; fileName?: string }) => Promise<{ success: boolean; data?: { downloadId: string; filePath: string }; msg?: string }>;
        onOpenModal: (callback: () => void) => () => void;
        onDownloadProgress: (callback: (evt: UpdateDownloadProgressEvent) => void) => () => void;
      };
      autoUpdate: {
        check: (params?: { includePrerelease?: boolean }) => Promise<{ success: boolean; data?: { updateInfo?: { version: string; releaseDate?: string; releaseNotes?: string } }; msg?: string }>;
        download: () => Promise<{ success: boolean; msg?: string }>;
        quitAndInstall: () => Promise<void>;
        getDownloadedFilePath: () => Promise<{ success: boolean; data?: { path: string | null } }>;
        getMirrorStatus: () => Promise<{ success: boolean; data?: { useMirror: boolean; reason: string } }>;
        onStatus: (callback: (evt: AutoUpdateStatus) => void) => () => void;
      };
    };
  }
}

export type CoordinatorTask = {
  id: string;
  agentId: string | null;
  name: string;
  status: string;
  isIdle: boolean;
  description: string;
  color: string;
};

export type CronTask = {
  id: string;
  cron: string;
  prompt: string;
  createdAt: number;
  lastFiredAt?: number;
  recurring?: boolean;
  permanent?: boolean;
};

export type WorkerSubagentResult = {
  resultText: string | null;
  status: string;
  events: any[];
};

export type InstalledAssistant = {
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  emoji: string;
  category: string;
  categories: string[];
  version: string;
  source: string;
  isBuiltin: boolean;
  isHubInstalled: boolean;
  tag: string;
  enabled: boolean;
  skills: string[];
  enabledSkills: string[];
};

// Update types
export type UpdateReleaseInfo = {
  tagName: string;
  version: string;
  name?: string;
  body?: string;
  htmlUrl: string;
  publishedAt?: string;
  prerelease: boolean;
  draft: boolean;
  assets: GitHubReleaseAsset[];
  recommendedAsset?: GitHubReleaseAsset;
};

export type GitHubReleaseAsset = {
  name: string;
  url: string;
  size: number;
  contentType?: string;
};

export type UpdateCheckResult = {
  currentVersion: string;
  updateAvailable: boolean;
  latest?: UpdateReleaseInfo;
};

export type UpdateDownloadProgressEvent = {
  downloadId: string;
  status: 'starting' | 'downloading' | 'completed' | 'error' | 'cancelled';
  receivedBytes: number;
  totalBytes?: number;
  percent?: number;
  bytesPerSecond?: number;
  filePath?: string;
  error?: string;
};

export type AutoUpdateStatus = {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'cancelled';
  version?: string;
  releaseDate?: string;
  releaseNotes?: string;
  progress?: {
    bytesPerSecond: number;
    percent: number;
    transferred: number;
    total: number;
  };
  error?: string;
  downloadedFilePath?: string;
};

export {};
