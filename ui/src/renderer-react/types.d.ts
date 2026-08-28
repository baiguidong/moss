import type { AppNotification, NewAppNotification } from './lib/app-notifications';

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
  projectId?: string | null;
  projectName?: string | null;
  runtimeMode?: 'normal' | 'coordinator' | 'project-coordinator';
  projectSessionStatus?: ProjectTaskStatus | null;
  completedAt?: number | null;
  projectConclusion?: string;
  projectMemoryVersion?: number;
  connectorIds?: string[];
  sessionKind?: 'chat' | 'cron';
  originChannel?: 'desktop' | 'feishu' | 'cron';
  sourceSessionId?: string | null;
  sourceSessionTitle?: string | null;
  cronTaskId?: string | null;
  isSubAgent?: boolean;
  parentSessionId?: string | null;
  subagentStatus?: 'running' | 'completed' | 'failed' | null;
};

export type SessionDetail = SessionSummary & {
  history: AgentEvent[];
  workerSummariesJson: string | null;
  tasks?: SessionTask[];
};

export type AgentEvent = Record<string, any>;

export type SessionTaskStatus = 'pending' | 'in_progress' | 'completed';

export type SessionTask = {
  id: string;
  subject: string;
  description: string;
  status: SessionTaskStatus;
  activeForm?: string;
  owner?: string | null;
  blockedBy: string[];
};

export type ProjectTaskStatus = 'working' | 'waiting_for_user' | 'completed' | 'failed' | 'stopped';

export type ProjectTask = {
  id: string;
  projectId: string;
  sessionId: string;
  subject: string;
  description: string;
  status: ProjectTaskStatus;
  workerCount: number;
  activeWorkerCount: number;
  attentionCount: number;
  conclusion?: string;
  outputAssetIds: string[];
  completedAt?: number | null;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description?: string;
  nameSuggestion?: string;
  instructions?: string;
  connectorIds?: string[];
  expertIds?: string[];
  skillIds?: string[];
};

export type Project = {
  id: string;
  name: string;
  instructions: string;
  templateId?: string | null;
  connectorIds: string[];
  expertIds: string[];
  skillIds: string[];
  decisionPolicy: {
    mode: 'auto_all' | 'recommend' | 'auto_low_risk';
  };
  createdAt: number;
  updatedAt: number;
  archivedAt?: number | null;
  path?: string;
  workspace?: string;
  assetCount?: number;
  taskCount?: number;
  sessionCount?: number;
  pendingDecisionCount?: number;
};

export type ConnectorType = 'mcp' | 'cli' | 'unknown';

export type ConnectorCredentialField = {
  key: string;
  label: string;
  labelEn?: string;
  placeholder?: string;
  placeholderEn?: string;
  description?: string;
  descriptionEn?: string;
  type: 'text' | 'password';
  required: boolean;
  defaultValue?: string;
};

export type ConnectorCredentialProvision = {
  url: string;
  targetField: string;
  responseField: string;
  label: string;
  labelEn?: string;
  validation?: {
    url: string;
    headers?: Record<string, string>;
  };
};

export type ConnectorCredentialSchema = {
  title: string;
  titleEn?: string;
  description?: string;
  descriptionEn?: string;
  docUrl?: string;
  docLabel?: string;
  docLabelEn?: string;
  fields: ConnectorCredentialField[];
  provision?: ConnectorCredentialProvision;
};

export type ConnectorCatalogItem = {
  id: string;
  source: string;
  name: string;
  nameEn?: string;
  icon?: string;
  description?: string;
  descriptionEn?: string;
  type: ConnectorType;
  authMode?: string;
  providerId?: string;
  minWorkbuddyVersion?: string;
  visibleIn?: string[];
  examples?: string[];
  hasMcp?: boolean;
  hasCli?: boolean;
  hasSkills?: boolean;
  hasCredentialSchema?: boolean;
  requiresCliSetup?: boolean;
  credentialSchema?: ConnectorCredentialSchema | null;
  configuredFields?: string[];
  credentialsConfigured?: boolean;
  installed?: boolean;
  enabled?: boolean;
  connected?: boolean;
  setupStatus?: string;
  setupMessage?: string;
  setupUpdatedAt?: string;
  installedAt?: string | null;
  mcpServerNames?: string[];
  path?: string;
  skillRoot?: string;
  skillName?: string;
};

export type InstalledConnector = ConnectorCatalogItem & {
  installedAt: string;
  path: string;
};

export type ProjectAsset = {
  id: string;
  name: string;
  fileName: string;
  path: string;
  relativePath: string;
  size: number;
  mimeType?: string;
  sourceType?: 'upload' | 'session_output' | string;
  sourceSessionId?: string | null;
  sourcePath?: string | null;
  contentHash?: string | null;
  provenance?: Array<{
    sourceSessionId?: string | null;
    sourcePath?: string | null;
    recordedAt: number;
  }>;
  description?: string;
  createdAt: number;
  updatedAt: number;
};

export type ProjectEvent = {
  id: string;
  type: string;
  summary: string;
  actor: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  createdAt: number;
};

export type ProjectDecision = {
  id: string;
  projectId: string;
  requestId: string;
  toolUseId?: string | null;
  taskId?: string | null;
  parentSessionId: string;
  originSessionId: string;
  originAgentId?: string | null;
  originAgentType?: string | null;
  originLabel: string;
  kind: 'preference' | 'clarification' | 'external_action' | 'authorization' | 'tool_permission';
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'resolved' | 'rejected' | 'expired';
  blocking: boolean;
  questions: AskUserQuestion[];
  recommendation?: { answers: Record<string, string>; reason: string } | null;
  resolution?: {
    answers: Record<string, string>;
    source: 'user' | 'policy' | 'system';
    note: string;
  } | null;
  createdAt: number;
  resolvedAt?: number | null;
  expiresAt?: number | null;
};

export type ProjectMemory = {
  version: number;
  updatedAt: number | null;
  lastSessionId: string | null;
  finalizedSessionCount: number;
  overview: string;
  overviewPath: string;
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
  projectId?: string | null;
  decisionId?: string | null;
  originSessionId?: string;
  originLabel?: string;
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
  feishu?: {
    appId?: string
    appSecret?: string
    encryptKey?: string
    verificationToken?: string
    allowedUsers?: string[]
    pairedUsers?: PairedUser[]
    defaultWorkDir?: string
    streamingCard?: boolean
    runLocation?: 'desktop' | 'server'
    serverDeployment?: {
      serverUrl: string
      credentialMode: 'password' | 'api-key'
      userEmail: string
      workspace: string
      configFingerprint: string
    }
  }
}

export type FeishuAdapterStatus = {
  status: 'stopped' | 'running' | 'disabled' | 'error';
  pid: number | null;
  bridgeReady: boolean;
  error?: string | null;
  transportConnected: boolean;
  transportUpdatedAt?: number | null;
  transportError?: string | null;
  location: 'desktop' | 'server';
  enabled?: boolean;
  pairedUsers?: PairedUser[];
  pairing?: PairingState;
};

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
    autoCollapseToolCalls: boolean;
  };
  mcp?: {
    version?: number;
    servers?: Record<string, {
      enabled?: boolean;
      config?: McpServerConfig;
      updatedAt?: number;
    }>;
  };
  skillHub?: {
    apiBaseUrl?: string;
  };
  expertHub?: {
    baseUrl?: string;
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

export type BrowserConnectorAuthContext = {
  connectorId: string;
  serverName: string;
  displayName?: string;
  tokenParam?: string;
  allowedHosts?: string[];
};

export type BrowserMcpAuthContext = {
  serverName: string;
  displayName?: string;
};

export type BrowserTabState = {
  id: string;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  devToolsOpen: boolean;
  isNativeBlank: boolean;
  error: string | null;
  connectorAuth?: BrowserConnectorAuthContext | null;
  mcpAuth?: BrowserMcpAuthContext | null;
};

export type BrowserState = {
  tabs: BrowserTabState[];
  activeTabId: string;
};

export type BrowserAuthNavigation = {
  id: string;
  sessionId: string;
  tabId: string;
  url: string;
  connectorAuth: BrowserConnectorAuthContext | null;
  mcpAuth: BrowserMcpAuthContext | null;
};

export type BrowserTabTarget = {
  sessionId?: string | null;
  tabId?: string;
};

export type BrowserOpenTabPayload = {
  sessionId?: string | null;
  url?: string;
  connectorAuth?: BrowserConnectorAuthContext | null;
  mcpAuth?: BrowserMcpAuthContext | null;
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

export type AuditSeverity = 'low' | 'medium' | 'high' | 'critical';
export type AuditFindingStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';

export type AuditSessionRecord = {
  id: string;
  title: string;
  workspace: string;
  projectId: string | null;
  assistantName: string | null;
  sessionKind: 'chat' | 'cron';
  isSubAgent: boolean;
  sourceCreatedAt: number;
  sourceUpdatedAt: number;
  auditedAt: number;
  latestRunId: string;
  eventCount: number;
  toolCallCount: number;
  findingCount: number;
  completeness: 'complete' | 'partial';
  sourcePresent: boolean;
};

export type AuditToolCallRecord = {
  id: string;
  sessionId: string;
  sessionTitle: string;
  toolUseId: string;
  parentToolUseId: string | null;
  toolName: string;
  input: unknown;
  result: string;
  status: 'success' | 'error' | 'unknown';
  isError: boolean;
  startedAt: number | null;
  completedAt: number | null;
  orderIndex: number;
};

export type AuditFindingRecord = {
  id: string;
  runId: string;
  sessionId: string;
  sessionTitle: string;
  toolCallId: string | null;
  toolName: string | null;
  toolUseId: string | null;
  toolInput: unknown;
  toolResult: string;
  toolStatus: 'success' | 'error' | 'unknown' | null;
  ruleId: string;
  ruleName: string;
  ruleVersion: number;
  severity: AuditSeverity;
  title: string;
  detail: string;
  evidence: unknown;
  status: AuditFindingStatus;
  fingerprint: string;
  createdAt: number;
  reportedAt: number | null;
};

export type AuditAlert = {
  findingId: string;
  fingerprint: string;
  severity: 'high' | 'critical';
  title: string;
  detail: string;
  sessionId: string;
  sessionTitle: string;
  toolUseId: string | null;
  toolName: string | null;
  ruleName: string;
  createdAt: number;
};

export type AuditRuleRecord = {
  id: string;
  name: string;
  description: string;
  severity: AuditSeverity;
  enabled: boolean;
  config: { patterns?: string[]; minimumFailures?: number; allowedPaths?: string[] };
  version: number;
  updatedAt: number;
};

export type AuditRunRecord = {
  id: string;
  status: 'running' | 'completed' | 'failed';
  scope: { kind?: string; sessionIds?: string[] };
  ruleSnapshot: AuditRuleRecord[];
  startedAt: number;
  completedAt: number | null;
  sessionCount: number;
  toolCallCount: number;
  findingCount: number;
  error: string | null;
};

export type AuditDashboardPayload = {
  summary: {
    sessionCount: number;
    toolCallCount: number;
    findingCount: number;
    openFindingCount: number;
    criticalFindingCount: number;
    incompleteSessionCount: number;
    latestCompletedAt: number;
    rulesStale: boolean;
    running: boolean;
  };
  sessions: AuditSessionRecord[];
  tools: AuditToolCallRecord[];
  findings: AuditFindingRecord[];
  rules: AuditRuleRecord[];
  runs: AuditRunRecord[];
};

declare global {
  interface Window {
    agentDesktop: {
      // 通用 IPC 方法
      ipcInvoke: (channel: string, payload?: any) => Promise<any>;
      ipcOn: (channel: string, callback: (payload: any) => void) => any;
      ipcOff: (channel: string, handler: any) => void;

      getStatus: () => Promise<any>;
      getManagedRuntimeStatus: () => Promise<ManagedRuntimeStatus>;
      ensureManagedRuntimes: (payload?: { node?: boolean; python?: boolean; git?: boolean }) => Promise<Record<string, unknown>>;
      getAuthDebug: () => Promise<any>;
      getSettings: () => Promise<DesktopSettings>;
      updateSettings: (payload: Partial<DesktopSettings>) => Promise<DesktopSettings>;
      authenticateRemoteServer: (payload: { serverUrl: string }) => Promise<DesktopSettings>;
      cancelRemoteServerAuthentication: () => Promise<{ canceled: boolean }>;
      listMcpServers: () => Promise<McpSettingsPayload>;
      upsertMcpServer: (payload: { previousName?: string; name: string; enabled: boolean; config: McpServerConfig }) => Promise<McpSettingsPayload>;
      removeMcpServer: (payload: { name: string }) => Promise<McpSettingsPayload>;
      setMcpServerEnabled: (payload: { name: string; enabled: boolean }) => Promise<McpSettingsPayload>;
      authenticateMcpServer: (payload: { name: string; sessionId?: string | null }) => Promise<McpSettingsPayload>;
      submitMcpAuthCallback: (payload: { name: string; callbackUrl: string }) => Promise<{ ok: boolean }>;
      clearMcpServerAuth: (payload: { name: string }) => Promise<McpSettingsPayload>;
      getAdapterConfig: () => Promise<AdapterFileConfig>;
      updateAdapterConfig: (patch: Partial<AdapterFileConfig>) => Promise<AdapterFileConfig>;
      getAdapterStatus: () => Promise<FeishuAdapterStatus>;
      listProjectTemplates: () => Promise<ProjectTemplate[]>;
      listProjects: (payload?: { includeArchived?: boolean }) => Promise<Project[]>;
      getProject: (payload: { projectId: string }) => Promise<Project>;
      createProject: (payload: {
        name: string;
        instructions?: string;
        templateId?: string | null;
        connectorIds?: string[];
        expertIds?: string[];
        skillIds?: string[];
        decisionPolicy?: Project['decisionPolicy'];
      }) => Promise<Project>;
      updateProject: (payload: { projectId: string; updates: Partial<Project> }) => Promise<Project>;
      archiveProject: (payload: { projectId: string }) => Promise<Project>;
      listProjectAssets: (payload: { projectId: string }) => Promise<ProjectAsset[]>;
      listProjectEvents: (payload: { projectId: string }) => Promise<ProjectEvent[]>;
      listProjectDecisions: (payload: { projectId: string }) => Promise<ProjectDecision[]>;
      resolveProjectDecision: (payload: {
        projectId: string;
        decisionId: string;
        answers: Record<string, string>;
        annotations?: AskUserQuestionAnnotations;
      }) => Promise<ProjectDecision>;
      rejectProjectDecision: (payload: {
        projectId: string;
        decisionId: string;
        message?: string;
      }) => Promise<ProjectDecision>;
      getProjectMemory: (payload: { projectId: string }) => Promise<ProjectMemory>;
      addProjectAsset: (payload: { projectId: string; sourcePath: string; fileName?: string; name?: string; description?: string; sourceType?: string; sourceSessionId?: string }) => Promise<ProjectAsset>;
      removeProjectAsset: (payload: { projectId: string; assetId: string }) => Promise<{ ok: boolean }>;
      listProjectTasks: (payload: { projectId: string }) => Promise<ProjectTask[]>;
      createProjectTask: (payload: {
        projectId: string;
        task: { prompt: string };
      }) => Promise<{ task: ProjectTask; session: SessionSummary }>;
      getProjectTask: (payload: { projectId: string; taskId: string }) => Promise<ProjectTask | null>;
      listSessions: () => Promise<SessionSummary[]>;
      createSession: (payload?: { workspace?: string; title?: string; assistant_name?: string; connectorIds?: string[] }) => Promise<{ summary: SessionSummary; detail: SessionDetail }>;
      getSession: (payload: { sessionId: string }) => Promise<SessionDetail>;
      updateSession: (payload: { sessionId: string; title: string }) => Promise<SessionDetail>;
      deleteSession: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      setSessionConnectors: (payload: { sessionId: string; connectorIds: string[] }) => Promise<{ success?: boolean; data?: SessionDetail & { skippedBusyRuntime?: boolean }; error?: string }>;
      listConnectors: () => Promise<{ success?: boolean; data?: { connectors: ConnectorCatalogItem[]; installed: InstalledConnector[]; catalogPath: string; installedDir: string; updatedAt: number }; error?: string }>;
      getInstalledConnectors: () => Promise<{ success?: boolean; data?: InstalledConnector[]; error?: string }>;
      refreshConnectorCliStatus: (payload: { id: string }) => Promise<{ success?: boolean; data?: { connector: InstalledConnector; connected: boolean; changed: boolean; connectionChanged: boolean }; error?: string }>;
      installConnector: (payload: { id: string }) => Promise<{ success?: boolean; data?: { connector?: InstalledConnector; cli?: Record<string, any> | null }; error?: string }>;
      uninstallConnector: (payload: { id: string }) => Promise<{ success?: boolean; data?: { ok: boolean; id: string }; error?: string }>;
      saveConnectorMcpToken: (payload: { connectorId: string; serverName: string; token?: string; url?: string }) => Promise<{ success?: boolean; data?: { ok: boolean; connectorId: string; serverName: string }; error?: string }>;
      saveConnectorCredentials: (payload: { connectorId: string; values: Record<string, string> }) => Promise<{ success?: boolean; data?: { ok: boolean; connectorId: string; configuredFields: string[] }; error?: string }>;
      provisionConnectorCredentials: (payload: { connectorId: string }) => Promise<{ success?: boolean; data?: { ok: boolean; connectorId: string; configuredFields: string[]; provisioned: boolean }; error?: string }>;
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
        getState: (payload: { sessionId?: string | null }) => Promise<BrowserState>;
        openTab: (payload: BrowserOpenTabPayload) => Promise<BrowserState>;
        activateTab: (payload: BrowserTabTarget & { tabId: string }) => Promise<BrowserState>;
        closeTab: (payload: BrowserTabTarget & { tabId: string }) => Promise<BrowserState>;
        navigate: (payload: BrowserTabTarget & { url: string }) => Promise<BrowserState>;
        goBack: (payload: BrowserTabTarget) => Promise<BrowserState>;
        goForward: (payload: BrowserTabTarget) => Promise<BrowserState>;
        reload: (payload: BrowserTabTarget) => Promise<BrowserState>;
        stop: (payload: BrowserTabTarget) => Promise<BrowserState>;
        toggleDevTools: (payload: BrowserTabTarget) => Promise<BrowserState>;
        completeAuth: (payload: BrowserTabTarget & {
          title?: string;
          authKind?: "connector" | "mcp";
          serverName?: string;
          eventId?: string;
        }) => Promise<BrowserState>;
        getPendingAuthNavigations: (payload: { sessionId?: string | null }) => Promise<BrowserAuthNavigation[]>;
        ackAuthNavigation: (payload: { sessionId?: string | null; eventId: string }) => Promise<{ ok: boolean }>;
        setHost: (payload: {
          sessionId?: string | null;
          visible: boolean;
          bounds?: { x: number; y: number; width: number; height: number };
        }) => void;
        onOpen: (callback: (payload: {
          url: string;
          sessionId?: string | null;
          connectorAuth?: {
            connectorId: string;
            serverName: string;
            displayName?: string;
            tokenParam?: string;
            allowedHosts?: string[];
          } | null;
          mcpAuth?: {
            serverName: string;
            displayName?: string;
          } | null;
        }) => void) => () => void;
        onState: (callback: (payload: { sessionId: string; state: BrowserState }) => void) => () => void;
        onAuthNavigation: (callback: (payload: BrowserAuthNavigation) => void) => () => void;
        onExternalUrl: (callback: (payload: { sessionId?: string; tabId?: string; url: string }) => void) => () => void;
      };
      audit: {
        getDashboard: () => Promise<AuditDashboardPayload>;
        getPendingAlerts: () => Promise<AuditAlert[]>;
        run: (payload?: { sessionIds?: string[] }) => Promise<{
          ok: boolean;
          runId: string;
          sessionCount: number;
          toolCallCount: number;
          findingCount: number;
        }>;
        updateRule: (payload: {
          id: string;
          enabled?: boolean;
          severity?: AuditSeverity;
          config?: AuditRuleRecord['config'];
        }) => Promise<AuditRuleRecord>;
        updateFinding: (payload: { id: string; status: AuditFindingStatus }) => Promise<{ ok: boolean }>;
        updateFindings: (payload: { ids: string[]; status: AuditFindingStatus }) => Promise<{
          ok: boolean;
          updatedCount: number;
        }>;
        markReported: (payload: { fingerprints: string[] }) => Promise<{
          ok: boolean;
          updatedCount: number;
        }>;
        onChanged: (callback: (payload: {
          reason: string;
          runId?: string;
          scope?: { kind?: string; sessionIds?: string[] };
          completed?: number;
          total?: number;
          error?: string;
          alerts?: AuditAlert[];
        }) => void) => () => void;
      };
      notifications: {
        list: () => Promise<AppNotification[]>;
        create: (notification: NewAppNotification, options?: { id?: string; now?: number }) => Promise<AppNotification>;
        importLegacy: (notifications: AppNotification[]) => Promise<AppNotification[]>;
        markRead: (id: string) => Promise<AppNotification[]>;
        markAllRead: () => Promise<AppNotification[]>;
        remove: (id: string) => Promise<AppNotification[]>;
        clear: () => Promise<AppNotification[]>;
        onChanged: (callback: (payload: {
          reason: string;
          notification?: AppNotification | null;
          notifications: AppNotification[];
        }) => void) => () => void;
      };
      decisions: {
        respond: (payload: { decisionId: string; allowed: boolean; choice?: string }) => Promise<{
          id: string;
          sessionId: string;
          status: string;
        }>;
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
      onQuestionResolved: (callback: (payload: { requestId: string; sessionId: string }) => void) => () => void;
      onSessionMeta: (callback: (payload: SessionSummary) => void) => () => void;
      onSessionHistory: (callback: (payload: {
        sessionId: string;
        summary?: SessionSummary;
        history?: AgentEvent[];
        tasks?: SessionTask[];
      }) => void) => () => void;
      onSessionRemoved: (callback: (payload: { sessionId: string }) => void) => () => void;
      onWorkspaceChanged: (callback: (payload: any) => void) => () => void;
      onAppsChanged: (callback: (payload: any) => void) => () => void;
      onSettingsChanged: (callback: (payload: DesktopSettings) => void) => () => void;
      onAdapterStatus: (callback: (payload: FeishuAdapterStatus) => void) => () => void;
      onProjectsChanged: (callback: (payload: { projectId?: string; reason?: string }) => void) => () => void;
      onAssistantsChanged: (callback: (payload: { reason?: string; expertId?: string; sourcePath?: string }) => void) => () => void;
      listCoordinatorTasks: (sessionId?: string) => Promise<{ tasks: CoordinatorTask[] }>;
      getWorkerResults: (payload: { sessionId: string }) => Promise<{ results: Record<string, WorkerSubagentResult> }>;
      setWorkerSummaries: (payload: { sessionId: string; workerSummariesJson: string | null }) => Promise<{ ok: boolean }>;
      cronList: () => Promise<CronTask[]>;
      cronDelete: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
      getInstalledAssistants: () => Promise<{ success: boolean; data?: InstalledAssistant[]; error?: string }>;
      getAssistantContext: (assistantName: string) => Promise<{ success: boolean; data?: string; error?: string }>;
      getSkillInfosByIds: (skillIds: string[]) => Promise<{ success: boolean; data?: Array<{ id: string; name: string; path: string }>; error?: string }>;
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
