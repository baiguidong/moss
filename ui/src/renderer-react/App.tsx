import * as React from 'react';
import { AppSidebar, type MainView } from '@/components/app-sidebar';
import { AppsPanel } from '@/components/apps-panel';
import { CronView } from '@/components/cron-view';
import { LocalAuditView } from '@/components/local-audit-view';
import { ChatArea } from '@/components/chat-area';
import { EmbeddedAppView } from '@/components/embedded-app-view';
import { SkillHubView } from '@/components/skill-hub-view';
import { ExpertHubView } from '@/components/expert-hub-view';
import { ConnectorHubView } from '@/components/connector-hub-view';
import { PreviewDrawer } from '@/components/preview-drawer';
import { previewIpc } from '@/ipc/preview.ipc';
import { UpdateModal } from '@/components/update-modal';
import { TaskPanel, type PreviewTabData } from '@/components/task-panel';
import { AskUserQuestionModal } from '@/components/ask-user-question-modal';
import { BuddyCompanion, isBuddyEnabled, setBuddyEnabled } from '@/components/buddy';
import { SettingsView } from '@/components/settings-view';
import { ProjectWorkspace } from '@/components/projects/project-workspace';
import { openBrowserPanelUrl } from '@/components/browser-panel';
import { NotificationCenter, NotificationToast } from '@/components/notification-center';
import { countSessionMessages } from '../shared/session-message-count.mjs';
import {
  buildMainChatRenderMessagesFromHistory,
  buildWorkerRenderMessagesFromSubagentEvents,
  type TranscriptRenderMessage,
  type WorkerThread,
  type WorkerThreadStatus,
} from '@/lib/agent-transcript';
import { PRESET_THEMES } from '@/theme/presets';
import { applyCssTheme, getStoredThemeId, setStoredThemeId } from '@/theme/cssTheme';
import { getToolPermissionNotice } from '../tool-permission-policy.mjs';
import {
  appendAppNotification,
  cleanIpcErrorMessage,
  getErrorMessage,
  loadAppNotifications,
  saveAppNotifications,
  type AppNotificationSeverity,
  type NewAppNotification,
} from '@/lib/app-notifications';
import type {
  AskUserQuestionAnnotations,
  AskUserQuestionRequest,
  AgentEvent,
  AppVersion,
  BackgroundTaskInfo,
  CoordinatorTask,
  DesktopSettings,
  FileTreeNode,
  InstalledConnector,
  InstalledAssistant,
  Project,
  ProjectTemplate,
  SessionDetail,
  SessionSummary,
  StoredApp,
  WorkspacePreviewData,
  WorkerSubagentResult,
} from './types';

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)}小时前`;
  return `${Math.floor(diff / day)}天前`;
}

function formatSidebarPreview(preview: string): string {
  const raw = String(preview || '').trim();
  if (!raw) return '';

  const withoutFence = raw.includes('```') ? raw.split('```')[0] : raw;
  const singleLine = withoutFence.replace(/\s+/g, ' ').trim();
  if (!singleLine) return '';

  return singleLine.length > 48 ? `${singleLine.slice(0, 48)}...` : singleLine;
}

function basename(filePath: string): string {
  if (!filePath) return '';
  const normalized = filePath.replace(/[\\/]+$/, '');
  const parts = normalized.split(/[\\/]/);
  return parts[parts.length - 1] || normalized;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function loadPanelLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw);
    return {
      leftWidth: clamp(Number(parsed.leftWidth) || DEFAULT_LAYOUT.leftWidth, LEFT_WIDTH_RANGE.min, LEFT_WIDTH_RANGE.max),
      previewWidth: clamp(Number(parsed.previewWidth) || DEFAULT_LAYOUT.previewWidth, PREVIEW_WIDTH_RANGE.min, PREVIEW_WIDTH_RANGE.max),
      rightWidth: clamp(Number(parsed.rightWidth) || DEFAULT_LAYOUT.rightWidth, RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max),
      leftCollapsed: Boolean(parsed.leftCollapsed),
      rightCollapsed: Boolean(parsed.rightCollapsed),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function toSidebarSessions(summaries: SessionSummary[], pinnedIds: Set<string>) {
  return summaries.map(({ messageCount: _messageCount, ...session }) => ({
    ...session,
    preview: formatSidebarPreview(session.preview),
    time: formatRelativeTime(session.updatedAt),
    workspaceLabel: basename(session.workspace),
    isPinned: pinnedIds.has(session.id),
    // 使用后端返回的 agentMode，如果没有则默认为 local
    agentMode: session.agentMode || 'local',
  }));
}

type ThemeMode = 'dark' | 'light' | 'system';
type ComposerIntent = 'chat' | 'plan' | 'coordinator';
type QueuedMessage = {
  id: string;
  prompt: string;
  skills?: Array<{ name: string; displayName?: string; source?: string }>;
  files?: Array<{ name: string; path: string }>;
  intent: ComposerIntent;
};
type LayoutState = {
  leftWidth: number;
  previewWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};

type PreviewTabMetadata = Record<string, unknown> & {
  sessionId?: string;
  workspace?: string;
  originalContent?: string;
  dirty?: boolean;
  lastSavedAt?: number;
  previewEditable?: boolean;
  previewSaveable?: boolean;
  previewReason?: string;
};

const LAYOUT_STORAGE_KEY = 'ui.panelLayout.v1';
const APP_SHORTCUTS_STORAGE_KEY = 'ui.appShortcuts.v1';
const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 248,
  previewWidth: 420,
  rightWidth: 280,
  leftCollapsed: false,
  rightCollapsed: false,
};
const LEFT_WIDTH_RANGE = { min: 210, max: 420 };
const PREVIEW_WIDTH_RANGE = { min: 320, max: 760 };
const RIGHT_WIDTH_RANGE = { min: 280, max: 560 };

function canEditPreviewType(contentType: WorkspacePreviewData['contentType']): boolean {
  return ['markdown', 'html', 'text', 'code', 'diff', 'url', 'unsupported'].includes(contentType);
}

function getPreviewTabMetadata(file: WorkspacePreviewData | null | undefined): PreviewTabMetadata {
  return ((file?.metadata as PreviewTabMetadata | undefined) || {}) as PreviewTabMetadata;
}

function getStoredAppKey(app: Pick<StoredApp, 'id' | 'name'>): string {
  return app.id || app.name;
}

function isDirtyPreviewTab(file: WorkspacePreviewData | null | undefined): boolean {
  return Boolean(getPreviewTabMetadata(file).dirty);
}

function enrichWorkspacePreviewFile(
  file: WorkspacePreviewData,
  sessionId: string | null,
  workspace: string | null | undefined,
  existing?: WorkspacePreviewData | null
): PreviewTabData {
  if (file.path.startsWith('preview:')) {
    return file;
  }

  const existingMetadata = getPreviewTabMetadata(existing);
  const existingDirty = Boolean(existingMetadata.dirty);
  const content = existingDirty ? existing?.content || file.content : file.content;

  return {
    ...file,
    content,
    metadata: {
      ...(file.metadata || {}),
      ...(existingDirty ? existingMetadata : {}),
      sessionId: sessionId || existingMetadata.sessionId,
      workspace: workspace || existingMetadata.workspace,
      originalContent: canEditPreviewType(file.contentType)
        ? file.content
        : existingMetadata.originalContent,
      dirty: existingDirty ? true : false,
    },
  };
}

function upsertSummary(list: SessionSummary[], summary: SessionSummary) {
  const next = list.some((entry) => entry.id === summary.id)
    ? list.map((entry) => (entry.id === summary.id ? summary : entry))
    : [summary, ...list];
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

function extractHistoryText(event: AgentEvent): string {
  if (typeof event?.prompt === 'string') return event.prompt;
  const content = event?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block?.type === 'text' && typeof block.text === 'string') return block.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof event?.content === 'string') return event.content;
  if (typeof event?.result === 'string') return event.result;
  return '';
}

function hasAssistantTextEvent(event: AgentEvent): boolean {
  if (event?.type !== 'assistant') return false;
  return extractHistoryText(event).trim().length > 0;
}

function isVisibleUserTextEvent(event: AgentEvent): boolean {
  if (event?.type !== 'user') return false;
  if (event.isMeta === true || event.isVisibleInTranscriptOnly === true) return false;
  const text = extractHistoryText(event).trim();
  if (!text) return false;
  if (text.startsWith('<local-command-caveat>') || text.startsWith('<command-name>')) return false;
  return true;
}

function historyCompletenessScore(history: AgentEvent[] | undefined | null): number {
  if (!Array.isArray(history)) return 0;
  return history.reduce((score, event) => {
    if (isVisibleUserTextEvent(event) || hasAssistantTextEvent(event)) return score + 1;
    return score;
  }, 0);
}

function mergeSessionHistorySnapshot(
  current: AgentEvent[] | undefined,
  incoming: AgentEvent[] | undefined,
): AgentEvent[] | undefined {
  if (!Array.isArray(incoming)) return current;
  if (!Array.isArray(current) || current.length === 0) return incoming;
  return historyCompletenessScore(incoming) >= historyCompletenessScore(current)
    ? incoming
    : current;
}

function restoreComposerIntent(session?: Pick<SessionSummary, 'composerIntent'> | null): ComposerIntent {
  return session?.composerIntent === 'coordinator' ? 'coordinator' : 'chat';
}

function buildCliConnectorSetupPrompt(connector: InstalledConnector, _cli: Record<string, any> | null) {
  return [
    `请帮我完成 Moss 连接器「${connector.name}」的本机 CLI 安装、版本检查和认证。`,
    '',
    '执行方式：直接调用 Moss 工具，不要使用 Bash/Shell/终端手动执行连接器命令。',
    '',
    '请调用：',
    '```json',
    JSON.stringify({ action: 'connector_cli_setup', connector_id: connector.id }, null, 2),
    '```',
    '',
    'Moss 工具会读取已安装连接器的 cli.json，根据当前系统执行 init/versionCheck/auth/status，自动打开 OAuth 地址到右侧浏览器，并等待认证完成。',
    '',
    '要求：',
    '1. 不要修改连接器目录内部文件，包括 cli.json、mcp.json、SKILL.md、references 或图标。',
    '2. 不要在对话、日志或输出文件中展示 token、密码、完整授权 URL 或完整敏感凭据。',
    '3. 工具返回后，用简短中文说明安装、认证和 status 检查结果。',
  ].join('\n');
}

function filterVisibleNodes(items: any[], query: string, cache: Map<string, any>, expandedDirs: Set<string>): FileTreeNode[] {
  const lower = query.trim().toLowerCase();
  return items
    .map((item) => {
      if (!item || typeof item.name !== 'string') return null;
      const cached = cache.get(item.path);
      const children = item.type === 'directory' && expandedDirs.has(item.path) && cached?.items
        ? filterVisibleNodes(cached.items, query, cache, expandedDirs)
        : undefined;

      const selfMatch =
        !lower ||
        item.name.toLowerCase().includes(lower) ||
        String(item.relativePath || '').toLowerCase().includes(lower);

      if (!selfMatch && item.type === 'directory' && (!children || children.length === 0)) {
        return null;
      }
      if (!selfMatch && item.type === 'file') {
        return null;
      }

      return {
        id: item.path,
        name: item.name,
        type: item.type === 'directory' ? 'folder' : 'file',
        path: item.path,
        children,
      } satisfies FileTreeNode;
    })
    .filter(Boolean) as FileTreeNode[];
}

function mapCoordinatorTaskStatus(status: string | undefined): 'running' | 'completed' | 'failed' | undefined {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) return undefined;
  if (/(fail|error|killed|stopped|cancel)/.test(normalized)) return 'failed';
  if (/(complete|completed|done|success|finished)/.test(normalized)) return 'completed';
  if (/(run|running|pending|queued|waiting|spawned|created|active)/.test(normalized)) return 'running';
  return undefined;
}

export default function App() {
  const isMacOS =
    typeof navigator !== 'undefined' &&
    /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`);
  const [bootError, setBootError] = React.useState('');
  const [permissionNotice, setPermissionNotice] = React.useState('');
  const [permissionNoticeSeverity, setPermissionNoticeSeverity] = React.useState<AppNotificationSeverity>('info');
  const permissionNoticeTimerRef = React.useRef<number | null>(null);
  const [appNotifications, setAppNotifications] = React.useState(() => {
    try {
      return loadAppNotifications(window.localStorage);
    } catch {
      return [];
    }
  });
  const [activeView, setActiveView] = React.useState<MainView>('chat');
  const [auditFocusTarget, setAuditFocusTarget] = React.useState<{
    sessionId: string;
    toolUseId: string;
  } | null>(null);
  const getSystemTheme = (): 'dark' | 'light' => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const resolveTheme = (pref: ThemeMode): 'dark' | 'light' => {
    return pref === 'system' ? getSystemTheme() : pref;
  };

  const dismissPermissionNotice = React.useCallback(() => {
    if (permissionNoticeTimerRef.current) {
      window.clearTimeout(permissionNoticeTimerRef.current);
      permissionNoticeTimerRef.current = null;
    }
    setPermissionNotice('');
    setPermissionNoticeSeverity('info');
  }, []);

  const showPermissionNotice = React.useCallback((
    message: string,
    severity: AppNotificationSeverity = 'info',
    durationMs = 4000,
  ) => {
    if (permissionNoticeTimerRef.current) {
      window.clearTimeout(permissionNoticeTimerRef.current);
    }
    setPermissionNotice(message);
    setPermissionNoticeSeverity(severity);
    permissionNoticeTimerRef.current = durationMs > 0
      ? window.setTimeout(() => {
          setPermissionNotice('');
          setPermissionNoticeSeverity('info');
          permissionNoticeTimerRef.current = null;
        }, durationMs)
      : null;
  }, []);

  const pushAppNotification = React.useCallback((notification: NewAppNotification) => {
    setAppNotifications((current) => appendAppNotification(current, notification));
  }, []);

  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem('ui.themeMode');
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {}
    return 'light';
  });
  const [cssThemeId, setCssThemeId] = React.useState<DesktopSettings['appearance']['cssThemeId']>(() => {
    const stored = getStoredThemeId();
    return stored === 'default' || stored === 'grid-theme' || stored === 'dot-theme' || stored === 'gradient-theme'
      ? stored
      : 'grid-theme';
  });
  const appearanceRef = React.useRef<DesktopSettings['appearance']>({ themeMode, cssThemeId });
  const [sessionSearchQuery, setSessionSearchQuery] = React.useState('');
  const [layout, setLayout] = React.useState<LayoutState>(() => loadPanelLayout());
  const [browserOpenSignal, setBrowserOpenSignal] = React.useState(0);
  const [summaries, setSummaries] = React.useState<SessionSummary[]>([]);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [projectTemplates, setProjectTemplates] = React.useState<ProjectTemplate[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [projectRefreshSignal, setProjectRefreshSignal] = React.useState(0);
  const [apps, setApps] = React.useState<StoredApp[]>([]);
  const [appsLoaded, setAppsLoaded] = React.useState(false);
  const [appShortcutIds, setAppShortcutIds] = React.useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(APP_SHORTCUTS_STORAGE_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const [versionsByApp, setVersionsByApp] = React.useState<Record<string, AppVersion[]>>({});
  const [selectedAppName, setSelectedAppName] = React.useState('');
  const [embeddedAppName, setEmbeddedAppName] = React.useState('');
  const [composerIntent, setComposerIntent] = React.useState<ComposerIntent>('chat');
  const [installedAssistants, setInstalledAssistants] = React.useState<InstalledAssistant[]>([]);
  const [selectedAssistant, setSelectedAssistant] = React.useState<InstalledAssistant | null>(null);
  const [installedConnectors, setInstalledConnectors] = React.useState<InstalledConnector[]>([]);
  const [draftConnectorIds, setDraftConnectorIds] = React.useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [activeDetail, setActiveDetail] = React.useState<SessionDetail | null>(null);
  const [input, setInput] = React.useState('');
  const [backgroundTasks, setBackgroundTasks] = React.useState<Record<string, BackgroundTaskInfo[]>>({});
  const [queuedMessages, setQueuedMessages] = React.useState<Record<string, QueuedMessage[]>>({});
  const [questionRequests, setQuestionRequests] = React.useState<AskUserQuestionRequest[]>([]);
  const [composerAttachments, setComposerAttachments] = React.useState<Array<{ name: string; path: string }>>([]);
  // Ref mirrors state so event handlers (registered once) and abort can read
  // and mutate the queue synchronously, ahead of React's re-render.
  const queuedMessagesRef = React.useRef<Record<string, QueuedMessage[]>>({});
  const questionRequestsRef = React.useRef<AskUserQuestionRequest[]>([]);
  const updateQueue = React.useCallback((sessionId: string, updater: (prev: QueuedMessage[]) => QueuedMessage[]) => {
    const next = updater(queuedMessagesRef.current[sessionId] ?? []);
    queuedMessagesRef.current = { ...queuedMessagesRef.current, [sessionId]: next };
    setQueuedMessages(queuedMessagesRef.current);
  }, []);
  const updateQuestionRequests = React.useCallback((updater: (prev: AskUserQuestionRequest[]) => AskUserQuestionRequest[]) => {
    const next = updater(questionRequestsRef.current);
    questionRequestsRef.current = next;
    setQuestionRequests(next);
  }, []);
  const [pinnedIds, setPinnedIds] = React.useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('ui.pinnedSessions');
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });

  // Map sessionId -> agentMode ('local' | 'remote-direct')
  const [sessionAgentModes, setSessionAgentModes] = React.useState<Map<string, 'local' | 'remote-direct'>>(() => {
    try {
      const raw = localStorage.getItem('ui.sessionAgentModes');
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      return new Map(Object.entries(obj));
    } catch {
      return new Map();
    }
  });

  const persistSessionAgentModes = React.useCallback((map: Map<string, 'local' | 'remote-direct'>) => {
    setSessionAgentModes(map);
    const obj = Object.fromEntries(map.entries());
    localStorage.setItem('ui.sessionAgentModes', JSON.stringify(obj));
  }, []);
  const [workspaceQuery, setWorkspaceQuery] = React.useState('');
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(new Set());
  const [directoryCache, setDirectoryCache] = React.useState<Map<string, any>>(new Map());
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(null);
  const [previewTabs, setPreviewTabs] = React.useState<PreviewTabData[]>([]);
  const [activePreviewPath, setActivePreviewPath] = React.useState<string | null>(null);
  const [desktopSettings, setDesktopSettings] = React.useState<DesktopSettings | null>(null);
  const desktopSettingsRef = React.useRef<DesktopSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = React.useState<DesktopSettings | null>(null);
  const [settingsNotice, setSettingsNotice] = React.useState('');
  const [planDecisionBusy, setPlanDecisionBusy] = React.useState(false);
  const [coordinatorTasks, setCoordinatorTasks] = React.useState<CoordinatorTask[]>([]);
  const [activeWorkerThreadId, setActiveWorkerThreadId] = React.useState<string | null>(null);
  const [stickyWorkerTaskStatuses, setStickyWorkerTaskStatuses] = React.useState<Record<string, 'completed' | 'failed'>>({});
  const [workerSubagentResults, setWorkerSubagentResults] = React.useState<Record<string, WorkerSubagentResult>>({});
  // Workers from previous coordinator runs in the same session, grouped by round.
  const [archivedWorkerRounds, setArchivedWorkerRounds] = React.useState<WorkerThread[][]>([]);
  const archivedWorkerRoundsRef = React.useRef<WorkerThread[][]>([]);
  const previewAutoCollapsedRightRef = React.useRef(false);
  const previewAutoCollapsedBySessionRef = React.useRef<string | null>(null);
  const [forceBuddyUpdate, setForceBuddyUpdate] = React.useState(0);
  const workspaceRefreshTimerRef = React.useRef<number | null>(null);
  const refreshedTerminalWorkerIdsRef = React.useRef<Set<string>>(new Set());
  // Tracks which task IDs were present in the previous coordinatorTasks poll,
  // so we can detect disappearances (tasks that completed without a terminal status).
  const prevCoordinatorTaskIdsRef = React.useRef<Set<string>>(new Set());
  // Keeps the last non-empty thread list so the worker panel and summary stay
  // visible after the backend clears coordinatorTasks on completion.
  const frozenWorkerThreadsRef = React.useRef<WorkerThread[]>([]);
  // When the memo detects a new run (new task IDs while frozen is non-empty), it
  // stores the old frozen workers here so the effect can archive them to state.
  const pendingArchiveRef = React.useRef<WorkerThread[] | null>(null);
  const prevBusyRef = React.useRef<boolean | undefined>(undefined);
  const layoutRef = React.useRef(layout);
  const activeSessionIdRef = React.useRef<string | null>(null);
  const activeDetailRef = React.useRef<SessionDetail | null>(null);
  const expandedDirsRef = React.useRef<Set<string>>(new Set());
  const previewTabsRef = React.useRef<WorkspacePreviewData[]>([]);
  const openSessionRequestIdRef = React.useRef(0);
  // Guards against creating a second session (and a second workspace dir) when
  // submitPrompt re-enters before the first createAndOpenSession has set
  // activeSessionId — e.g. a fast double-send, or a retry after an errored
  // first turn. Holds the id of the session created in-flight.
  const creatingSessionRef = React.useRef<Promise<string | undefined> | null>(null);
  const getDirtyPreviewTabs = React.useCallback(
    () => previewTabsRef.current.filter((tab) => isDirtyPreviewTab(tab)),
    []
  );
  const confirmDiscardDirtyPreviewTabs = React.useCallback((message?: string) => {
    const dirtyTabs = getDirtyPreviewTabs();
    if (dirtyTabs.length === 0) return true;
    return window.confirm(message || `有 ${dirtyTabs.length} 个预览存在未保存修改，确认放弃？`);
  }, [getDirtyPreviewTabs]);

  const clearSessionWorkspaceState = React.useCallback(() => {
    setDirectoryCache(new Map());
    setExpandedDirs(new Set());
    setSelectedFilePath(null);
    setPreviewTabs([]);
    setActivePreviewPath(null);
    setWorkspaceQuery('');
    previewAutoCollapsedRightRef.current = false;
    previewAutoCollapsedBySessionRef.current = null;
  }, []);

  const persistPinned = React.useCallback((next: Set<string>) => {
    setPinnedIds(next);
    localStorage.setItem('ui.pinnedSessions', JSON.stringify(Array.from(next)));
  }, []);

  const persistAppShortcuts = React.useCallback((next: Set<string>) => {
    setAppShortcutIds(next);
    localStorage.setItem(APP_SHORTCUTS_STORAGE_KEY, JSON.stringify(Array.from(next)));
  }, []);

  const refreshSummaries = React.useCallback(async () => {
    const list = await window.agentDesktop.listSessions();
    setSummaries(list);
    return list;
  }, []);

  const refreshProjects = React.useCallback(async () => {
    const list = await window.agentDesktop.listProjects();
    setProjects(list);
    return list;
  }, []);

  const refreshProjectTemplates = React.useCallback(async () => {
    const list = await window.agentDesktop.listProjectTemplates();
    setProjectTemplates(Array.isArray(list) ? list : []);
    return list;
  }, []);

  const refreshApps = React.useCallback(async () => {
    const nextApps = await window.agentDesktop.listApps();
    setApps(nextApps);
    setAppsLoaded(true);
    return nextApps;
  }, []);

  const refreshAssistants = React.useCallback(async (mode?: 'local' | 'remote-direct') => {
    const agentMode = mode ?? desktopSettingsRef.current?.agentMode ?? 'local';
    const result = agentMode === 'remote-direct'
      ? await window.agentDesktop.getRemoteInstalledAssistants()
      : await window.agentDesktop.getInstalledAssistants();
    const assistants = result?.data ?? result ?? [];
    setInstalledAssistants(Array.isArray(assistants) ? assistants : []);
    return assistants;
  }, []);

  const refreshConnectors = React.useCallback(async () => {
    const result = await window.agentDesktop.getInstalledConnectors();
    const connectors = result?.data ?? [];
    setInstalledConnectors(Array.isArray(connectors) ? connectors : []);
    return connectors;
  }, []);

  React.useEffect(() => {
    if (!activeSessionId) return;
    const assistantName = activeDetail?.assistantName?.trim();
    if (!assistantName) {
      setSelectedAssistant(null);
      return;
    }
    setSelectedAssistant(
      installedAssistants.find((assistant) => assistant.name === assistantName) ?? null,
    );
  }, [activeDetail?.assistantName, activeSessionId, installedAssistants]);

  const loadAppVersions = React.useCallback(async (name: string) => {
    const versions = await window.agentDesktop.listAppVersions({ name });
    setVersionsByApp((prev) => ({ ...prev, [name]: versions }));
    return versions;
  }, []);

  const applyAppearance = React.useCallback((appearance: DesktopSettings['appearance']) => {
    appearanceRef.current = appearance;
    setThemeMode(appearance.themeMode);
    setCssThemeId(appearance.cssThemeId);
  }, []);

  const applyDesktopSettings = React.useCallback((next: DesktopSettings) => {
    setDesktopSettings((prev) => {
      const merged = prev ? { ...prev, ...next } : next;
      desktopSettingsRef.current = merged;
      return merged;
    });
    setSettingsDraft((prev) => (prev ? { ...prev, ...next } : next));
    if (next.appearance) applyAppearance(next.appearance);
  }, [applyAppearance]);

  // Per-session composer drafts: text + attachments survive session switches
  // (borrowed from sudowork's useSendBoxDraft). Snapshotted on switch, so live
  // edits stay in normal state and send-clearing works untouched.
  const composerDraftsRef = React.useRef<Record<string, { text: string; files: Array<{ name: string; path: string }> }>>({});
  const draftSessionKeyRef = React.useRef<string>('home');
  const inputDraftRef = React.useRef('');
  inputDraftRef.current = input;
  const composerAttachmentsRef = React.useRef<Array<{ name: string; path: string }>>([]);
  composerAttachmentsRef.current = composerAttachments;

  React.useEffect(() => {
    const prevKey = draftSessionKeyRef.current;
    const nextKey = activeSessionId ?? 'home';
    if (prevKey === nextKey) return;
    composerDraftsRef.current[prevKey] = {
      text: inputDraftRef.current,
      files: composerAttachmentsRef.current,
    };
    draftSessionKeyRef.current = nextKey;
    const draft = composerDraftsRef.current[nextKey];
    setInput(draft?.text ?? '');
    setComposerAttachments(draft?.files ?? []);
  }, [activeSessionId]);

  // Latest context usage derived from the newest main-thread assistant
  // message (input + cache read/write + output ≈ current context footprint).
  // Result events are deliberately skipped: their usage is summed across all
  // API calls of the turn and vastly overstates the live context size.
  const contextUsage = React.useMemo(() => {
    const history = activeDetail?.history;
    if (!Array.isArray(history)) return null;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const ev = history[i] as any;
      if (ev?.type !== 'assistant' || ev?.parent_tool_use_id != null) continue;
      const usage = ev?.message?.usage;
      if (usage && typeof usage.input_tokens === 'number') {
        const inputTokens = usage.input_tokens ?? 0;
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheWrite = usage.cache_creation_input_tokens ?? 0;
        const outputTokens = usage.output_tokens ?? 0;
        return {
          used: inputTokens + cacheRead + cacheWrite + outputTokens,
          inputTokens,
          cacheRead,
          cacheWrite,
          outputTokens,
        };
      }
    }
    return null;
  }, [activeDetail?.history]);

  const navigateToHome = React.useCallback((options?: { resetInput?: boolean; resetApp?: boolean; preserveIntent?: boolean; forceDiscardDirty?: boolean }) => {
    if (!options?.forceDiscardDirty && !confirmDiscardDirtyPreviewTabs('当前存在未保存的预览修改，确认离开当前会话？')) {
      return false;
    }
    setActiveView('chat');
    setActiveSessionId(null);
    setActiveDetail(null);
    clearSessionWorkspaceState();
    if (!options?.preserveIntent) {
      setComposerIntent('chat');
    }
    if (options?.resetInput) {
      setInput('');
      composerDraftsRef.current['home'] = { text: '', files: [] };
    }
    if (options?.resetApp) {
      setSelectedAppName('');
    }
    return true;
  }, [clearSessionWorkspaceState, confirmDiscardDirtyPreviewTabs]);

  const openSession = React.useCallback(async (sessionId: string) => {
    if (activeSessionIdRef.current !== sessionId) {
      if (!confirmDiscardDirtyPreviewTabs('当前存在未保存的预览修改，确认切换到其他会话？')) {
        return false;
      }
    }
    const requestId = ++openSessionRequestIdRef.current;
    let detail;
    try {
      detail = await window.agentDesktop.getSession({ sessionId });
    } catch {
      // 会话可能已被删除或后端出错; 忽略并保持当前视图
      return false;
    }
    if (requestId !== openSessionRequestIdRef.current) {
      return false;
    }
    setActiveView('chat');
    activeSessionIdRef.current = sessionId;
    activeDetailRef.current = detail;
    setActiveSessionId(sessionId);
    setComposerIntent(restoreComposerIntent(detail));
    setActiveDetail(detail);
    clearSessionWorkspaceState();
    return true;
  }, [clearSessionWorkspaceState, confirmDiscardDirtyPreviewTabs]);

  const createAndOpenSession = React.useCallback(async (
    title?: string,
    workspace?: string,
    assistantName?: string,
    projectId?: string | null,
    connectorIds?: string[],
  ) => {
    const payload: { title?: string; workspace?: string; assistant_name?: string; projectId?: string | null; connectorIds?: string[] } = {};
    if (workspace) payload.workspace = workspace;
    if (title) payload.title = title;
    if (assistantName) payload.assistant_name = assistantName;
    if (projectId) payload.projectId = projectId;
    if (connectorIds && connectorIds.length > 0) payload.connectorIds = connectorIds;
    const created = await window.agentDesktop.createSession(payload);
    setSummaries((prev) => upsertSummary(prev, created.summary));
    activeSessionIdRef.current = created.summary.id;
    activeDetailRef.current = created.detail;
    setActiveView('chat');
    setActiveSessionId(created.summary.id);
    setComposerIntent(restoreComposerIntent(created.detail));
    setActiveDetail(created.detail);
    clearSessionWorkspaceState();
    // Record session agentMode based on current settings
    const mode = desktopSettings?.agentMode ?? 'local';
    persistSessionAgentModes(new Map(sessionAgentModes).set(created.summary.id, mode));
    await openSession(created.summary.id);
    return created.summary.id;
  }, [clearSessionWorkspaceState, openSession, desktopSettings?.agentMode, sessionAgentModes, persistSessionAgentModes]);

  const ensureRootDirectory = React.useCallback(async (sessionId: string, workspace: string) => {
    try {
      const data = await window.agentDesktop.listWorkspaceDir({ sessionId, dirPath: workspace });
      // 会话在请求返回前已切换则丢弃, 避免用旧会话的目录树覆盖当前会话
      if (activeSessionIdRef.current !== sessionId) return;
      setDirectoryCache(new Map([[workspace, data]]));
    } catch {
      /* 忽略目录加载失败 */
    }
  }, []);

  React.useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  React.useEffect(() => {
    layoutRef.current = layout;
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  React.useEffect(() => {
    activeDetailRef.current = activeDetail;
  }, [activeDetail]);

  React.useEffect(() => {
    try {
      saveAppNotifications(appNotifications, window.localStorage);
    } catch {
      // Notification persistence is best-effort.
    }
  }, [appNotifications]);

  React.useEffect(() => () => {
    if (permissionNoticeTimerRef.current) {
      window.clearTimeout(permissionNoticeTimerRef.current);
      permissionNoticeTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const message = getErrorMessage(event.error || event.message);
      const location = event.filename
        ? `${event.filename}${event.lineno ? `:${event.lineno}:${event.colno || 0}` : ''}`
        : '';
      pushAppNotification({
        severity: 'error',
        source: '界面运行时',
        title: '界面发生未处理异常',
        message,
        details: [event.error instanceof Error ? event.error.stack : '', location].filter(Boolean).join('\n'),
      });
    };
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const message = getErrorMessage(event.reason);
      pushAppNotification({
        severity: 'error',
        source: '界面运行时',
        title: '异步操作未处理',
        message,
        details: event.reason instanceof Error ? event.reason.stack : '',
      });
    };
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [pushAppNotification]);

  React.useEffect(() => {
    if (!bootError) return;
    pushAppNotification({
      severity: 'error',
      source: '应用启动',
      title: 'Moss 启动检查失败',
      message: bootError,
    });
  }, [bootError, pushAppNotification]);

  React.useEffect(() => {
    expandedDirsRef.current = expandedDirs;
  }, [expandedDirs]);

  React.useEffect(() => {
    previewTabsRef.current = previewTabs;
  }, [previewTabs]);

  React.useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (getDirtyPreviewTabs().length === 0) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [getDirtyPreviewTabs]);

  React.useEffect(() => {
    const root = document.documentElement;
    const resolved = resolveTheme(themeMode);
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
    // Synchronous startup cache; ~/.moss/settings.json is the persisted source of truth.
    localStorage.setItem('ui.themeMode', themeMode);
  }, [themeMode]);

  // Listen for system theme changes when in system mode
  React.useEffect(() => {
    if (themeMode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      const root = document.documentElement;
      const resolved = resolveTheme('system');
      root.setAttribute('data-theme', resolved);
      root.style.colorScheme = resolved;
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode]);

  // Apply CSS theme when cssThemeId changes
  React.useEffect(() => {
    const theme = PRESET_THEMES.find((t) => t.id === cssThemeId);
    applyCssTheme(theme?.css || null);
    setStoredThemeId(cssThemeId);
  }, [cssThemeId]);

  React.useEffect(() => {
    return () => {
      document.body.classList.remove('layout-resizing');
    };
  }, []);

  React.useEffect(() => {
    if (selectedAppName && !apps.some((entry) => entry.name === selectedAppName)) {
      setSelectedAppName('');
    }
    if (embeddedAppName && !apps.some((entry) => entry.name === embeddedAppName || entry.id === embeddedAppName)) {
      setEmbeddedAppName('');
      if (activeView === 'embedded-app') {
        setActiveView('apps');
      }
    }
  }, [activeView, apps, embeddedAppName, selectedAppName]);

  React.useEffect(() => {
    if (!appsLoaded) return;
    const installedIds = new Set(apps.map(getStoredAppKey));
    const nextShortcuts = new Set(
      Array.from(appShortcutIds).filter((id) => installedIds.has(id))
    );
    if (nextShortcuts.size !== appShortcutIds.size) {
      persistAppShortcuts(nextShortcuts);
    }
  }, [apps, appShortcutIds, appsLoaded, persistAppShortcuts]);

  // Poll for coordinator mode in-process teammate tasks
  React.useEffect(() => {
    if (!activeSessionId) {
      setCoordinatorTasks([]);
      return;
    }
    let mounted = true;
    const loadCoordinatorTasks = async () => {
      try {
        const result = await window.agentDesktop.listCoordinatorTasks(activeSessionId);
        if (mounted && result?.tasks) {
          setCoordinatorTasks(result.tasks);
        }
      } catch {
        // ignore
      }
    };
    loadCoordinatorTasks();
    const timer = window.setInterval(loadCoordinatorTasks, 2000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [activeSessionId]);

  React.useEffect(() => {
    setStickyWorkerTaskStatuses({});
    setWorkerSubagentResults({});
    setArchivedWorkerRounds([]);
    archivedWorkerRoundsRef.current = [];
    refreshedTerminalWorkerIdsRef.current = new Set();
    prevCoordinatorTaskIdsRef.current = new Set();
    frozenWorkerThreadsRef.current = [];
    pendingArchiveRef.current = null;
    prevBusyRef.current = undefined;
  }, [activeSessionId]);

  // Track busy transitions:
  // false → true: new coordinator request started — reset auxiliary tracking state.
  //               frozenWorkerThreadsRef is intentionally NOT cleared here so
  //               multi-turn coordinator follow-ups keep workers visible.
  //               The resolvedWorkerThreads memo archives old workers when new task IDs appear.
  // true  → false: coordinator just finished — persist worker states to SQLite so
  //               the worker panel survives session switches and app restarts.
  React.useEffect(() => {
    const busy = Boolean(activeDetail?.busy);
    if (prevBusyRef.current === false && busy === true) {
      setStickyWorkerTaskStatuses({});
      setWorkerSubagentResults({});
      refreshedTerminalWorkerIdsRef.current = new Set();
      prevCoordinatorTaskIdsRef.current = new Set();
    } else if (prevBusyRef.current === true && busy === false) {
      const threads = frozenWorkerThreadsRef.current;
      const archived = archivedWorkerRoundsRef.current;
      const sid = activeSessionIdRef.current;
      if ((threads.length > 0 || archived.length > 0) && sid) {
        // Persist worker metadata (messages excluded — they live in .jsonl files).
        const data = {
          current: threads.map((t) => ({ ...t, messages: [] as TranscriptRenderMessage[] })),
          archived: archived.map((round) =>
            round.map((t) => ({ ...t, messages: [] as TranscriptRenderMessage[] })),
          ),
        };
        void window.agentDesktop.setWorkerSummaries({
          sessionId: sid,
          workerSummariesJson: JSON.stringify(data),
        });
      }
    }
    prevBusyRef.current = busy;
  }, [activeDetail?.busy]);

  // After each render, flush any pending archive produced by the resolvedWorkerThreads memo.
  // The memo can't call setState, so it signals via pendingArchiveRef.
  React.useEffect(() => {
    if (!pendingArchiveRef.current) return;
    const toArchive = pendingArchiveRef.current;
    pendingArchiveRef.current = null;
    setArchivedWorkerRounds((prev) => {
      const next = [...prev, toArchive];
      archivedWorkerRoundsRef.current = next;
      return next;
    });
  });

  // Restore worker panel from SQLite when opening a session that had previous coordinator runs.
  // The saved JSON is the lightweight worker summary; full event streams are re-fetched
  // from .jsonl files via getWorkerResults.
  React.useEffect(() => {
    const json = activeDetail?.workerSummariesJson;
    if (!activeSessionId || !json) return;
    if (frozenWorkerThreadsRef.current.length > 0) return; // live data already present
    try {
      const saved = JSON.parse(json);
      // Support both the old format (WorkerThread[]) and the new format ({current, archived}).
      let current: WorkerThread[] = [];
      let archived: WorkerThread[][] = [];
      if (Array.isArray(saved)) {
        current = saved;
      } else if (saved && typeof saved === 'object') {
        if (Array.isArray(saved.current)) current = saved.current;
        if (Array.isArray(saved.archived)) {
          archived = saved.archived.every((entry) => Array.isArray(entry))
            ? (saved.archived as WorkerThread[][]).filter((round) => round.length > 0)
            : (saved.archived.length > 0 ? [saved.archived as WorkerThread[]] : []);
        }
      }
      if (current.length === 0 && archived.length === 0) return;
      frozenWorkerThreadsRef.current = current;
      setArchivedWorkerRounds(archived);
      archivedWorkerRoundsRef.current = archived;
      // Re-fetch event streams to populate message history — also triggers a re-render
      // so resolvedWorkerThreads picks up the restored frozenWorkerThreadsRef.
      void window.agentDesktop.getWorkerResults({ sessionId: activeSessionId })
        .then((res) => {
          if (activeSessionIdRef.current !== activeSessionId) return;
          setWorkerSubagentResults(res?.results ?? {});
        });
    } catch {}
  }, [activeSessionId, activeDetail?.workerSummariesJson]);

  React.useEffect(() => {
    if (!activeDetail?.workspace || !activeSessionId) {
      setDirectoryCache(new Map());
      return;
    }
    void ensureRootDirectory(activeSessionId, activeDetail.workspace);
  }, [activeDetail?.workspace, activeSessionId, ensureRootDirectory]);

  const refreshWorkspaceSnapshot = React.useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const detail = activeDetailRef.current;
    if (!sessionId || !detail?.workspace) return;

    const validExpandedDirs = Array.from(expandedDirsRef.current).filter((p) =>
      p.startsWith(detail.workspace)
    );
    const pathsToRefresh = [detail.workspace, ...validExpandedDirs];
    const refreshedEntries = await Promise.all(
      pathsToRefresh.map(async (dirPath) => {
        try {
          const data = await window.agentDesktop.listWorkspaceDir({
            sessionId,
            dirPath,
          });
          return [dirPath, data] as const;
        } catch {
          return [dirPath, null] as const;
        }
      })
    );

    setDirectoryCache(() => {
      const next = new Map<string, any>();
      for (const [dirPath, data] of refreshedEntries) {
        if (data) next.set(dirPath, data);
      }
      return next;
    });

    if (previewTabsRef.current.length === 0) return;

    const refreshedTabs = await Promise.all(
      previewTabsRef.current.map(async (tab) => {
        const metadata = getPreviewTabMetadata(tab);
        if (metadata.dirty) {
          return tab;
        }
        try {
          const refreshed = await window.agentDesktop.readWorkspaceFile({
            sessionId,
            filePath: tab.path,
          });
          return enrichWorkspacePreviewFile(refreshed, sessionId, detail.workspace, tab);
        } catch {
          return null;
        }
      })
    );

    const nextTabs = refreshedTabs.filter(Boolean) as PreviewTabData[];
    setPreviewTabs(nextTabs);
    setSelectedFilePath((prev) => (prev && nextTabs.some((tab) => tab.path === prev) ? prev : null));
    setActivePreviewPath((prev) => {
      if (prev && nextTabs.some((tab) => tab.path === prev)) return prev;
      return nextTabs[0]?.path || null;
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const status = await window.agentDesktop.getStatus();
        let nextSettings = await window.agentDesktop.getSettings();
        if (!nextSettings.appearancePersisted) {
          nextSettings = await window.agentDesktop.updateSettings({
            appearance: appearanceRef.current,
          });
        }
        if (!status.cliReady) {
          setBootError('缺少 cli-node.js。先在仓库根目录执行 bun run build:node。');
        }
        applyDesktopSettings(nextSettings);
        await Promise.all([
          refreshApps(),
          refreshSummaries(),
          refreshProjects(),
          refreshProjectTemplates(),
          refreshAssistants(nextSettings.agentMode ?? 'local'),
        ]);
        void refreshConnectors().catch(() => {});
        if (cancelled) return;
        setActiveSessionId(null);
        setActiveDetail(null);
      } catch (error: any) {
        if (!cancelled) {
          setBootError(error?.message || String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyDesktopSettings, openSession, refreshApps, refreshSummaries, refreshProjects, refreshProjectTemplates, refreshAssistants, refreshConnectors]);

  React.useEffect(() => {

    const offEvent = window.agentDesktop.onEvent((payload) => {
      if (payload.sessionId !== activeSessionIdRef.current) return;
      setActiveDetail((prev) => {
        if (!prev) return prev;
        const next = { ...prev, history: [...prev.history, payload.payload] };
        activeDetailRef.current = next;
        return next;
      });
    });

    const offState = window.agentDesktop.onState((payload) => {
      const hasSessionTasksPayload = Array.isArray(payload?.tasks);
      if (payload?.summary) {
        setSummaries((prev) => upsertSummary(prev, payload.summary));
        if (payload.summary.id === activeSessionIdRef.current) {
          setComposerIntent(restoreComposerIntent(payload.summary));
          setActiveDetail((prev) => {
            if (!prev) return prev;
            const nextHistory = mergeSessionHistorySnapshot(
              prev.history,
              Array.isArray(payload.history) ? payload.history : undefined,
            );
            const next = {
              ...prev,
              ...payload.summary,
              ...(Array.isArray(nextHistory) ? { history: nextHistory } : {}),
              ...(hasSessionTasksPayload ? { tasks: payload.tasks } : {}),
            };
            activeDetailRef.current = next;
            return next;
          });
        }
      }
      if (!payload?.summary && hasSessionTasksPayload && payload?.sessionId === activeSessionIdRef.current) {
        setActiveDetail((prev) => {
          if (!prev) return prev;
          const next = { ...prev, tasks: payload.tasks };
          activeDetailRef.current = next;
          return next;
        });
      }
      if (payload?.busy === false && payload?.sessionId) {
        flushQueuedMessagesRef.current(payload.sessionId);
      }
    });

    const offBackgroundTasks = window.agentDesktop.onBackgroundTasks((payload) => {
      if (!payload?.sessionId) return;
      setBackgroundTasks((prev) => ({ ...prev, [payload.sessionId]: payload.tasks ?? [] }));
    });

    const offPermission = window.agentDesktop.onPermission((payload) => {
      if (payload?.sessionId !== activeSessionIdRef.current) return;
      const toolName = payload?.request?.tool_name || 'Tool';
      const notice = getToolPermissionNotice(toolName);
      showPermissionNotice(notice, 'info', 4000);
    });

    const offQuestionRequest = window.agentDesktop.onQuestionRequest((payload) => {
      if (!payload?.requestId || !payload?.sessionId) return;
      updateQuestionRequests((prev) => [
        ...prev.filter((entry) => entry.requestId !== payload.requestId),
        payload,
      ]);
      if (payload.sessionId !== activeSessionIdRef.current) {
        showPermissionNotice('另一个会话正在等待你回答问题', 'info', 0);
      }
    });

    const offMeta = window.agentDesktop.onSessionMeta((summary) => {
      setSummaries((prev) => upsertSummary(prev, summary));
      if (summary.id === activeSessionIdRef.current) {
        setComposerIntent(restoreComposerIntent(summary));
        setActiveDetail((prev) => {
          if (!prev) return prev;
          const next = { ...prev, ...summary };
          activeDetailRef.current = next;
          return next;
        });
      }
    });

    const offSessionHistory = window.agentDesktop.onSessionHistory((payload) => {
      if (!payload?.sessionId || !Array.isArray(payload.history)) return;
      if (payload.summary) {
        setSummaries((prev) => upsertSummary(prev, payload.summary!));
      }
      if (payload.sessionId === activeSessionIdRef.current) {
        setActiveDetail((prev) => {
          if (!prev) return prev;
          const nextHistory = mergeSessionHistorySnapshot(prev.history, payload.history);
          const next = {
            ...prev,
            ...(payload.summary || {}),
            history: nextHistory || prev.history || [],
            ...(Array.isArray(payload.tasks) ? { tasks: payload.tasks } : {}),
          };
          activeDetailRef.current = next;
          return next;
        });
      }
    });

    const offRemoved = window.agentDesktop.onSessionRemoved(({ sessionId }) => {
      setSummaries((prev) => prev.filter((entry) => entry.id !== sessionId));
      updateQuestionRequests((prev) => prev.filter((entry) => entry.sessionId !== sessionId));
      if (sessionId === activeSessionIdRef.current) {
        navigateToHome();
      }
    });

    const offAppsChanged = window.agentDesktop.onAppsChanged((payload) => {
      const changedName = payload?.app?.name;
      if (changedName && selectedAssistant?.name === 'app-builder-assistant') {
        setSelectedAppName(changedName);
        void loadAppVersions(changedName);
      }
      void refreshApps();
    });

    const offWorkspaceChanged = window.agentDesktop.onWorkspaceChanged((payload) => {
      if (payload?.sessionId !== activeSessionIdRef.current) return;
      if (workspaceRefreshTimerRef.current) {
        window.clearTimeout(workspaceRefreshTimerRef.current);
      }
      workspaceRefreshTimerRef.current = window.setTimeout(() => {
        workspaceRefreshTimerRef.current = null;
        void refreshWorkspaceSnapshot();
      }, 120);
    });

    const offSettingsChanged = window.agentDesktop.onSettingsChanged((payload) => {
      applyDesktopSettings(payload);
    });

    const offProjectsChanged = window.agentDesktop.onProjectsChanged(() => {
      setProjectRefreshSignal((value) => value + 1);
      void refreshProjects();
      void refreshSummaries();
    });

    const offAssistantsChanged = window.agentDesktop.onAssistantsChanged(() => {
      void refreshAssistants();
    });

    const connectorChangedHandler = window.agentDesktop.ipcOn('connector-hub:changed', () => {
      void refreshConnectors();
    });

    return () => {
      if (workspaceRefreshTimerRef.current) {
        window.clearTimeout(workspaceRefreshTimerRef.current);
        workspaceRefreshTimerRef.current = null;
      }
      offEvent();
      offState();
      offBackgroundTasks();
      offPermission();
      offQuestionRequest();
      offMeta();
      offSessionHistory();
      offRemoved();
      offAppsChanged();
      offWorkspaceChanged();
      offSettingsChanged();
      offProjectsChanged();
      offAssistantsChanged();
      window.agentDesktop.ipcOff('connector-hub:changed', connectorChangedHandler);
    };
  }, [applyDesktopSettings, loadAppVersions, navigateToHome, refreshApps, refreshAssistants, refreshConnectors, refreshProjects, refreshSummaries, refreshWorkspaceSnapshot, selectedAssistant, showPermissionNotice, updateQuestionRequests]);

  const baseSidebarSessions = React.useMemo(
    () => toSidebarSessions(summaries, pinnedIds),
    [summaries, pinnedIds, sessionAgentModes]
  );
  const sidebarAppShortcuts = React.useMemo(
    () => apps.filter((app) => appShortcutIds.has(getStoredAppKey(app))),
    [apps, appShortcutIds]
  );
  const sidebarAppShortcutIds = React.useMemo(
    () => new Set(sidebarAppShortcuts.map(getStoredAppKey)),
    [sidebarAppShortcuts]
  );

  // Worker threads are built directly from coordinatorTasks (authoritative for
  // list + agentId + status) and workerSubagentResults (authoritative for content).
  // The frozen list accumulates all workers ever seen so completed ones remain
  // visible even after the backend removes them from coordinatorTasks.
  const resolvedWorkerThreads = React.useMemo(() => {
    const live = coordinatorTasks.map((task, index) => {
      const stickyStatus = stickyWorkerTaskStatuses[task.id];
      const taskStatus = mapCoordinatorTaskStatus(task.status);
      const resultKey = task.agentId || task.id;
      const subagentResult = workerSubagentResults[resultKey];
      const subagentStatus = subagentResult?.status === 'completed' || subagentResult?.status === 'failed'
        ? subagentResult.status
        : undefined;
      // isIdle is the SDK-native signal: true means the worker has finished.
      const status: WorkerThreadStatus = stickyStatus
        || subagentStatus
        || (task.isIdle ? (taskStatus === 'failed' ? 'failed' : 'completed') : taskStatus)
        || 'queued';
      // agentId (e.g. "alice@team1") is the key used in .jsonl filenames;
      // task.id is the internal taskId which differs from the file-based agentId.
      const resultText = subagentResult?.resultText || undefined;
      const summary = resultText || undefined;
      const messages = subagentResult?.events?.length
        ? buildWorkerRenderMessagesFromSubagentEvents(subagentResult.events)
        : [];
      return {
        id: task.id,
        title: task.description || task.name || `Worker ${index + 1}`,
        prompt: '',
        status,
        agentId: task.agentId || task.id,
        description: task.description,
        summary,
        resultText,
        messages,
      };
    });

    const frozen = frozenWorkerThreadsRef.current;
    if (live.length === 0 && frozen.length === 0) return [];

    // Detect a genuinely new coordinator run vs incremental task spawning within
    // the same run.
    //
    // Workers are spawned one by one: the first poll may show [A], the next [A,B],
    // then [A,B,C]. Each arrival has hasNewTasks=true, but the OLD task IDs are
    // still present in live — so this is the same run, not a new one.
    //
    // A truly new run is: new task IDs appeared AND ALL previous frozen IDs have
    // disappeared from live (the SDK cleared the old run's task list).
    const frozenIds = new Set(frozen.map((t) => t.id));
    const liveIds  = new Set(live.map((t) => t.id));
    const hasNewTasks = live.some((t) => !frozenIds.has(t.id));
    const allOldGone  = frozen.every((t) => !liveIds.has(t.id));
    if (hasNewTasks && frozen.length > 0 && allOldGone) {
      // New run started — archive the previous run's workers, then reset frozen.
      // Can't call setState here (inside memo), so signal via ref; the effect below
      // will pick this up and update archivedWorkerRounds state.
      pendingArchiveRef.current = frozen;
      frozenWorkerThreadsRef.current = live;
      return live;
    }

    // Merge: preserve original ordering from frozen, update with live data where
    // available, and append any brand-new workers not yet in frozen.
    const liveById = new Map(live.map((t) => [t.id, t]));
    const merged = [
      ...frozen.map((t) => {
        const liveVersion = liveById.get(t.id);
        if (liveVersion) return liveVersion;
        // Task no longer in live (completed and removed by backend). Re-apply the
        // latest sticky status and worker results so the panel shows correct state.
        const stickyStatus = stickyWorkerTaskStatuses[t.id];
        const resultKey = t.agentId || t.id;
        const subagentResult = workerSubagentResults[resultKey];
        const resultText = subagentResult?.resultText || t.resultText;
        const messages = subagentResult?.events?.length
          ? buildWorkerRenderMessagesFromSubagentEvents(subagentResult.events)
          : t.messages;
        return {
          ...t,
          status: (stickyStatus || t.status) as WorkerThreadStatus,
          resultText,
          summary: resultText || t.summary,
          messages,
        };
      }),
      ...live.filter((t) => !frozenIds.has(t.id)),
    ];

    frozenWorkerThreadsRef.current = merged;
    return merged;
  }, [coordinatorTasks, stickyWorkerTaskStatuses, workerSubagentResults]);

  React.useEffect(() => {
    if (!activeSessionId) return;
    if (coordinatorTasks.length === 0 && activeDetail?.busy) return;

    let cancelled = false;
    void (async () => {
      try {
        const workerResultsRes = await window.agentDesktop.getWorkerResults({ sessionId: activeSessionId });
        if (cancelled || activeSessionIdRef.current !== activeSessionId) return;
        if (workerResultsRes?.results) {
          setWorkerSubagentResults((prev) => ({ ...prev, ...workerResultsRes.results }));
        }
      } catch {
        // Worker result files are best-effort UI state; polling will retry.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeSessionId, activeDetail?.busy, coordinatorTasks.length]);

  React.useEffect(() => {
    if (!activeSessionId) return;

    const currentTaskIds = new Set(coordinatorTasks.map((t) => t.id));

    // Two complementary signals for task completion:
    // 1. task.isIdle === true  — SDK-native: task finished but still in the list
    // 2. task disappeared from list — SDK sometimes removes tasks without status update
    const prevIds = prevCoordinatorTaskIdsRef.current;
    const disappearedIds = [...prevIds].filter(
      (id) => !currentTaskIds.has(id) && !refreshedTerminalWorkerIdsRef.current.has(id),
    );
    prevCoordinatorTaskIdsRef.current = currentTaskIds;

    const nextSticky: Record<string, 'completed' | 'failed'> = {};
    for (const task of coordinatorTasks) {
      const taskStatus = mapCoordinatorTaskStatus(task.status);
      // isIdle is the SDK-native signal that a worker finished (primary source)
      if (task.isIdle || taskStatus === 'completed' || taskStatus === 'failed') {
        nextSticky[task.id] = taskStatus === 'failed' ? 'failed' : 'completed';
      }
    }
    // Disappeared tasks: treat as completed (SDK sometimes removes without status)
    for (const id of disappearedIds) {
      nextSticky[id] = 'completed';
    }

    const newTerminalTaskIds = Object.keys(nextSticky).filter(
      (taskId) => !refreshedTerminalWorkerIdsRef.current.has(taskId),
    );

    if (Object.keys(nextSticky).length > 0) {
      setStickyWorkerTaskStatuses((prev) => {
        let changed = false;
        const merged = { ...prev };
        for (const [taskId, status] of Object.entries(nextSticky)) {
          if (merged[taskId] !== status) {
            merged[taskId] = status;
            changed = true;
          }
        }
        return changed ? merged : prev;
      });
    }

    if (newTerminalTaskIds.length === 0) return;

    newTerminalTaskIds.forEach((taskId) => {
      refreshedTerminalWorkerIdsRef.current.add(taskId);
    });

    void (async () => {
      try {
        const workerResultsRes = await window.agentDesktop.getWorkerResults({ sessionId: activeSessionId });
        if (activeSessionIdRef.current !== activeSessionId) return;
        if (workerResultsRes?.results) {
          setWorkerSubagentResults((prev) => ({ ...prev, ...workerResultsRes.results }));
        }
      } catch {
        // ignore refresh failures; polling will retry on the next change
      }
    })();
  }, [activeSessionId, coordinatorTasks]);

  // chatMessages is built exclusively from session history.
  // The coordinator agent produces its own formatted summary in the history;
  // the UI must not generate its own summary on top of it.
  // Worker status is shown in WorkerThreadPanel, not injected into chatMessages.
  const chatMessages = React.useMemo(() => {
    const messages = buildMainChatRenderMessagesFromHistory(activeDetail?.history || []);
    // Orphaned tool calls: an aborted turn may end without a result event, so
    // running/pending tools would spin forever. Once the session is idle,
    // mark them as interrupted.
    if (!activeDetail?.busy) {
      for (const message of messages) {
        if (message.type === 'tool_use' && (message.status === 'running' || message.status === 'pending')) {
          message.status = 'error';
          message.statusText = '已中断';
        }
        if ((message.type === 'assistant_text' || message.type === 'thinking') && message.streaming) {
          message.streaming = false;
        }
      }
    }
    return messages;
  }, [activeDetail?.history, activeDetail?.busy]);

  const visibleChatMessageCount = React.useMemo(
    () => countSessionMessages(activeDetail?.history || []),
    [activeDetail?.history],
  );

  const sidebarSessions = React.useMemo(
    () => baseSidebarSessions.map((session) => (
      questionRequests.some((request) => request.sessionId === session.id)
        ? {
            ...session,
            preview: '等待你回答问题',
          }
        : session
    )),
    [baseSidebarSessions, questionRequests],
  );

  const activeQuestionRequest = React.useMemo(() => {
    return questionRequests.find((request) => request.sessionId === activeSessionId)
      || questionRequests[0]
      || null;
  }, [activeSessionId, questionRequests]);

  React.useEffect(() => {
    if (resolvedWorkerThreads.length === 0) {
      setActiveWorkerThreadId(null);
      return;
    }
    setActiveWorkerThreadId((current) => (
      current && resolvedWorkerThreads.some((thread) => thread.id === current)
        ? current
        : null
    ));
  }, [resolvedWorkerThreads]);

  const workspaceTree = React.useMemo(() => {
    if (!activeDetail?.workspace) return [];
    const root = directoryCache.get(activeDetail.workspace);
    if (!root?.items) return [];
    return filterVisibleNodes(root.items, workspaceQuery, directoryCache, expandedDirs);
  }, [activeDetail?.workspace, directoryCache, expandedDirs, workspaceQuery]);

  const activePreview = React.useMemo(
    () => previewTabs.find((entry) => entry.path === activePreviewPath) || null,
    [previewTabs, activePreviewPath]
  );
  const previewDrawerVisible = Boolean(
    activeView === 'chat' && activeSessionId && previewTabs.length > 0 && activePreview !== null
  );

  const restoreWorkspacePanelAfterPreview = React.useCallback(() => {
    if (!activeSessionId) return;
    if (!previewAutoCollapsedRightRef.current) return;
    if (previewAutoCollapsedBySessionRef.current !== activeSessionId) return;
    previewAutoCollapsedRightRef.current = false;
    previewAutoCollapsedBySessionRef.current = null;
    setLayout((prev) => (prev.rightCollapsed ? { ...prev, rightCollapsed: false } : prev));
  }, [activeSessionId]);

  const openPreviewDrawer = React.useCallback((file: WorkspacePreviewData) => {
    setSelectedFilePath(file.path);
    setPreviewTabs((prev) => {
      const existing = prev.find((entry) => entry.path === file.path);
      const nextFile = enrichWorkspacePreviewFile(file, activeSessionId, activeDetail?.workspace, existing);
      if (existing) {
        return prev.map((entry) => (entry.path === file.path ? nextFile : entry));
      }
      return [...prev, nextFile];
    });
    setActivePreviewPath(file.path);
    setActiveView('chat');
    setLayout((prev) => {
      if (prev.rightCollapsed) return prev;
      previewAutoCollapsedRightRef.current = true;
      previewAutoCollapsedBySessionRef.current = activeSessionId;
      return { ...prev, rightCollapsed: true };
    });
  }, [activeDetail?.workspace, activeSessionId]);

  const handleClosePreviewTab = React.useCallback((path: string) => {
    setPreviewTabs((prev) => {
      const next = prev.filter((entry) => entry.path !== path);
      const nextActivePath = next[0]?.path || null;
      setActivePreviewPath((current) => {
        if (current !== path) return current;
        return nextActivePath;
      });
      setSelectedFilePath((current) => (current === path ? nextActivePath : current));
      if (next.length === 0) {
        restoreWorkspacePanelAfterPreview();
      }
      return next;
    });
  }, [restoreWorkspacePanelAfterPreview]);

  const handleClosePreviewDrawer = React.useCallback(() => {
    setPreviewTabs([]);
    setActivePreviewPath(null);
    setSelectedFilePath(null);
    restoreWorkspacePanelAfterPreview();
  }, [restoreWorkspacePanelAfterPreview]);

  const handleUpdatePreviewTab = React.useCallback((path: string, patch: Partial<WorkspacePreviewData>) => {
    setPreviewTabs((prev) => prev.map((entry) => (entry.path === path ? { ...entry, ...patch } : entry)));
  }, []);

  const handleCloseOtherPreviewTabs = React.useCallback((path: string) => {
    setPreviewTabs((prev) => {
      const active = prev.find((entry) => entry.path === path) || null;
      const next = active ? [active] : [];
      setActivePreviewPath(active?.path || null);
      setSelectedFilePath(active?.path || null);
      if (next.length === 0) restoreWorkspacePanelAfterPreview();
      return next;
    });
  }, [restoreWorkspacePanelAfterPreview]);

  const handleCloseAllPreviewTabs = React.useCallback(() => {
    handleClosePreviewDrawer();
  }, [handleClosePreviewDrawer]);

  const openRightBrowser = React.useCallback(async (payload: {
    url?: string;
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
  }) => {
    if (!payload?.url) return;
    const payloadSessionId = typeof payload.sessionId === 'string' && payload.sessionId
      ? payload.sessionId
      : null;
    let targetSessionId = payloadSessionId || activeSessionIdRef.current;
    if (payloadSessionId && payloadSessionId !== activeSessionIdRef.current) {
      const opened = await openSession(payloadSessionId);
      if (!opened) return;
      targetSessionId = payloadSessionId;
    }

    void openBrowserPanelUrl(targetSessionId, payload.url, payload.connectorAuth || null, payload.mcpAuth || null)
      .catch((error: unknown) => {
        console.warn('[browser] failed to open tab:', error instanceof Error ? error.message : error);
      });
    if (targetSessionId) {
      setActiveView('chat');
      setLayout((prev) => ({
        ...prev,
        rightCollapsed: false,
        rightWidth: clamp(Math.max(prev.rightWidth || DEFAULT_LAYOUT.rightWidth, 440), RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max),
      }));
      setBrowserOpenSignal((value) => value + 1);
    }
  }, [openSession]);

  React.useEffect(() => {
    const unsubscribe = window.agentDesktop.browser.onOpen((payload) => {
      void openRightBrowser(payload);
    });
    return unsubscribe;
  }, [openRightBrowser]);

  React.useEffect(() => {
    if (previewTabs.length === 0) {
      setActivePreviewPath(null);
      restoreWorkspacePanelAfterPreview();
    }
  }, [previewTabs.length, restoreWorkspacePanelAfterPreview]);

  React.useEffect(() => {
    const unsubscribe = previewIpc.onOpen((payload) => {
      const path = `preview:${payload.contentType}:${payload.metadata?.title || payload.content.slice(0, 48)}`;
      openPreviewDrawer({
        path,
        relativePath: String(payload.metadata?.title || payload.metadata?.fileName || path),
        content: payload.content,
        contentType: payload.contentType,
        language: String(payload.metadata?.language || ''),
        mimeType: undefined,
        metadata: payload.metadata,
        size: typeof payload.content === 'string' ? payload.content.length : 0,
        truncated: false,
      });
    });
    return unsubscribe;
  }, [openPreviewDrawer]);

  const toggleSidebar = React.useCallback((side: 'left' | 'right') => {
    setLayout((prev) => (
      side === 'left'
        ? { ...prev, leftCollapsed: !prev.leftCollapsed }
        : { ...prev, rightCollapsed: !prev.rightCollapsed }
    ));
  }, []);

  const startResize = React.useCallback((side: 'left' | 'preview' | 'right', clientX: number) => {
    const start = layoutRef.current;
    if (side === 'left' && start.leftCollapsed) return;
    if (side === 'right' && start.rightCollapsed) return;

    document.body.classList.add('layout-resizing');

    const onMouseMove = (event: MouseEvent) => {
      const delta = event.clientX - clientX;
      setLayout((prev) => (
        side === 'left'
          ? {
              ...prev,
              leftWidth: clamp(start.leftWidth + delta, LEFT_WIDTH_RANGE.min, LEFT_WIDTH_RANGE.max),
            }
          : side === 'right'
            ? {
              ...prev,
              rightWidth: clamp(start.rightWidth - delta, RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max),
            }
            : {
              ...prev,
              previewWidth: clamp(start.previewWidth - delta, PREVIEW_WIDTH_RANGE.min, PREVIEW_WIDTH_RANGE.max),
            }
      ));
    };

    const onMouseUp = () => {
      document.body.classList.remove('layout-resizing');
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleNewSession = React.useCallback(async () => {
    navigateToHome({ resetInput: true, resetApp: true });
  }, [navigateToHome]);

  const handleSelectSession = React.useCallback(async (sessionId: string) => {
    setAuditFocusTarget(null);
    const opened = await openSession(sessionId);
    if (!opened) return;
    setActiveView('chat');
  }, [openSession]);

  const handleCreateProjectSession = React.useCallback(async (project: Project) => {
    const sessionId = await createAndOpenSession(project.name, undefined, selectedAssistant?.name, project.id);
    if (!sessionId) return;
    await refreshSummaries();
    await refreshProjects();
    setActiveView('chat');
  }, [createAndOpenSession, refreshProjects, refreshSummaries, selectedAssistant?.name]);

  const handleDeleteSession = React.useCallback(async (sessionId: string) => {
    const result = await window.agentDesktop.deleteSession({ sessionId }) as
      { ok?: boolean; removedCronTasks?: number } | undefined;
    if (result?.removedCronTasks) {
      const notice = `会话已删除，同时清理了 ${result.removedCronTasks} 个定时任务`;
      showPermissionNotice(notice, 'info', 5000);
    }
    if (activeSessionId === sessionId) {
      navigateToHome({ forceDiscardDirty: true });
    }
    // Remove from sessionAgentModes map
    const nextModes = new Map(sessionAgentModes);
    nextModes.delete(sessionId);
    persistSessionAgentModes(nextModes);
    await refreshSummaries();
  }, [activeSessionId, navigateToHome, refreshSummaries, sessionAgentModes, persistSessionAgentModes, showPermissionNotice]);

  const handleRenameSession = React.useCallback(async (sessionId: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      await window.agentDesktop.updateSession({ sessionId, title: newTitle });
    } catch (e) {
      void window.agentDesktop.logWrite({
        level: 'error',
        category: 'renderer',
        message: 'Rename session failed',
        data: {
          sessionId,
          title: newTitle,
          error: e instanceof Error ? e.message : String(e),
        },
      });
    }
    setSummaries((prev) => prev.map((entry) =>
      entry.id === sessionId ? { ...entry, title: newTitle } : entry
    ));
    if (activeSessionId === sessionId) {
      setActiveDetail((prev) => (prev ? { ...prev, title: newTitle } : prev));
    }
  }, [activeSessionId]);

  const handleTogglePin = React.useCallback((sessionId: string) => {
    const next = new Set(pinnedIds);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    persistPinned(next);
  }, [persistPinned, pinnedIds]);

  const dispatchToSession = React.useCallback(async (
    sessionId: string,
    prompt: string,
    intent: ComposerIntent,
    files?: Array<{ name: string; path: string }>,
    skills?: Array<{ name: string; displayName?: string; source?: string }>,
  ) => {
    // Reset auxiliary tracking state before sending. frozenWorkerThreadsRef is
    // intentionally NOT cleared here so multi-turn coordinators keep their
    // worker panel visible during follow-up turns. The resolvedWorkerThreads
    // memo resets frozen automatically when genuinely new task IDs appear.
    refreshedTerminalWorkerIdsRef.current = new Set();
    prevCoordinatorTaskIdsRef.current = new Set();
    setStickyWorkerTaskStatuses({});
    setWorkerSubagentResults({});

    await window.agentDesktop.send({
      sessionId,
      prompt,
      skills,
      mode: intent === 'chat' ? undefined : intent,
      appName: selectedAssistant?.name === 'app-builder-assistant' ? selectedAppName : undefined,
      files: files?.map(f => f.path),
      coordinatorMode: intent === 'coordinator' ? true : undefined,
    });
  }, [selectedAppName, selectedAssistant]);

  const handleRunCliConnectorSetup = React.useCallback(async (
    connector: InstalledConnector,
    cli: Record<string, any> | null,
  ) => {
    const sessionId = await createAndOpenSession(
      `设置 ${connector.name} 连接器`,
      undefined,
      undefined,
      undefined,
      [connector.id],
    );
    setActiveView('chat');
    await dispatchToSession(sessionId, buildCliConnectorSetupPrompt(connector, cli), 'chat');
  }, [createAndOpenSession, dispatchToSession]);

  const handleAuthenticateMcpConnector = React.useCallback(async (connector: InstalledConnector) => {
    const serverName = connector.mcpServerNames?.[0] || connector.id;
    try {
      const sessionId = await createAndOpenSession(
        `授权 ${connector.name} 连接器`,
        undefined,
        undefined,
        undefined,
        [connector.id],
      );
      setActiveView('chat');
      await new Promise((resolve) => window.setTimeout(resolve, 250));
      const result = await window.agentDesktop.authenticateMcpServer({ name: serverName, sessionId });
      await refreshConnectors();
      const openedAuthUrl = (result as any)?.auth?.status === 'authorization_url_opened';
      const notice = openedAuthUrl
        ? `${connector.name} 授权页已打开，请在右侧浏览器完成授权`
        : `${connector.name} 授权已完成`;
      showPermissionNotice(notice, 'info', 2500);
    } catch (err) {
      const rawMessage = getErrorMessage(err);
      const reason = cleanIpcErrorMessage(err);
      showPermissionNotice(`${connector.name} 授权失败：${reason}`, 'error', 6000);
      pushAppNotification({
        severity: 'error',
        source: '连接器授权',
        title: `${connector.name} 授权失败`,
        message: reason,
        details: [
          `连接器：${connector.name} (${connector.id})`,
          `MCP 服务：${serverName}`,
          'IPC 方法：agent:mcp-authenticate',
          `原始错误：${rawMessage}`,
          err instanceof Error && err.stack ? `调用栈：\n${err.stack}` : '',
        ].filter(Boolean).join('\n'),
      });
    }
  }, [createAndOpenSession, pushAppNotification, refreshConnectors, showPermissionNotice]);

  // Dispatch the next queued message when a turn ends. Kept in a ref so the
  // once-registered agent:state listener always calls the latest version.
  const flushQueuedMessagesRef = React.useRef<(sessionId: string) => void>(() => {});
  React.useEffect(() => {
    flushQueuedMessagesRef.current = (sessionId: string) => {
      const queue = queuedMessagesRef.current[sessionId] ?? [];
      if (queue.length === 0) return;
      const [next, ...rest] = queue;
      updateQueue(sessionId, () => rest);
      void dispatchToSession(sessionId, next.prompt, next.intent, next.files, next.skills).catch((err) => {
        console.error('[queued message] send failed:', err);
        updateQueue(sessionId, (prev) => [next, ...prev]);
      });
    };
  }, [dispatchToSession, updateQueue]);

  const submitPrompt = React.useCallback(async (
    intent: ComposerIntent,
    files?: Array<{ name: string; path: string }>,
    workspace?: string,
    skills?: Array<{ name: string; displayName?: string; source?: string }>,
  ) => {
    const hasText = input.trim().length > 0;
    const hasFiles = files && files.length > 0;
    if (!hasText && !hasFiles) return;
    if (planDecisionBusy) return;

    const prompt = input.trim();

    // Session is busy: queue the message; it is dispatched automatically when
    // the current turn ends (same as typing while the CLI REPL is running).
    if (activeDetail?.busy && activeSessionId) {
      const queued: QueuedMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt,
        skills,
        files,
        intent,
      };
      updateQueue(activeSessionId, (prev) => [...prev, queued]);
      setInput('');
      return;
    }

    setInput('');

    let sessionId = activeSessionId;
    let sessionJustCreated = false;
    if (!sessionId) {
      // Reuse an in-flight creation so a re-entrant submit (double-send or a
      // retry after an errored first turn) binds to the SAME session/workspace
      // instead of spawning a second directory.
      if (!creatingSessionRef.current) {
        creatingSessionRef.current = createAndOpenSession(
          undefined,
          workspace,
          selectedAssistant?.name,
          undefined,
          draftConnectorIds,
        ).finally(() => {
          creatingSessionRef.current = null;
        });
        sessionJustCreated = true;
      }
      sessionId = await creatingSessionRef.current;
    }
    if (!sessionId) return;

    // If we just created a new session and have files, copy them to the new workspace
    let filesToSend = files;
    if (sessionJustCreated && hasFiles) {
      const newFiles: Array<{ name: string; path: string }> = [];
      for (const file of files!) {
        const result = await window.agentDesktop.copyFileToWorkspace({
          sessionId,
          sourcePath: file.path,
          fileName: file.name,
        }) as { path: string } | { error: string };
        if ('path' in result) {
          newFiles.push({ name: file.name, path: result.path });
        }
      }
      filesToSend = newFiles;
    }

    await dispatchToSession(sessionId, prompt, intent, filesToSend, skills);
  }, [activeDetail?.busy, activeSessionId, createAndOpenSession, dispatchToSession, draftConnectorIds, input, planDecisionBusy, selectedAssistant, updateQueue]);

  const handleSend = React.useCallback(async (
    files?: Array<{ name: string; path: string }>,
    workspace?: string,
    skills?: Array<{ name: string; displayName?: string; source?: string }>,
  ) => {
    await submitPrompt(composerIntent, files, workspace, skills);
  }, [composerIntent, submitPrompt]);

  const handleApprovePlan = React.useCallback(async () => {
    if (!activeSessionId) return;
    setPlanDecisionBusy(true);
    try {
      await window.agentDesktop.approvePlan({ sessionId: activeSessionId });
      const detail = await window.agentDesktop.getSession({ sessionId: activeSessionId });
      setActiveDetail(detail);
      setSummaries((prev) => upsertSummary(prev, detail));
    } finally {
      setPlanDecisionBusy(false);
    }
  }, [activeSessionId]);

  const handleRejectPlan = React.useCallback(async () => {
    if (!activeSessionId) return;
    setPlanDecisionBusy(true);
    try {
      const detail = await window.agentDesktop.rejectPlan({ sessionId: activeSessionId });
      const nextDetail = await window.agentDesktop.getSession({ sessionId: activeSessionId });
      setActiveDetail(nextDetail);
      setSummaries((prev) => upsertSummary(prev, detail?.summary || nextDetail));
    } finally {
      setPlanDecisionBusy(false);
    }
  }, [activeSessionId]);

  const handleSubmitQuestion = React.useCallback(async (
    request: AskUserQuestionRequest,
    answers: Record<string, string>,
    annotations?: AskUserQuestionAnnotations,
  ) => {
    await window.agentDesktop.answerQuestion({
      requestId: request.requestId,
      sessionId: request.sessionId,
      answers,
      annotations,
    });
    updateQuestionRequests((prev) => prev.filter((entry) => entry.requestId !== request.requestId));
    dismissPermissionNotice();
  }, [dismissPermissionNotice, updateQuestionRequests]);

  const handleRejectQuestion = React.useCallback(async (request: AskUserQuestionRequest) => {
    await window.agentDesktop.rejectQuestion({
      requestId: request.requestId,
      sessionId: request.sessionId,
      message: 'User declined to answer questions',
    });
    updateQuestionRequests((prev) => prev.filter((entry) => entry.requestId !== request.requestId));
    dismissPermissionNotice();
  }, [dismissPermissionNotice, updateQuestionRequests]);

  const handleStop = React.useCallback(async () => {
    if (!activeSessionId) return;
    // Interrupt drops queued messages back into the input (REPL Esc behavior).
    // Clear the queue before aborting so the busy=false event doesn't flush it.
    const queue = queuedMessagesRef.current[activeSessionId] ?? [];
    if (queue.length > 0) {
      updateQueue(activeSessionId, () => []);
      const restored = queue.map((q) => q.prompt).filter(Boolean).join('\n');
      if (restored) {
        setInput((prev) => (prev.trim() ? `${prev}\n${restored}` : restored));
      }
    }
    updateQuestionRequests((prev) => prev.filter((entry) => entry.sessionId !== activeSessionId));
    await window.agentDesktop.abort({ sessionId: activeSessionId });
  }, [activeSessionId, updateQueue, updateQuestionRequests]);

  const handleRemoveQueuedMessage = React.useCallback((id: string) => {
    if (!activeSessionId) return;
    updateQueue(activeSessionId, (prev) => prev.filter((q) => q.id !== id));
  }, [activeSessionId, updateQueue]);

  const handlePickWorkspace = React.useCallback(async () => {
    if (!activeSessionId) return;
    if (!confirmDiscardDirtyPreviewTabs('当前存在未保存的预览修改，确认切换工作区？')) {
      return;
    }
    const dir = await window.agentDesktop.pickDirectory();
    if (!dir) return;
    const detail = await window.agentDesktop.setSessionWorkspace({ sessionId: activeSessionId, workspace: dir });
    setActiveDetail(detail);
    setSummaries((prev) => prev.map((entry) => (entry.id === detail.id ? detail : entry)));
    setDirectoryCache(new Map());
    setExpandedDirs(new Set());
    setSelectedFilePath(null);
    setPreviewTabs([]);
    setActivePreviewPath(null);
  }, [activeSessionId, confirmDiscardDirtyPreviewTabs]);

  const handleRefreshWorkspace = React.useCallback(async () => {
    await refreshWorkspaceSnapshot();
  }, [refreshWorkspaceSnapshot]);

  const handleOpenWorkspace = React.useCallback(async () => {
    if (!activeSessionId) return;
    await window.agentDesktop.openWorkspace({ sessionId: activeSessionId });
  }, [activeSessionId]);

  const handleToggleFolder = React.useCallback(async (path: string) => {
    const next = new Set(expandedDirs);
    if (next.has(path)) {
      next.delete(path);
      setExpandedDirs(next);
      return;
    }
    next.add(path);
    setExpandedDirs(next);
    try {
      const data = await window.agentDesktop.listWorkspaceDir({
        sessionId: activeSessionId,
        dirPath: path,
      });
      setDirectoryCache((prev) => new Map(prev).set(path, data));
    } catch {
      setExpandedDirs((prev) => {
        const rolled = new Set(prev);
        rolled.delete(path);
        return rolled;
      });
    }
  }, [activeSessionId, expandedDirs]);

  const handleSelectFile = React.useCallback(async (path: string) => {
    if (!activeSessionId) return;
    const existing = previewTabsRef.current.find((entry) => entry.path === path);
    if (existing) {
      openPreviewDrawer(existing);
      return;
    }
    const data = await window.agentDesktop.readWorkspaceFile({
      sessionId: activeSessionId,
      filePath: path,
    });
    openPreviewDrawer(data);
  }, [activeSessionId, openPreviewDrawer]);

  const handleLaunchApp = React.useCallback(async (name: string) => {
    await window.agentDesktop.launchApp({ name });
  }, []);

  const handleOpenEmbeddedApp = React.useCallback((name: string) => {
    setEmbeddedAppName(name);
    setActiveView('embedded-app');
  }, []);

  const handleRemoveAppShortcut = React.useCallback((name: string) => {
    const app = apps.find((entry) => entry.name === name || entry.id === name);
    if (!app) return;
    const next = new Set(appShortcutIds);
    next.delete(getStoredAppKey(app));
    persistAppShortcuts(next);
  }, [apps, appShortcutIds, persistAppShortcuts]);

  const handleAddAppShortcut = React.useCallback((name: string) => {
    const app = apps.find((entry) => entry.name === name || entry.id === name);
    if (!app) return;
    const next = new Set(appShortcutIds);
    next.add(getStoredAppKey(app));
    persistAppShortcuts(next);
  }, [apps, appShortcutIds, persistAppShortcuts]);

  const handleSelectAssistant = React.useCallback((assistant: InstalledAssistant) => {
    setSelectedAssistant(assistant);
  }, []);

  const handleClearAssistant = React.useCallback(() => {
    setSelectedAssistant(null);
  }, []);

  const selectedConnectorIds = React.useMemo(
    () => activeSessionId ? (activeDetail?.connectorIds ?? []) : draftConnectorIds,
    [activeDetail?.connectorIds, activeSessionId, draftConnectorIds],
  );

  React.useEffect(() => {
    const installedIds = new Set(installedConnectors.map((connector) => connector.id));
    setDraftConnectorIds((prev) => prev.filter((id) => installedIds.has(id)));
  }, [installedConnectors]);

  const handleToggleConnector = React.useCallback(async (connector: InstalledConnector) => {
    const current = activeSessionId ? (activeDetailRef.current?.connectorIds ?? []) : draftConnectorIds;
    const next = current.includes(connector.id)
      ? current.filter((id) => id !== connector.id)
      : [...current, connector.id];

    if (!activeSessionId) {
      setDraftConnectorIds(next);
      return;
    }

    const res = await window.agentDesktop.setSessionConnectors({
      sessionId: activeSessionId,
      connectorIds: next,
    });
    if (!res?.success || !res.data) {
      const message = res?.error || '更新连接器失败';
      showPermissionNotice(message, 'error', 6000);
      pushAppNotification({
        severity: 'error',
        source: '连接器',
        title: `${connector.name} 更新失败`,
        message,
        details: `连接器：${connector.name} (${connector.id})\n会话：${activeSessionId}`,
      });
      return;
    }
    const detail = res.data;
    setActiveDetail(detail);
    activeDetailRef.current = detail;
    setSummaries((prev) => upsertSummary(prev, detail));
  }, [activeSessionId, draftConnectorIds, pushAppNotification, showPermissionNotice]);

  const handleUseConnector = React.useCallback(async (connector: InstalledConnector) => {
    const current = activeSessionId ? (activeDetailRef.current?.connectorIds ?? []) : draftConnectorIds;
    if (!current.includes(connector.id)) {
      await handleToggleConnector(connector);
    }
    setActiveView('chat');
  }, [activeSessionId, draftConnectorIds, handleToggleConnector]);

  const handleConnectorHubError = React.useCallback((error: {
    title: string;
    message: string;
    details?: string;
  }) => {
    const reason = cleanIpcErrorMessage(error.message);
    showPermissionNotice(`${error.title}：${reason}`, 'error', 6000);
    pushAppNotification({
      severity: 'error',
      source: '连接器中心',
      title: error.title,
      message: reason,
      details: [error.details || '', `原始错误：${error.message}`].filter(Boolean).join('\n'),
    });
  }, [pushAppNotification, showPermissionNotice]);

  const handleAuditError = React.useCallback((error: {
    title: string;
    message: string;
    details?: string;
  }) => {
    const reason = cleanIpcErrorMessage(error.message);
    showPermissionNotice(`${error.title}：${reason}`, 'error', 6000);
    pushAppNotification({
      severity: 'error',
      source: '审计中心',
      title: error.title,
      message: reason,
      details: [error.details || '', `原始错误：${error.message}`].filter(Boolean).join('\n'),
    });
  }, [pushAppNotification, showPermissionNotice]);

  const handleAuditNotice = React.useCallback((message: string) => {
    showPermissionNotice(message, 'info', 4500);
  }, [showPermissionNotice]);

  const handleLocateAuditTool = React.useCallback(async (sessionId: string, toolUseId: string) => {
    const opened = await openSession(sessionId);
    if (!opened) {
      handleAuditError({
        title: '定位工具调用失败',
        message: '对应会话不存在或当前无法打开。',
        details: `会话：${sessionId}\n工具调用：${toolUseId}`,
      });
      return;
    }
    setAuditFocusTarget({ sessionId, toolUseId });
  }, [handleAuditError, openSession]);

  const handleIterateExistingApp = React.useCallback(async (name: string) => {
    const appBuilderAssistant = installedAssistants.find(a => a.name === 'app-builder-assistant');
    if (appBuilderAssistant) {
      setSelectedAssistant(appBuilderAssistant);
    }

    const ok = navigateToHome({ preserveIntent: true });
    if (!ok) return;
    await createAndOpenSession(`迭代 ${name}`, undefined, appBuilderAssistant?.name);

    setSelectedAppName(name);
    setComposerIntent('chat');
    setActiveView('chat');
  }, [navigateToHome, createAndOpenSession, installedAssistants]);

  const handleDeleteApp = React.useCallback(async (name: string) => {
    await window.agentDesktop.deleteApp({ name });
    setVersionsByApp((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    await refreshApps();
  }, [refreshApps]);

  const handleRollbackApp = React.useCallback(async (name: string, versionId: string) => {
    const result = await window.agentDesktop.rollbackApp({ name, versionId });
    if (result?.app?.name) {
      setSelectedAppName(result.app.name);
    }
    await refreshApps();
    await loadAppVersions(name);
  }, [loadAppVersions, refreshApps]);

  const autoSaveSettings = React.useCallback(async (key: keyof DesktopSettings, value: any) => {
    try {
      const payload = { [key]: value };
      const saved = await window.agentDesktop.updateSettings(payload);
      applyDesktopSettings(saved);
    } catch (error: any) {
      setSettingsNotice(error?.message || String(error));
    }
  }, [applyDesktopSettings]);

  const autoSaveImageSettings = React.useCallback(async (image: DesktopSettings['image']) => {
    try {
      const saved = await window.agentDesktop.updateSettings({ image });
      applyDesktopSettings(saved);
    } catch (error: any) {
      setSettingsNotice(error?.message || String(error));
    }
  }, [applyDesktopSettings]);

  const saveAppearance = React.useCallback((patch: Partial<DesktopSettings['appearance']>) => {
    const next = { ...appearanceRef.current, ...patch };
    applyAppearance(next);
    void window.agentDesktop.updateSettings({ appearance: next }).then((saved) => {
      applyDesktopSettings(saved);
    }).catch((error: any) => {
      setSettingsNotice(error?.message || String(error));
    });
  }, [applyAppearance, applyDesktopSettings]);

  const handleThemeModeChange = React.useCallback((mode: ThemeMode) => {
    saveAppearance({ themeMode: mode });
  }, [saveAppearance]);

  const handleCssThemeChange = React.useCallback((id: string) => {
    saveAppearance({ cssThemeId: id as DesktopSettings['appearance']['cssThemeId'] });
  }, [saveAppearance]);

  const handleNewSessionModeChange = React.useCallback(async (mode: 'local' | 'remote-direct') => {
    await autoSaveSettings('agentMode', mode);
    // Refresh assistants list based on new mode
    await refreshAssistants(mode);
  }, [autoSaveSettings, refreshAssistants]);

  const renderSettingsView = () => (
    <SettingsView
      settingsDraft={settingsDraft}
      setSettingsDraft={setSettingsDraft}
      settingsNotice={settingsNotice}
      autoSaveSettings={autoSaveSettings}
      autoSaveImageSettings={autoSaveImageSettings}
      themeMode={themeMode}
      setThemeMode={handleThemeModeChange}
      cssThemeId={cssThemeId}
      setCssThemeId={handleCssThemeChange}
      buddyEnabled={isBuddyEnabled()}
      onBuddyEnabledChange={(enabled) => {
        setBuddyEnabled(enabled);
        setForceBuddyUpdate((n) => n + 1);
      }}
    />
  );

  return (
    <div className={`${themeMode === 'dark' ? 'dark' : ''} flex h-screen w-full flex-col overflow-hidden app-shell`}>
      <div className="moss-window-chrome relative shrink-0">
        <div
          className="moss-window-drag h-9"
          style={{ paddingLeft: isMacOS ? 84 : 0 }}
        />
        <div
          className="absolute top-1"
          style={{ right: isMacOS ? 8 : 144 }}
        >
          <NotificationCenter
            notifications={appNotifications}
            onMarkRead={(id) => {
              setAppNotifications((current) => current.map((item) =>
                item.id === id && !item.read ? { ...item, read: true } : item
              ));
            }}
            onMarkAllRead={() => {
              setAppNotifications((current) => current.map((item) =>
                item.read ? item : { ...item, read: true }
              ));
            }}
            onRemove={(id) => {
              setAppNotifications((current) => current.filter((item) => item.id !== id));
            }}
            onClear={() => setAppNotifications([])}
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-h-0 shrink-0 overflow-hidden"
          style={{ width: layout.leftCollapsed ? 68 : layout.leftWidth }}
        >
          <AppSidebar
            sessions={sidebarSessions}
            apps={sidebarAppShortcuts}
            activeSessionId={activeSessionId}
            activeView={activeView}
            appsCount={apps.length}
            projectsCount={projects.length}
            themeMode={themeMode}
            collapsed={layout.leftCollapsed}
            searchQuery={sessionSearchQuery}
            localEnabled={desktopSettings?.localEnabled ?? true}
            remoteEnabled={desktopSettings?.remoteEnabled ?? false}
            newSessionMode={desktopSettings?.agentMode === 'remote-direct' ? 'remote-direct' : 'local'}
            onChangeView={setActiveView}
            onChangeTheme={handleThemeModeChange}
            onSelectSession={handleSelectSession}
            onLaunchApp={handleOpenEmbeddedApp}
            onNewSession={handleNewSession}
            onNewSessionModeChange={handleNewSessionModeChange}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onTogglePin={handleTogglePin}
            onToggleCollapse={() => toggleSidebar('left')}
            onSearchChange={setSessionSearchQuery}
          />
        </div>

        <div
          className={`
            relative hidden w-3 shrink-0 cursor-col-resize bg-transparent transition-colors
            before:absolute before:inset-y-4 before:left-1/2 before:w-px before:-translate-x-1/2 before:rounded-full before:bg-border/80
            hover:before:bg-primary/60 lg:block
          `}
          onMouseDown={(event) => {
            event.preventDefault();
            startResize('left', event.clientX);
          }}
        />

        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          {(bootError || permissionNotice) && (
            <div className="pointer-events-none absolute right-4 top-4 z-20 flex max-w-md flex-col items-end gap-2">
              {bootError ? (
                <NotificationToast
                  message={bootError}
                  severity="error"
                  onDismiss={() => setBootError('')}
                />
              ) : null}
              {permissionNotice ? (
                <NotificationToast
                  message={permissionNotice}
                  severity={permissionNoticeSeverity}
                  onDismiss={dismissPermissionNotice}
                />
              ) : null}
            </div>
          )}
          {activeView === 'chat' ? (
            activeSessionId ? (
              <ChatArea
                messages={chatMessages}
                value={input}
                selectedAppName={selectedAppName}
                loading={Boolean(activeDetail?.busy)}
                readOnlyReason={activeDetail?.resumeReadOnlyReason || null}
                hasActiveSession={Boolean(activeSessionId)}
                sessionTitle={activeDetail?.title || 'New Session'}
                sessionMessageCount={visibleChatMessageCount}
                sessionId={activeSessionId || undefined}
                sessionWorkspace={activeDetail?.workspace || undefined}
                focusedToolUseId={auditFocusTarget?.sessionId === activeSessionId ? auditFocusTarget.toolUseId : undefined}
                pendingPlanApproval={activeDetail?.pendingPlanApproval || null}
                planDecisionBusy={planDecisionBusy}
                leftCollapsed={layout.leftCollapsed}
                rightCollapsed={layout.rightCollapsed}
                composerIntent={composerIntent}
                workerThreads={resolvedWorkerThreads}
                archivedWorkerRounds={archivedWorkerRounds}
                activeWorkerThreadId={activeWorkerThreadId}
                onChange={setInput}
                onComposerIntentChange={setComposerIntent}
                onToggleLeftSidebar={() => toggleSidebar('left')}
                onToggleRightSidebar={() => toggleSidebar('right')}
                onApprovePlan={handleApprovePlan}
                onRejectPlan={handleRejectPlan}
                onSend={handleSend}
                onStop={handleStop}
                onToggleWorkerThread={setActiveWorkerThreadId}
                installedAssistants={installedAssistants}
                selectedAssistant={selectedAssistant}
                onSelectAssistant={handleSelectAssistant}
                onClearAssistant={handleClearAssistant}
                installedConnectors={installedConnectors}
                selectedConnectorIds={selectedConnectorIds}
                onToggleConnector={handleToggleConnector}
                onOpenConnectorHub={() => setActiveView('connectors')}
                onOpenExpertHub={() => setActiveView('experts')}
                remoteEnabled={desktopSettings?.remoteEnabled ?? false}
                newSessionMode={desktopSettings?.agentMode === 'remote-direct' ? 'remote-direct' : 'local'}
                onNewSessionModeChange={handleNewSessionModeChange}
                queuedMessages={queuedMessages[activeSessionId] ?? []}
                onRemoveQueuedMessage={handleRemoveQueuedMessage}
                backgroundTasks={backgroundTasks[activeSessionId] ?? []}
                composerAttachments={composerAttachments}
                onComposerAttachmentsChange={setComposerAttachments}
                contextUsage={contextUsage}
              />
            ) : (
              <ChatArea
                messages={[]}
                value={input}
                selectedAppName={selectedAppName}
                loading={false}
                hasActiveSession={false}
                sessionTitle=""
                sessionMessageCount={0}
                sessionWorkspace={undefined}
                pendingPlanApproval={null}
                planDecisionBusy={false}
                leftCollapsed={layout.leftCollapsed}
                rightCollapsed={layout.rightCollapsed}
                composerIntent={composerIntent}
                workerThreads={[]}
                archivedWorkerRounds={[]}
                activeWorkerThreadId={null}
                onChange={setInput}
                onComposerIntentChange={setComposerIntent}
                onToggleLeftSidebar={() => toggleSidebar('left')}
                onToggleRightSidebar={() => toggleSidebar('right')}
                onApprovePlan={handleApprovePlan}
                onRejectPlan={handleRejectPlan}
                onSend={handleSend}
                onStop={handleStop}
                onToggleWorkerThread={setActiveWorkerThreadId}
                installedAssistants={installedAssistants}
                selectedAssistant={selectedAssistant}
                onSelectAssistant={handleSelectAssistant}
                onClearAssistant={handleClearAssistant}
                installedConnectors={installedConnectors}
                selectedConnectorIds={selectedConnectorIds}
                onToggleConnector={handleToggleConnector}
                onOpenConnectorHub={() => setActiveView('connectors')}
                onOpenExpertHub={() => setActiveView('experts')}
                remoteEnabled={desktopSettings?.remoteEnabled ?? false}
                newSessionMode={desktopSettings?.agentMode === 'remote-direct' ? 'remote-direct' : 'local'}
                onNewSessionModeChange={handleNewSessionModeChange}
              />
            )
          ) : activeView === 'cron' ? (
            <CronView onOpenSession={handleSelectSession} />
          ) : activeView === 'audit' ? (
            <LocalAuditView onOpenSession={handleSelectSession} onLocateTool={handleLocateAuditTool} onNotice={handleAuditNotice} onError={handleAuditError} />
          ) : activeView === 'skills' ? (
            <SkillHubView />
          ) : activeView === 'connectors' ? (
            <ConnectorHubView
              onConnectorsChanged={refreshConnectors}
              onRunCliSetup={handleRunCliConnectorSetup}
              onAuthenticateMcp={handleAuthenticateMcpConnector}
              onUseConnector={handleUseConnector}
              onError={handleConnectorHubError}
            />
          ) : activeView === 'experts' ? (
            <ExpertHubView />
          ) : activeView === 'projects' ? (
            <ProjectWorkspace
              projects={projects}
              templates={projectTemplates}
              sessions={summaries}
              activeProjectId={activeProjectId}
              refreshSignal={projectRefreshSignal}
              onActiveProjectChange={setActiveProjectId}
              onProjectsChange={async () => {
                await refreshProjects();
                await refreshSummaries();
              }}
              onOpenSession={handleSelectSession}
              onCreateProjectSession={handleCreateProjectSession}
            />
          ) : activeView === 'embedded-app' && embeddedAppName ? (
            <EmbeddedAppView
              appName={embeddedAppName}
            />
          ) : activeView === 'apps' ? (
            <AppsPanel
              apps={apps}
              versionsByApp={versionsByApp}
              onLaunch={handleLaunchApp}
              onDelete={handleDeleteApp}
              onIterate={handleIterateExistingApp}
              onLoadVersions={loadAppVersions}
              onRollback={handleRollbackApp}
              sidebarShortcutIds={sidebarAppShortcutIds}
              onAddShortcut={handleAddAppShortcut}
              onRemoveShortcut={handleRemoveAppShortcut}
            />
          ) : (
            renderSettingsView()
          )}
        </div>

        {previewDrawerVisible && (
          <>
            <div
              className={`
                relative hidden w-3 shrink-0 cursor-col-resize bg-transparent transition-colors
                before:absolute before:inset-y-4 before:left-1/2 before:w-px before:-translate-x-1/2 before:rounded-full before:bg-border/80
                hover:before:bg-primary/60 lg:block
              `}
              onMouseDown={(event) => {
                event.preventDefault();
                startResize('preview', event.clientX);
              }}
            />

            <div
              className="min-h-0 shrink-0 overflow-hidden border-l border-border/70"
              style={{ width: layout.previewWidth }}
            >
              <PreviewDrawer
                visible={previewDrawerVisible}
                tabs={previewTabs}
                activePath={activePreviewPath}
                onActivate={setActivePreviewPath}
                onUpdateTab={handleUpdatePreviewTab}
                onCloseTab={handleClosePreviewTab}
                onCloseOthers={handleCloseOtherPreviewTabs}
                onCloseAll={handleCloseAllPreviewTabs}
                onCloseDrawer={handleClosePreviewDrawer}
              />
            </div>
          </>
        )}

        {activeView === 'chat' && activeSessionId && (
          <>
            <div
              className={`
                relative hidden w-3 shrink-0 cursor-col-resize bg-transparent transition-colors
                before:absolute before:inset-y-4 before:left-1/2 before:w-px before:-translate-x-1/2 before:rounded-full before:bg-border/80
                hover:before:bg-primary/60 lg:block
              `}
              onMouseDown={(event) => {
                event.preventDefault();
                startResize('right', event.clientX);
              }}
            />

            <div
              className="min-h-0 shrink-0 overflow-hidden border-l border-border/70"
              style={{ width: layout.rightCollapsed ? 0 : layout.rightWidth }}
            >
              <TaskPanel
                collapsed={layout.rightCollapsed}
                onToggleCollapse={() => toggleSidebar('right')}
                searchQuery={workspaceQuery}
                onSearchChange={setWorkspaceQuery}
                onRefresh={handleRefreshWorkspace}
                onOpenWorkspace={handleOpenWorkspace}
                treeItems={workspaceTree}
                expandedPaths={expandedDirs}
                selectedFilePath={selectedFilePath}
                onToggleFolder={handleToggleFolder}
                onSelectFile={handleSelectFile}
                previewTabs={previewTabs}
                activePreviewPath={activePreviewPath}
                onActivatePreview={setActivePreviewPath}
                previewTitle={activePreview?.relativePath || '未选择文件'}
                sessionId={activeSessionId}
                sessionTasks={activeDetail?.tasks || []}
                projectName={activeDetail?.projectName || null}
                browserOpenSignal={browserOpenSignal}
                onBrowserOpen={() => {
                  setLayout((prev) => ({
                    ...prev,
                    rightCollapsed: false,
                    rightWidth: clamp(Math.max(prev.rightWidth || DEFAULT_LAYOUT.rightWidth, 440), RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max),
                  }));
                }}
              />
            </div>
          </>
        )}

        {isBuddyEnabled() && (
          <BuddyCompanion key={forceBuddyUpdate} />
        )}
        <AskUserQuestionModal
          request={activeQuestionRequest}
          activeSessionId={activeSessionId}
          onSwitchToSession={(sessionId) => {
            void handleSelectSession(sessionId);
          }}
          onSubmit={handleSubmitQuestion}
          onReject={handleRejectQuestion}
        />
        <UpdateModal />
      </div>
    </div>
  );
}
