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
};

export type SessionDetail = SessionSummary & {
  history: AgentEvent[];
};

export type AgentEvent = Record<string, any>;

export type DesktopSettings = {
  bypassPermissions: boolean;
  model: string;
  maxTurns: number;
  appendSystemPrompt: string;
  thinkingMode: 'adaptive' | 'enabled' | 'disabled';
  thinkingBudgetTokens: number;
  settingsPath: string;
  settingsExists: boolean;
  settingsLoaded: boolean;
  settingsParseError: string;
  skippedSessionCount?: number;
};

export type StoredApp = {
  name: string;
  description: string;
  width: number;
  height: number;
  resizable: boolean;
  createdAt: number;
  updatedAt: number;
  versionCount?: number;
  latestVersionId?: string | null;
};

export type AppVersion = {
  id: string;
  createdAt: number;
  reason: string;
  note: string;
  description: string;
  width: number;
  height: number;
  resizable: boolean;
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
      createSession: (payload?: { workspace?: string }) => Promise<{ summary: SessionSummary; detail: SessionDetail }>;
      getSession: (payload: { sessionId: string }) => Promise<SessionDetail>;
      updateSession: (payload: { sessionId: string; title: string }) => Promise<SessionDetail>;
      deleteSession: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      pickDirectory: () => Promise<string | null>;
      setSessionWorkspace: (payload: { sessionId: string; workspace: string }) => Promise<SessionDetail>;
      openWorkspace: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      send: (payload: {
        sessionId: string;
        prompt: string;
        mode?: 'chat' | 'plan' | 'create-app' | 'iterate-app';
        appName?: string;
      }) => Promise<any>;
      abort: (payload: { sessionId: string }) => Promise<{ ok: boolean }>;
      listApps: () => Promise<StoredApp[]>;
      listAppVersions: (payload: { name: string }) => Promise<AppVersion[]>;
      launchApp: (payload: { name: string }) => Promise<{ ok: boolean }>;
      rollbackApp: (payload: { name: string; versionId: string }) => Promise<{ ok: boolean; app: StoredApp }>;
      deleteApp: (payload: { name: string }) => Promise<{ ok: boolean }>;
      listWorkspaceDir: (payload: { sessionId: string; dirPath?: string }) => Promise<any>;
      readWorkspaceFile: (payload: { sessionId: string; filePath: string }) => Promise<any>;
      onEvent: (callback: (payload: any) => void) => () => void;
      onState: (callback: (payload: any) => void) => () => void;
      onPermission: (callback: (payload: any) => void) => () => void;
      onSessionMeta: (callback: (payload: SessionSummary) => void) => () => void;
      onSessionRemoved: (callback: (payload: { sessionId: string }) => void) => () => void;
      onWorkspaceChanged: (callback: (payload: any) => void) => () => void;
      onAppsChanged: (callback: (payload: any) => void) => () => void;
      onSettingsChanged: (callback: (payload: DesktopSettings) => void) => () => void;
    };
  }
}

export {};
