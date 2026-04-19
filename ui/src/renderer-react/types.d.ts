export type PendingPlanApproval = {
  kind: 'create-app' | 'plan';
  originalPrompt: string;
  plan: string;
  requestedAt: number;
};

export type SessionSummary = {
  id: string;
  title: string;
  workspace: string;
  createdAt: number;
  updatedAt: number;
  busy: boolean;
  messageCount: number;
  sessionId: string | null;
  preview: string;
  pendingPlanApproval?: PendingPlanApproval | null;
};

export type SessionDetail = SessionSummary & {
  history: AgentEvent[];
  workerSummariesJson: string | null;
};

export type AgentEvent = Record<string, any>;

export type DesktopSettings = {
  bypassPermissions: boolean;
  model: string;
  maxTurns: number;
  appendSystemPrompt: string;
  thinkingMode: 'adaptive' | 'enabled' | 'disabled';
  thinkingBudgetTokens: number;
  url: string;
  apiKey: string;
  visionModel: string;
  settingsPath: string;
  settingsExists: boolean;
  settingsLoaded: boolean;
  settingsParseError: string;
  skippedSessionCount?: number;
  coordinatorMode?: boolean;
};

export type StoredApp = {
  name: string;
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
};

export type FileTreeNode = {
  id: string;
  name: string;
  type: 'folder' | 'file';
  path: string;
  children?: FileTreeNode[];
};

declare global {
  interface Window {
    agentDesktop: {
      getStatus: () => Promise<any>;
      getAuthDebug: () => Promise<any>;
      getSettings: () => Promise<DesktopSettings>;
      updateSettings: (payload: Partial<DesktopSettings>) => Promise<DesktopSettings>;
      listSessions: () => Promise<SessionSummary[]>;
      createSession: (payload?: { workspace?: string; title?: string }) => Promise<{ summary: SessionSummary; detail: SessionDetail }>;
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
        mode?: 'chat' | 'plan' | 'create-app' | 'iterate-app' | 'coordinator';
        appName?: string;
        files?: string[];
        coordinatorMode?: boolean;
      }) => Promise<any>;
      approvePlan: (payload: { sessionId: string }) => Promise<any>;
      rejectPlan: (payload: { sessionId: string }) => Promise<any>;
      abort: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      listApps: () => Promise<StoredApp[]>;
      listAppVersions: (payload: { name: string }) => Promise<AppVersion[]>;
      launchApp: (payload: { name: string }) => Promise<{ ok: boolean }>;
      rollbackApp: (payload: { name: string; versionId: string }) => Promise<{ ok: boolean; app: StoredApp }>;
      deleteApp: (payload: { name: string }) => Promise<{ ok: boolean }>;
      listWorkspaceDir: (payload: { sessionId: string; dirPath?: string }) => Promise<any>;
      readWorkspaceFile: (payload: { sessionId: string; filePath: string }) => Promise<any>;
      fs: {
        getImageBase64: (path: string) => Promise<string | null>;
        getFileMetadata: (path: string) => Promise<{ size: number } | null>;
        createTempFile: (fileName: string) => Promise<string | null>;
        writeFile: (path: string, data: number[]) => Promise<boolean>;
        saveImageToWorkspace: (sessionId: string, fileName: string, data: number[]) => Promise<{ path: string } | { error: string }>;
      };
      onEvent: (callback: (payload: any) => void) => () => void;
      onState: (callback: (payload: any) => void) => () => void;
      onPermission: (callback: (payload: any) => void) => () => void;
      onSessionMeta: (callback: (payload: SessionSummary) => void) => () => void;
      onSessionRemoved: (callback: (payload: { sessionId: string }) => void) => () => void;
      onWorkspaceChanged: (callback: (payload: any) => void) => () => void;
      onAppsChanged: (callback: (payload: any) => void) => () => void;
      onSettingsChanged: (callback: (payload: DesktopSettings) => void) => () => void;
      listExecutions: (sessionId?: string) => Promise<{ executions: ExecutionSummary[] }>;
      focusExecution: (executionId: string) => Promise<{ ok?: boolean; error?: string }>;
      createExecutionForTeammate: (payload: { sessionId: string; taskId: string; description: string; prompt: string }) => Promise<{ ok?: boolean; executionSessionId?: string; error?: string }>;
      listCoordinatorTasks: (sessionId?: string) => Promise<{ tasks: CoordinatorTask[] }>;
      onTeammateSpawned: (callback: (payload: { sessionId: string; taskId: string; description: string; prompt: string; color?: string }) => void) => () => void;
      onTeammateCompleted: (callback: (payload: { sessionId: string; taskId: string; description: string; status: string }) => void) => () => void;
      updateTeammateState: (payload: { sessionId: string; taskId: string; completed?: boolean }) => Promise<{ ok?: boolean; error?: string }>;
      getWorkerResults: (payload: { sessionId: string }) => Promise<{ results: Record<string, WorkerSubagentResult> }>;
      setWorkerSummaries: (payload: { sessionId: string; workerSummariesJson: string | null }) => Promise<{ ok: boolean }>;
      cronList: () => Promise<CronTask[]>;
      cronDelete: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

export type ExecutionSummary = {
  id: string;
  originalPrompt: string;
  busy: boolean;
  workspace: string;
  hasBubble: boolean;
  createdAt: number;
};

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

export {};
