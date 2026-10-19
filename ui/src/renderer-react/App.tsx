import { connectorIdFromApp } from '../../../packages/app-sdk/src/discovery.mjs';
import { AppToolSelectionContext, canSelectToolApp, toolAppId, getAppToolServices, parseAppServiceKey } from '@/lib/app-tool-selection';
import * as React from 'react';
import { subscribeNotificationState } from '../client/notification-sync.mjs';
import { WebInteractions } from '@/components/web-interactions';
import { WebAppPreviews } from '@/components/web-app-previews';
import { WebAuthorizations } from '@/components/web-authorizations';
import { WebComposerDraft } from '@/components/web-composer-draft';
import { latestSessionInteractions, type InteractionKind, type InteractionDetails, type SessionInteraction } from '@/lib/session-interactions';
import { composerIsEmpty, messageFromDraft, preserveQueuedMessages, recoverQueuedMessages, withdrawMessage,
  type ComposerAttachment, type ComposerChoices, type ComposerDraft, type QueuedMessage } from '@/lib/composer-queue';
import { HostConfirmations } from '@/components/host-confirmations';
import { ComputerUseControl } from '@/components/computer-use';
import { AppSidebar, type MainView } from '@/components/app-sidebar';
import { AppsPanel } from '@/components/apps-panel';
import { appPageUnavailableReason, getAppPrimaryEntry, getAppSettingsEntries } from '@/lib/app-navigation';
import { CronView } from '@/components/cron-view';
import { OverviewView } from '@/components/overview-view';
import { AgentMailView } from '@/components/agent-mail-view';
import { ChatArea } from '@/components/chat-area';
import { deriveContextUsage, getRemoteModelContext } from '@/lib/context-usage';
import { createWorkspaceDirectoryLoader } from '@/lib/workspace-directory-loader';
import { SessionTerminalActions } from '@/components/session-terminal-actions';
import { SessionInfoButton } from '@/components/session-info';
import { GlobalSessionSearch } from '@/components/global-session-search';
import {
  resolveToolDisplayMode,
  ToolDisplaySettingsProvider,
  type ToolDisplayMode,
} from '@/components/chat/tool-display-settings';
import { AppComposerContext, resourceContext, type AppComposerResource } from '@/lib/app-composer';
import { reconcileComposerIntent, restoreComposerIntent, type ComposerIntent, type ComposerIntentState } from '@/lib/composer-intent';
import { EmbeddedAppView } from '@/components/embedded-app-view';
import { ResourceHubView } from '@/components/resource-hub-view';
import { previewIpc } from '@/ipc/preview.ipc';
import { UpdateModal } from '@/components/update-modal';
import { TaskPanel } from '@/components/task-panel';
import { usePresentation } from '@/lib/use-presentation';
import { PresentationToolbar, PresentationContent } from '@/components/presentation/presentation-panel';
import { startSessionTaskPolling } from '../session-tasks.mjs';
import { AppWidgetHost } from '@/components/app-widget-host';
import { SettingsView } from '@/components/settings-view';
import { UserAvatarContext } from '@/components/user-avatar';
import { getChatAppearanceStyle } from '@/components/chat/chat-appearance';
import { ProjectWorkspace } from '@/components/projects/project-workspace';
import { openBrowserPanelUrl } from '@/components/browser-panel';
import { NotificationCenter, NotificationToast } from '@/components/notification-center';
import {
  buildMainChatRenderMessagesFromHistory,
} from '@/lib/agent-transcript';
import { PRESET_THEMES } from '@/theme/presets';
import { applyCssTheme, getStoredThemeId, setStoredThemeId } from '@/theme/cssTheme';
import {
  appendAppNotification,
  cleanIpcErrorMessage,
  getErrorMessage,
  saveAppNotifications,
  type AppNotification,
  type AppNotificationSeverity,
  type NewAppNotification,
} from '@/lib/app-notifications';
import { isAuthorizedConnector } from '@/lib/connector-selection';
import {
  excludeRemovedSessions,
  isSessionAlreadyRemovedError,
} from '@/lib/session-removal';
import type {
  AskUserQuestionAnnotations,
  AskUserQuestionRequest,
  AgentEvent,
  AgentTeamsSessionState,
  AppVersion,
  BackgroundTaskInfo,
  ComposerResourceRef,
  DesktopAgentDefinition,
  DesktopSettings,
  FileTreeNode,
  InstalledConnector,
  InstalledAssistant,
  ModelContextInfo,
  PermissionMode,
  Project,
  SessionDetail,
  SessionSearchResult,
  SessionSummary,
  StoredApp,
  WorkspacePreviewData,
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

function displaySessionTitle(session: Pick<SessionSummary, 'title' | 'sessionKind'>): string {
  return session.sessionKind === 'agent-mail' && session.title === 'Agent Mail'
    ? '协作邮箱'
    : session.title;
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
type LayoutState = {
  leftWidth: number;
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
  ofvText?: boolean;
};

const LAYOUT_STORAGE_KEY = 'ui.panelLayout.v1';
const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 224,
  rightWidth: 320,
  leftCollapsed: false,
  rightCollapsed: false,
};
const LEFT_WIDTH_RANGE = { min: 210, max: 420 };
const RIGHT_WIDTH_RANGE = { min: 320, max: 560 };

function canEditPreviewType(contentType: WorkspacePreviewData['contentType']): boolean {
  return ['markdown', 'html', 'text', 'code', 'diff', 'url', 'unsupported'].includes(contentType);
}

function getPreviewTabMetadata(file: WorkspacePreviewData | null | undefined): PreviewTabMetadata {
  return ((file?.metadata as PreviewTabMetadata | undefined) || {}) as PreviewTabMetadata;
}

function enrichWorkspacePreviewFile(
  file: WorkspacePreviewData,
  sessionId: string | null,
  workspace: string | null | undefined,
  existing?: WorkspacePreviewData | null
): WorkspacePreviewData {
  if (file.path.startsWith('preview:')) {
    return file;
  }

  const existingMetadata = getPreviewTabMetadata(existing);
  const existingDirty = Boolean(existingMetadata.dirty);
  const content = existingDirty ? existing?.content || file.content : file.content;
  const fileMetadata = getPreviewTabMetadata(file);
  const editableContent = canEditPreviewType(file.contentType)
    || (file.contentType === 'ofv' && fileMetadata.ofvText === true);

  return {
    ...file,
    content,
    metadata: {
      ...(file.metadata || {}),
      ...(existingDirty ? existingMetadata : {}),
      sessionId: sessionId || existingMetadata.sessionId,
      workspace: workspace || existingMetadata.workspace,
      originalContent: editableContent
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
  if (
    event.isMeta === true ||
    event.isSynthetic === true ||
    event.isVisibleInTranscriptOnly === true
  ) return false;
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

export default function App() {
  const isMacOS =
    typeof navigator !== 'undefined' &&
    /(Mac|iPhone|iPad|iPod)/i.test(`${navigator.platform} ${navigator.userAgent}`);
  const [bootError, setBootError] = React.useState('');
  const [permissionNotice, setPermissionNotice] = React.useState('');
  const [permissionNoticeSeverity, setPermissionNoticeSeverity] = React.useState<AppNotificationSeverity>('info');
  const permissionNoticeTimerRef = React.useRef<number | null>(null);
  const [appNotifications, setAppNotifications] = React.useState<AppNotification[]>([]);
  const [activeView, setActiveView] = React.useState<MainView>('chat');
  const [settingsInitialSection, setSettingsInitialSection] = React.useState<'basic-info' | 'agents'>('basic-info');
  const [settingsInitialAppId, setSettingsInitialAppId] = React.useState<string | null>(null);
  const [appManagementName, setAppManagementName] = React.useState<string | null>(null);
  const [compactViewport, setCompactViewport] = React.useState(() => window.innerWidth < 720);
  const [toolFocusTarget, setToolFocusTarget] = React.useState<{
    sessionId: string;
    toolUseId: string;
    requestId: number;
  } | null>(null);
  const toolFocusRequestIdRef = React.useRef(0);
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
    void window.agentDesktop.notifications.create(notification).catch(() => {
      setAppNotifications((current) => appendAppNotification(current, notification));
    });
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
  const appearanceRef = React.useRef<DesktopSettings['appearance']>({
    themeMode,
    cssThemeId,
    toolDisplayMode: 'expanded',
    chatFontSize: 14,
    chatLineHeight: 1.55,
    chatMessageSpacing: 10,
    showAssistantMessageBorder: false,
    showAssistantAvatar: true,
  });
  const committedAppearanceRef = React.useRef(appearanceRef.current);
  const appearanceSaveRequestRef = React.useRef(0);
  const [sessionSearchQuery, setSessionSearchQuery] = React.useState('');
  const [globalSearchOpen, setGlobalSearchOpen] = React.useState(false);
  const [messageFocusTarget, setMessageFocusTarget] = React.useState<{
    sessionId: string;
    messageId: string;
    requestId: number;
  } | null>(null);
  const [layout, setLayout] = React.useState<LayoutState>(() => loadPanelLayout());
  const effectiveLeftCollapsed = layout.leftCollapsed || compactViewport;

  React.useEffect(() => {
    const updateViewport = () => setCompactViewport(window.innerWidth < 720);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);
  const [browserOpenSignal, setBrowserOpenSignal] = React.useState(0);
  const [summaries, setSummaries] = React.useState<SessionSummary[]>([]);
  const removedSessionIdsRef = React.useRef<Set<string>>(new Set());
  const deletingSessionIdsRef = React.useRef<Set<string>>(new Set());
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [projectRefreshSignal, setProjectRefreshSignal] = React.useState(0);
  const [apps, setApps] = React.useState<StoredApp[]>([]);
  const [versionsByApp, setVersionsByApp] = React.useState<Record<string, AppVersion[]>>({});
  const [appSelection, setAppSelection] = React.useState<AppComposerResource | null>(null);
  const [appDraftWorkspace, setAppDraftWorkspace] = React.useState<string>();
  const [embeddedAppName, setEmbeddedAppName] = React.useState('');
  const [embeddedAppRoute, setEmbeddedAppRoute] = React.useState('');
  const [embeddedAppRevision, setEmbeddedAppRevision] = React.useState(0);
  const [composerIntent, setComposerIntent] = React.useState<ComposerIntent>('chat');
  const composerIntentStatesRef = React.useRef(new Map<string, ComposerIntentState>());
  const [newSessionAgentMode, setNewSessionAgentMode] = React.useState<'local' | 'remote-direct'>('local');
  const [installedAssistants, setInstalledAssistants] = React.useState<InstalledAssistant[]>([]);
  const [selectedAssistant, setSelectedAssistant] = React.useState<InstalledAssistant | null>(null);
  const assistantRefreshRequestIdRef = React.useRef(0);
  const [installedConnectors, setInstalledConnectors] = React.useState<InstalledConnector[]>([]);
  const [draftConnectorIds, setDraftConnectorIds] = React.useState<string[]>([]);
  const [draftAppIds, setDraftAppIds] = React.useState<string[]>([]);
  const [draftAppServiceIds, setDraftAppServiceIds] = React.useState<string[]>([]);
  const [appSelectionPending, setAppSelectionPending] = React.useState(false);
  const appSelectionQueue = React.useRef<Promise<unknown>>(Promise.resolve());
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [forkingSessionId, setForkingSessionId] = React.useState<string | null>(null);
  const forkSessionRequestRef = React.useRef(false);
  const [toolDisplaySettingSessionId, setToolDisplaySettingSessionId] = React.useState<string | null>(null);
  const toolDisplaySettingRequestRef = React.useRef<string | null>(null);
  const [activeDetail, setActiveDetail] = React.useState<SessionDetail | null>(null);
  const [pendingSendRequests, setPendingSendRequests] = React.useState<Map<string, symbol>>(() => new Map());
  const [preparingNewSession, setPreparingNewSession] = React.useState(false);
  const [newSessionPermissionMode, setNewSessionPermissionMode] = React.useState<PermissionMode>('default');
  const [permissionModeSettingSessionId, setPermissionModeSettingSessionId] = React.useState<string | null>(null);
  const permissionModeSettingRequestRef = React.useRef<string | null>(null);
  const [agentTeamsBySession, setAgentTeamsBySession] = React.useState<Record<string, AgentTeamsSessionState>>({});
  const [input, setInput] = React.useState('');
  const [backgroundTasks, setBackgroundTasks] = React.useState<Record<string, BackgroundTaskInfo[]>>({});
  const [queuedMessages, setQueuedMessages] = React.useState<Record<string, QueuedMessage[]>>({});
  const [questionRequests, setQuestionRequests] = React.useState<AskUserQuestionRequest[]>([]);
  const [composerAttachments, setComposerAttachments] = React.useState<ComposerAttachment[]>([]);
  const [composerChoices, setComposerChoices] = React.useState<ComposerChoices>({ skills: [], agent: null });
  const composerChoicesRef = React.useRef(composerChoices); composerChoicesRef.current = composerChoices;
  const queueEpochs = React.useRef(new Map<string, number>());
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
  const [previewTabs, setPreviewTabs] = React.useState<WorkspacePreviewData[]>([]);
  const [desktopSettings, setDesktopSettings] = React.useState<DesktopSettings | null>(null);
  const desktopSettingsRef = React.useRef<DesktopSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = React.useState<DesktopSettings | null>(null);
  const [settingsNotice, setSettingsNotice] = React.useState('');
  const agentMailEnabled =
    desktopSettings?.remoteEnabled === true && desktopSettings?.agentMail?.enabled === true;
  const [planDecisionBusy, setPlanDecisionBusy] = React.useState(false);
  const workspaceRefreshRequestIdRef = React.useRef(0);
  const layoutRef = React.useRef(layout);
  const activeSessionIdRef = React.useRef<string | null>(null);
  const activeDetailRef = React.useRef<SessionDetail | null>(null);
  const expandedDirsRef = React.useRef<Set<string>>(new Set());
  const previewTabsRef = React.useRef<WorkspacePreviewData[]>([]);
  const presentation = usePresentation(activeSessionId, activeDetail?.workspace, activeView === 'chat', () => {
    setLayout(previous => ({ ...previous, rightCollapsed: false, rightWidth: clamp(Math.max(previous.rightWidth, 440), RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max) }));
  });
  const openSessionRequestIdRef = React.useRef(0);
  const workspaceDirectoryLoader = React.useMemo(() => createWorkspaceDirectoryLoader({
    getScope: () => {
      const detail = activeDetailRef.current;
      return detail?.id === activeSessionIdRef.current
        ? { sessionId: detail.id, workspace: detail.workspace }
        : null;
    },
    readDirectory: (payload) => window.agentDesktop.listWorkspaceDir(payload),
    applyDirectory: (dirPath, data) => setDirectoryCache((previous) => new Map(previous).set(dirPath, data)),
  }), []);

  React.useEffect(() => {
    if (!activeSessionId) {
      setNewSessionPermissionMode(desktopSettings?.permissionMode ?? 'default');
    }
  }, [activeSessionId, desktopSettings?.permissionMode]);
  // Guards against creating a second session (and a second workspace dir) when
  // submitPrompt re-enters before the first createAndOpenSession has set
  // activeSessionId — e.g. a fast double-send, or a retry after an errored
  // first turn. Holds the id of the session created in-flight.
  const creatingSessionRef = React.useRef<Promise<string | undefined> | null>(null);
  const clearSessionWorkspaceState = React.useCallback(() => {
    workspaceDirectoryLoader.reset();
    workspaceRefreshRequestIdRef.current++;
    expandedDirsRef.current = new Set();
    previewTabsRef.current = [];
    setDirectoryCache(new Map());
    setExpandedDirs(new Set());
    setSelectedFilePath(null);
    setPreviewTabs([]);
    setWorkspaceQuery('');
  }, [workspaceDirectoryLoader]);

  const persistPinned = React.useCallback((next: Set<string>) => {
    setPinnedIds(next);
    localStorage.setItem('ui.pinnedSessions', JSON.stringify(Array.from(next)));
  }, []);

  const refreshSummaries = React.useCallback(async () => {
    const list = await window.agentDesktop.listSessions();
    const visible = excludeRemovedSessions(list, removedSessionIdsRef.current);
    setSummaries(visible);
    return visible;
  }, []);

  const refreshProjects = React.useCallback(async () => {
    const list = await window.agentDesktop.listProjects();
    setProjects(list);
    return list;
  }, []);

  const refreshProjectWorkspace = React.useCallback(async () => {
    await Promise.all([
      refreshProjects(),
      refreshSummaries(),
    ]);
  }, [refreshProjects, refreshSummaries]);

  const refreshApps = React.useCallback(async () => {
    const nextApps = await window.agentDesktop.listApps();
    setApps(nextApps);
    return nextApps;
  }, []);

  const refreshAssistants = React.useCallback(async (mode?: 'local' | 'remote-direct') => {
    const requestId = ++assistantRefreshRequestIdRef.current;
    const agentMode = mode ?? desktopSettingsRef.current?.agentMode ?? 'local';
    if (agentMode === 'remote-direct') {
      setInstalledAssistants([]);
      setSelectedAssistant(null);
      return [];
    }
    const result = await window.agentDesktop.getInstalledAssistants();
    if (requestId !== assistantRefreshRequestIdRef.current) return [];
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
    committedAppearanceRef.current = appearance;
    setThemeMode(appearance.themeMode);
    setCssThemeId(appearance.cssThemeId);
  }, []);

  const applyAppearanceOptimistically = React.useCallback((appearance: DesktopSettings['appearance']) => {
    appearanceRef.current = appearance;
    setThemeMode(appearance.themeMode);
    setCssThemeId(appearance.cssThemeId);
    if (desktopSettingsRef.current) {
      desktopSettingsRef.current = { ...desktopSettingsRef.current, appearance };
    }
    setDesktopSettings((prev) => {
      const next = prev ? { ...prev, appearance } : prev;
      if (next) desktopSettingsRef.current = next;
      return next;
    });
    setSettingsDraft((prev) => (prev ? { ...prev, appearance } : prev));
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
  const composerDraftsRef = React.useRef<Record<string, ComposerDraft>>({});
  const draftSessionKeyRef = React.useRef<string>('home');
  const [hydratedComposerKey, setHydratedComposerKey] = React.useState('home');
  const appSelectionDraftRef = React.useRef<AppComposerResource | null>(null);
  appSelectionDraftRef.current = appSelection;
  const inputDraftRef = React.useRef('');
  inputDraftRef.current = input;
  const composerAttachmentsRef = React.useRef<ComposerAttachment[]>([]);
  composerAttachmentsRef.current = composerAttachments;

  React.useEffect(() => {
    const prevKey = draftSessionKeyRef.current;
    const nextKey = activeSessionId ?? 'home';
    if (prevKey === nextKey) return;
    composerDraftsRef.current[prevKey] = {
      text: inputDraftRef.current,
      files: composerAttachmentsRef.current,
      appSelection: appSelectionDraftRef.current,
      choices: composerChoicesRef.current,
    };
    draftSessionKeyRef.current = nextKey; setHydratedComposerKey(nextKey);
    const draft = composerDraftsRef.current[nextKey];
    setInput(draft?.text ?? '');
    setAppSelection(draft?.appSelection || null);
    setComposerAttachments(draft?.files ?? []);
    setComposerChoices(draft?.choices ?? { skills: [], agent: null });
  }, [activeSessionId]);

  React.useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    void window.agentDesktop.listBackgroundTasks({ sessionId: activeSessionId })
      .then(({ tasks }) => {
        if (!cancelled) {
          setBackgroundTasks((previous) => ({
            ...previous,
            [activeSessionId]: tasks ?? [],
          }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeSessionId]);

  const [contextCapacity, setContextCapacity] = React.useState<{
    sessionId: string;
    settings: DesktopSettings;
    value: ModelContextInfo | null;
  } | null>(null);
  const contextSessionId = activeDetail?.id;
  const contextAgentMode = activeDetail?.agentMode;
  React.useEffect(() => {
    if (!contextSessionId || !desktopSettings || contextAgentMode === 'remote-direct') return;
    let cancelled = false;
    void window.agentDesktop.getModelContext({ sessionId: contextSessionId })
      .catch(() => null)
      .then((value) => {
        if (!cancelled) setContextCapacity({ sessionId: contextSessionId, settings: desktopSettings, value });
      });
    return () => { cancelled = true; };
  }, [contextSessionId, contextAgentMode, desktopSettings, activeDetail?.busy]);

  const contextUsage = React.useMemo(() => {
    const remote = contextAgentMode === 'remote-direct';
    const resolved = contextCapacity?.sessionId === contextSessionId && contextCapacity?.settings === desktopSettings;
    return deriveContextUsage(
      activeDetail?.history,
      remote ? getRemoteModelContext(activeDetail?.history) : resolved ? contextCapacity!.value : null,
      !remote && !resolved,
    );
  }, [activeDetail?.history, contextSessionId, contextAgentMode, contextCapacity, desktopSettings]);

  // Cumulative output tokens produced since the last human prompt — mirrors the
  // REPL's live "↓ N tokens" counter shown while a turn is in flight.
  const turnTokens = React.useMemo(() => {
    const history = activeDetail?.history;
    if (!Array.isArray(history)) return 0;
    let start = 0;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (isVisibleUserTextEvent(history[i])) {
        start = i;
        break;
      }
    }
    let out = 0;
    for (let i = start; i < history.length; i += 1) {
      const ev = history[i] as any;
      if (ev?.type === 'assistant' && ev?.parent_tool_use_id == null) {
        const tokens = ev?.message?.usage?.output_tokens;
        if (typeof tokens === 'number') out += tokens;
      }
    }
    return out;
  }, [activeDetail?.history]);

  const navigateToHome = React.useCallback((options?: { resetInput?: boolean; preserveIntent?: boolean; preserveAgentMode?: boolean; forceDiscardDirty?: boolean }) => {
    setActiveView('chat');
    activeSessionIdRef.current = null;
    activeDetailRef.current = null;
    setActiveSessionId(null);
    setActiveDetail(null);
    if (!options?.preserveAgentMode) { setNewSessionAgentMode('local'); void refreshAssistants('local'); }
    clearSessionWorkspaceState();
    if (!options?.preserveIntent) {
      setComposerIntent('chat');
    }
    if (options?.resetInput) {
      setInput('');
      composerDraftsRef.current['home'] = { text: '', files: [] };
    }
    return true;
  }, [clearSessionWorkspaceState, refreshAssistants]);

  const openSession = React.useCallback(async (sessionId: string) => {
    const requestId = ++openSessionRequestIdRef.current;
    let detail;
    try {
      detail = await window.agentDesktop.getSession({ sessionId });
      const context = await window.agentDesktop.getAppAuthoringContext?.(sessionId);
      if (context) {
        const previous = composerDraftsRef.current[sessionId] || { text: '', files: [] };
        composerDraftsRef.current[sessionId] = { ...previous, appSelection: { ...context, appId: context.providerId.split('/')[0], title: 'App 项目' } };
      }
    } catch {
      // 会话可能已被删除或后端出错; 忽略并保持当前视图
      return false;
    }
    if (requestId !== openSessionRequestIdRef.current) {
      return false;
    }
    const workspaceChanged = activeDetailRef.current?.id !== sessionId
      || activeDetailRef.current?.workspace !== detail.workspace;
    setActiveView('chat');
    activeSessionIdRef.current = sessionId;
    activeDetailRef.current = detail;
    setActiveSessionId(sessionId);
    setComposerIntent(reconcileComposerIntent(detail, composerIntentStatesRef.current));
    setActiveDetail(detail);
    if (workspaceChanged) clearSessionWorkspaceState();
    return true;
  }, [clearSessionWorkspaceState]);

  const handleOpenSearchResult = React.useCallback(async (result: SessionSearchResult) => {
    setGlobalSearchOpen(false);
    setMessageFocusTarget(null);
    const opened = await openSession(result.sessionId);
    if (opened && result.messageId) {
      setMessageFocusTarget({
        sessionId: result.sessionId,
        messageId: result.messageId,
        requestId: Date.now(),
      });
    }
  }, [openSession]);

  React.useEffect(() => {
    const handleGlobalSearchShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setGlobalSearchOpen(true);
      }
    };
    window.addEventListener('keydown', handleGlobalSearchShortcut);
    return () => window.removeEventListener('keydown', handleGlobalSearchShortcut);
  }, []);

  const createAndOpenSession = React.useCallback(async (
    title?: string,
    workspace?: string,
    assistantName?: string,
    connectorIds?: string[],
    permissionMode?: PermissionMode,
    agentMode: 'local' | 'remote-direct' = 'local',
    appIds: string[] = [],
    appServiceIds: string[] = [],
  ) => {
    const payload: { title?: string; workspace?: string; assistant_name?: string; connectorIds?: string[]; appIds?: string[]; appServiceIds?: string[]; permissionMode?: PermissionMode; agentMode: 'local' | 'remote-direct' } = { agentMode };
    if (workspace) payload.workspace = workspace;
    if (title) payload.title = title;
    if (assistantName) payload.assistant_name = assistantName;
    if (connectorIds && connectorIds.length > 0) payload.connectorIds = connectorIds;
    payload.appIds = agentMode === 'local' ? appIds : appIds.filter(id => connectorIdFromApp(apps.find(app => (app.id || app.name) === id))); if (agentMode === 'local') payload.appServiceIds = appServiceIds;
    if (permissionMode) payload.permissionMode = permissionMode;
    const created = await window.agentDesktop.createSession(payload);
    setSummaries((prev) => upsertSummary(prev, created.summary));
    activeSessionIdRef.current = created.summary.id;
    activeDetailRef.current = created.detail;
    setActiveView('chat');
    setActiveSessionId(created.summary.id);
    setComposerIntent(restoreComposerIntent(created.detail));
    setActiveDetail(created.detail);
    clearSessionWorkspaceState();
    // Record the mode selected for this new session.
    const mode = created.summary.agentMode ?? agentMode;
    persistSessionAgentModes(new Map(sessionAgentModes).set(created.summary.id, mode));
    await openSession(created.summary.id);
    return created.summary.id;
  }, [apps, clearSessionWorkspaceState, openSession, sessionAgentModes, persistSessionAgentModes]);

  const ensureRootDirectory = React.useCallback(async (sessionId: string, workspace: string) => {
    try {
      await workspaceDirectoryLoader.load({ sessionId, workspace }, workspace);
    } catch {
      /* 忽略目录加载失败 */
    }
  }, [workspaceDirectoryLoader]);

  React.useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  React.useEffect(() => {
    if (!activeSessionId) return;
    let cancelled = false;
    void window.agentDesktop.agentTeams.list({ sessionId: activeSessionId })
      .then((state) => {
        if (!cancelled) {
          setAgentTeamsBySession((previous) => ({ ...previous, [state.sessionId]: state }));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [activeSessionId]);

  React.useEffect(() => {
    layoutRef.current = layout;
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  React.useEffect(() => {
    activeDetailRef.current = activeDetail;
  }, [activeDetail]);

  React.useEffect(() => {
    // SQLite is authoritative. Re-importing this retired cache after a database
    // clear would resurrect notifications the user already removed.
    saveAppNotifications([], window.localStorage);
    return subscribeNotificationState({
      api: window.agentDesktop.notifications,
      onChanged: setAppNotifications,
      reconnectTarget: window.mossWeb ? window : undefined,
    });
  }, []);

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
    if (embeddedAppName && !apps.some((entry) => entry.name === embeddedAppName || entry.id === embeddedAppName)) {
      setEmbeddedAppName('');
      if (activeView === 'embedded-app') {
        setActiveView('apps');
      }
    }
  }, [activeView, apps, embeddedAppName]);


  React.useEffect(() => {
    workspaceDirectoryLoader.reset();
    setDirectoryCache(new Map());
    if (!activeDetail?.workspace || !activeSessionId) {
      return;
    }
    void ensureRootDirectory(activeSessionId, activeDetail.workspace);
  }, [activeDetail?.workspace, activeSessionId, ensureRootDirectory, workspaceDirectoryLoader]);

  const refreshWorkspaceSnapshot = React.useCallback(async () => {
    const sessionId = activeSessionIdRef.current;
    const detail = activeDetailRef.current;
    if (!sessionId || detail?.id !== sessionId || !detail.workspace) return;
    const requestId = ++workspaceRefreshRequestIdRef.current;
    const isCurrent = () => requestId === workspaceRefreshRequestIdRef.current
      && activeSessionIdRef.current === sessionId
      && activeDetailRef.current?.workspace === detail.workspace;

    const validExpandedDirs = Array.from(expandedDirsRef.current).filter((p) =>
      p.startsWith(`${detail.workspace.replace(/[\\/]+$/, '')}/`)
      || p.startsWith(`${detail.workspace.replace(/[\\/]+$/, '')}\\`)
    );
    const pathsToRefresh = [detail.workspace, ...validExpandedDirs];
    await Promise.all(
      pathsToRefresh.map((dirPath) => workspaceDirectoryLoader
        .load({ sessionId, workspace: detail.workspace }, dirPath)
        .catch(() => undefined))
    );

    if (!isCurrent() || previewTabsRef.current.length === 0) return;

    const originalTabs = previewTabsRef.current;
    const refreshedTabs = await Promise.all(
      originalTabs.map(async (tab) => {
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
          return tab;
        }
      })
    );

    if (!isCurrent()) return;
    const updates = new Map(originalTabs.map((tab, index) => [tab, refreshedTabs[index]]));
    const nextTabs = previewTabsRef.current.map((tab) => updates.get(tab) ?? tab);
    previewTabsRef.current = nextTabs;
    setPreviewTabs(nextTabs);
    void previewIpc.sync({ files: nextTabs }).catch(() => undefined);
    setSelectedFilePath((prev) => (prev && nextTabs.some((tab) => tab.path === prev) ? prev : null));
  }, [workspaceDirectoryLoader]);

  React.useEffect(() => {
    let timer: number | null = null;
    let running = false;
    let pending = false;
    let disposed = false;
    const scheduleRefresh = () => {
      // Bound the delay even while a tool continuously writes files.
      if (disposed) return;
      if (running) {
        pending = true;
        return;
      }
      if (timer !== null) return;
      timer = window.setTimeout(async () => {
        timer = null;
        running = true;
        try {
          await refreshWorkspaceSnapshot();
        } finally {
          running = false;
          if (pending) {
            pending = false;
            scheduleRefresh();
          }
        }
      }, 120);
    };
    const unsubscribe = window.agentDesktop.onWorkspaceChanged((payload) => {
      if (payload?.sessionId === activeSessionIdRef.current) scheduleRefresh();
    });
    window.addEventListener('focus', scheduleRefresh);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', scheduleRefresh);
    };
  }, [refreshWorkspaceSnapshot]);

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
        if (!status.sdkReady) {
          setBootError('缺少嵌入式代码会话运行时，请重新构建或安装 Moss。');
        }
        applyDesktopSettings(nextSettings);
        const [initialApps] = await Promise.all([
          refreshApps(),
          refreshSummaries(),
          refreshProjects(),
          refreshAssistants('local'),
        ]);
        if (!cancelled && initialApps.length === 0) setActiveView('apps');
        void refreshConnectors().catch(() => {});
      } catch (error: any) {
        if (!cancelled) {
          setBootError(error?.message || String(error));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyDesktopSettings, openSession, refreshApps, refreshSummaries, refreshProjects, refreshAssistants, refreshConnectors]);

  React.useEffect(() => {
    if (!window.mossWeb) return;
    const restore = () => {
      const snapshot = window.mossWeb?.snapshot;
      if (Array.isArray(snapshot?.questions)) {
        questionRequestsRef.current = snapshot.questions;
        setQuestionRequests(snapshot.questions);
      }
      void refreshSummaries().catch(() => {});
      const sessionId = activeSessionIdRef.current;
      if (sessionId) void openSession(sessionId).catch(() => {});
    };
    restore();
    window.addEventListener('moss:reconnected', restore);
    return () => window.removeEventListener('moss:reconnected', restore);
  }, [refreshSummaries, openSession]);

  React.useEffect(() => {
    if (!desktopSettings?.remoteEnabled) return;
    const timer = window.setInterval(() => {
      void window.agentDesktop.syncRemoteSessions().catch(() => {});
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [desktopSettings?.remoteEnabled]);

  React.useEffect(() => {
    if (activeView !== 'chat' || !activeSessionId || activeDetail?.id !== activeSessionId || activeDetail.agentMode !== 'remote-direct') return;
    return startSessionTaskPolling(() => window.agentDesktop.listSessionTasks({ sessionId: activeSessionId }));
  }, [activeView, activeSessionId, activeDetail?.id, activeDetail?.agentMode]);

  React.useEffect(() => {

    const offEvent = window.agentDesktop.onEvent((payload) => {
      if (removedSessionIdsRef.current.has(payload.sessionId)) return;
      if (payload.sessionId !== activeSessionIdRef.current) return;
      setActiveDetail((prev) => {
        if (!prev) return prev;
        const next = { ...prev, history: [...prev.history, payload.payload] };
        activeDetailRef.current = next;
        return next;
      });
    });

    const offState = window.agentDesktop.onState((payload) => {
      const eventSessionId = payload?.sessionId || payload?.summary?.id;
      if (eventSessionId && removedSessionIdsRef.current.has(eventSessionId)) return;
      if (eventSessionId && payload?.busy === true) {
        setPendingSendRequests((previous) => {
          if (!previous.has(eventSessionId)) return previous;
          const next = new Map(previous);
          next.delete(eventSessionId);
          return next;
        });
      }
      const hasSessionTasksPayload = Array.isArray(payload?.tasks);
      if (payload?.summary) {
        setSummaries((prev) => upsertSummary(prev, payload.summary));
        if (payload.summary.id === activeSessionIdRef.current) {
          setComposerIntent(reconcileComposerIntent(payload.summary, composerIntentStatesRef.current));
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
      if (removedSessionIdsRef.current.has(payload.sessionId)) return;
      setBackgroundTasks((prev) => ({ ...prev, [payload.sessionId]: payload.tasks ?? [] }));
    });

    const offAgentTeamsChanged = window.agentDesktop.agentTeams.onChanged((payload) => {
      if (!payload?.sessionId) return;
      if (removedSessionIdsRef.current.has(payload.sessionId)) return;
      setAgentTeamsBySession((previous) => ({ ...previous, [payload.sessionId]: payload }));
    });

    const offQuestionRequest = window.agentDesktop.onQuestionRequest((payload) => {
      if (!payload?.requestId || !payload?.sessionId) return;
      if (removedSessionIdsRef.current.has(payload.sessionId)) return;
      updateQuestionRequests((prev) => [
        ...prev.filter((entry) => entry.requestId !== payload.requestId),
        payload,
      ]);
      if (payload.projectId) {
        showPermissionNotice('项目有新的待决策，请到项目“待决策”中处理', 'info', 0);
      } else if (payload.sessionId !== activeSessionIdRef.current) {
        showPermissionNotice('另一个会话正在等待你回答问题', 'info', 0);
      }
    });

    const offQuestionResolved = window.agentDesktop.onQuestionResolved((payload) => {
      if (!payload?.requestId) return;
      updateQuestionRequests((prev) => {
        const next = prev.filter((entry) => entry.requestId !== payload.requestId);
        if (!next.some((entry) => entry.projectId)) dismissPermissionNotice();
        return next;
      });
    });

    const offMeta = window.agentDesktop.onSessionMeta((summary) => {
      if (removedSessionIdsRef.current.has(summary.id)) return;
      setSummaries((prev) => upsertSummary(prev, summary));
      if (summary.id === activeSessionIdRef.current) {
        setComposerIntent(reconcileComposerIntent(summary, composerIntentStatesRef.current));
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
      if (removedSessionIdsRef.current.has(payload.sessionId)) return;
      if (payload.summary) {
        setSummaries((prev) => upsertSummary(prev, payload.summary!));
      }
      if (payload.sessionId === activeSessionIdRef.current) {
        if (payload.summary) {
          setComposerIntent(reconcileComposerIntent(payload.summary, composerIntentStatesRef.current));
        }
        setActiveDetail((prev) => {
          if (!prev) return prev;
          const nextHistory = payload.replaceHistory
            ? payload.history
            : mergeSessionHistorySnapshot(prev.history, payload.history);
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
      removedSessionIdsRef.current.add(sessionId);
      composerIntentStatesRef.current.delete(sessionId);
      updateQueue(sessionId, () => []);
      setSummaries((prev) => prev.filter((entry) => entry.id !== sessionId));
      setAgentTeamsBySession((previous) => {
        const next = { ...previous };
        delete next[sessionId];
        return next;
      });
      updateQuestionRequests((prev) => prev.filter((entry) => entry.sessionId !== sessionId));
      if (sessionId === activeSessionIdRef.current) {
        navigateToHome();
      }
    });

    const offAppsChanged = window.agentDesktop.onAppsChanged((payload) => {
      const changedName = payload?.appId || payload?.app?.id || payload?.app?.name;
      if (changedName && changedName === embeddedAppName && payload?.action !== 'runtime') {
        setEmbeddedAppRevision((value) => value + 1);
      }
      void refreshApps();
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

    const offConnectorsChanged = window.agentDesktop.onConnectorsChanged(() => {
      void refreshConnectors();
    });

    return () => {
      offEvent();
      offState();
      offBackgroundTasks();
      offAgentTeamsChanged();
      offQuestionRequest();
      offQuestionResolved();
      offMeta();
      offSessionHistory();
      offRemoved();
      offAppsChanged();
      offSettingsChanged();
      offProjectsChanged();
      offAssistantsChanged();
      offConnectorsChanged();
    };
  }, [applyDesktopSettings, dismissPermissionNotice, embeddedAppName, loadAppVersions, navigateToHome, refreshApps, refreshAssistants, refreshConnectors, refreshProjects, refreshSummaries, selectedAssistant, showPermissionNotice, updateQuestionRequests]);

  const baseSidebarSessions = React.useMemo(
    () => toSidebarSessions(summaries, pinnedIds),
    [summaries, pinnedIds, sessionAgentModes]
  );
  const activeChildSessions = React.useMemo(
    () => activeSessionId
      ? summaries.filter((session) => session.parentSessionId === activeSessionId)
      : [],
    [activeSessionId, summaries],
  );
  // chatMessages is built exclusively from session history.
  // The coordinator agent produces its own formatted summary in the history;
  // the UI must not generate its own summary on top of it.
  // Subagent status is rendered from persisted child session summaries.
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

  const globalToolDisplayMode = desktopSettings?.appearance.toolDisplayMode ?? 'expanded';
  const activeToolDisplayMode = resolveToolDisplayMode(
    activeDetail?.toolDisplayMode,
    globalToolDisplayMode,
  );

  const forkDisabledReason = React.useMemo(() => {
    if (!activeDetail) return '会话尚未加载完成';
    if (activeDetail.busy) return '请等待当前回复完成后再分叉';
    if (activeDetail.isSubAgent) return '子会话不能继续分叉';
    if (activeDetail.projectId) return '项目会话由项目协调器管理，暂不支持分叉';
    if (activeDetail.sessionKind === 'cron') return '定时任务会话不能分叉';
    if (activeDetail.messageCount === 0) return '空会话不能分叉';
    return null;
  }, [activeDetail]);

  const sidebarSessions = React.useMemo(
    () => baseSidebarSessions.map((session) => {
      const pendingCount = questionRequests.filter((request) => request.sessionId === session.id).length;
      return {
        ...session,
        title: displaySessionTitle(session),
        ...(pendingCount > 0 ? { preview: `待决策 ${pendingCount}` } : {}),
      };
    }),
    [baseSidebarSessions, questionRequests],
  );

  const activeSessionQuestionRequest = React.useMemo(() => (
    questionRequests.find((request) => (
      !request.projectId && request.sessionId === activeSessionId
    )) || null
  ), [activeSessionId, questionRequests]);

  const activeToolPermissionRequest = React.useMemo(() => {
    if (activeSessionQuestionRequest?.input?.metadata?.source !== 'session:tool-permission') return null;
    return activeSessionQuestionRequest;
  }, [activeSessionQuestionRequest]);

  const activeQuestionRequest = React.useMemo(() => {
    return activeSessionQuestionRequest?.input?.metadata?.source === 'session:tool-permission'
      ? null
      : activeSessionQuestionRequest;
  }, [activeSessionQuestionRequest]);

  const workspaceTree = React.useMemo(() => {
    if (!activeDetail?.workspace) return [];
    const root = directoryCache.get(activeDetail.workspace);
    if (!root?.items) return [];
    return filterVisibleNodes(root.items, workspaceQuery, directoryCache, expandedDirs);
  }, [activeDetail?.workspace, directoryCache, expandedDirs, workspaceQuery]);

  const openPreviewWindow = React.useCallback((file: WorkspacePreviewData) => {
    setSelectedFilePath(file.path);
    if (!activeSessionId) return;
    void window.agentDesktop.presentation.open({ sessionId: activeSessionId, input: { items: [{ path: file.path }] } }).catch((error) => {
      console.warn('[preview] failed to open preview window:', error instanceof Error ? error.message : error);
    });
  }, [activeDetail?.workspace, activeSessionId]);

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
    alreadyOpened?: boolean;
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
    if (!targetSessionId && !payload.alreadyOpened) {
      const created = await window.agentDesktop.createSession({ title: '浏览器授权', agentMode: 'local' });
      setSummaries((previous) => upsertSummary(previous, created.summary));
      const opened = await openSession(created.summary.id);
      if (!opened) return;
      targetSessionId = created.summary.id;
    }

    if (!payload.alreadyOpened) {
      void openBrowserPanelUrl(targetSessionId, payload.url, payload.connectorAuth || null, payload.mcpAuth || null)
        .catch((error: unknown) => {
          console.warn('[browser] failed to open tab:', error instanceof Error ? error.message : error);
          showPermissionNotice('授权页面打开失败，请重试。', 'error', 6000);
        });
    }
    if (targetSessionId) {
      void window.agentDesktop.presentation.action({ sessionId: targetSessionId, action: { type: 'select', id: 'browser' } });
      setActiveView('chat');
      setLayout((prev) => ({
        ...prev,
        rightCollapsed: false,
        rightWidth: clamp(Math.max(prev.rightWidth || DEFAULT_LAYOUT.rightWidth, 440), RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max),
      }));
      setBrowserOpenSignal((value) => value + 1);
    }
  }, [openSession, showPermissionNotice]);

  React.useEffect(() => {
    const unsubscribe = window.agentDesktop.browser.onOpen((payload) => {
      void openRightBrowser(payload).catch(() => showPermissionNotice('授权页面打开失败，请重试。', 'error', 6000));
    });
    return unsubscribe;
  }, [openRightBrowser, showPermissionNotice]);

  const toggleSidebar = React.useCallback((side: 'left' | 'right') => {
    if (side === 'right') presentation.action(layoutRef.current.rightCollapsed
      ? { type: 'select', id: presentation.snapshot?.state.activeId || 'workspace' }
      : { type: 'close' });
    setLayout((prev) => (
      side === 'left'
        ? { ...prev, leftCollapsed: !prev.leftCollapsed }
        : { ...prev, rightCollapsed: !prev.rightCollapsed }
    ));
  }, [presentation.action, presentation.snapshot?.state.activeId]);

  const startResize = React.useCallback((side: 'left' | 'right', clientX: number) => {
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
          : {
              ...prev,
              rightWidth: clamp(start.rightWidth - delta, RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max),
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
    navigateToHome({ resetInput: true });
  }, [navigateToHome]);

  const handleSelectSession = React.useCallback(async (sessionId: string) => {
    setToolFocusTarget(null);
    setMessageFocusTarget(null);
    const opened = await openSession(sessionId);
    if (!opened) return;
    setActiveView('chat');
  }, [openSession]);

  const handleForkSession = React.useCallback(async () => {
    const sourceSessionId = activeSessionIdRef.current;
    if (!sourceSessionId || forkSessionRequestRef.current) return;
    forkSessionRequestRef.current = true;
    setForkingSessionId(sourceSessionId);
    try {
      const created = await window.agentDesktop.forkSession({ sessionId: sourceSessionId });
      setSummaries((prev) => upsertSummary(prev, created.summary));
      const sourceMode = sessionAgentModes.get(sourceSessionId)
        ?? created.summary.agentMode
        ?? 'local';
      persistSessionAgentModes(
        new Map(sessionAgentModes).set(created.summary.id, sourceMode),
      );
      await openSession(created.summary.id);
      showPermissionNotice(`已创建会话分支：${created.summary.title}`, 'info', 3500);
    } catch (error) {
      showPermissionNotice(
        error instanceof Error ? error.message : String(error),
        'error',
        6000,
      );
    } finally {
      forkSessionRequestRef.current = false;
      setForkingSessionId(null);
    }
  }, [openSession, persistSessionAgentModes, sessionAgentModes, showPermissionNotice]);

  const handleSessionToolDisplayModeChange = React.useCallback(async (mode: ToolDisplayMode | null) => {
    const sessionId = activeSessionIdRef.current;
    const detail = activeDetailRef.current;
    if (!sessionId || !detail || toolDisplaySettingRequestRef.current) return;

    toolDisplaySettingRequestRef.current = sessionId;
    setToolDisplaySettingSessionId(sessionId);
    try {
      const summary = await window.agentDesktop.setSessionToolDisplayMode({ sessionId, mode });
      setSummaries((prev) => upsertSummary(prev, summary));
      if (activeSessionIdRef.current === sessionId) {
        setActiveDetail((current) => {
          if (!current || current.id !== sessionId) return current;
          const next = { ...current, ...summary };
          activeDetailRef.current = next;
          return next;
        });
      }
    } catch (error) {
      showPermissionNotice(
        error instanceof Error ? error.message : String(error),
        'error',
        6000,
      );
    } finally {
      if (toolDisplaySettingRequestRef.current === sessionId) {
        toolDisplaySettingRequestRef.current = null;
      }
      setToolDisplaySettingSessionId((current) => current === sessionId ? null : current);
    }
  }, [showPermissionNotice]);

  const handleSessionPermissionModeChange = React.useCallback(async (mode: PermissionMode) => {
    const sessionId = activeSessionIdRef.current;
    const detail = activeDetailRef.current;
    if (!sessionId || !detail || permissionModeSettingRequestRef.current) return;

    permissionModeSettingRequestRef.current = sessionId;
    setPermissionModeSettingSessionId(sessionId);
    try {
      const summary = await window.agentDesktop.setSessionPermissionMode({ sessionId, mode });
      setSummaries((prev) => upsertSummary(prev, summary));
      if (activeSessionIdRef.current === sessionId) {
        setActiveDetail((current) => {
          if (!current || current.id !== sessionId) return current;
          const next = { ...current, ...summary };
          activeDetailRef.current = next;
          return next;
        });
      }
    } catch (error) {
      showPermissionNotice(
        error instanceof Error ? error.message : String(error),
        'error',
        6000,
      );
    } finally {
      if (permissionModeSettingRequestRef.current === sessionId) {
        permissionModeSettingRequestRef.current = null;
      }
      setPermissionModeSettingSessionId((current) => current === sessionId ? null : current);
    }
  }, [showPermissionNotice]);

  const handleComposerIntentChange = React.useCallback((intent: ComposerIntent) => {
    if (activeDetailRef.current?.projectId) {
      setComposerIntent('boss');
      if (intent !== 'boss') {
        showPermissionNotice('项目会话固定使用 Boss 模式', 'info', 3000);
      }
      return;
    }
    if (activeSessionIdRef.current) {
      composerIntentStatesRef.current.set(activeSessionIdRef.current, {
        ...composerIntentStatesRef.current.get(activeSessionIdRef.current),
        selected: intent,
      });
    }
    setComposerIntent(intent);
  }, [showPermissionNotice]);

  const handleDeleteSession = React.useCallback(async (sessionId: string) => {
    if (deletingSessionIdsRef.current.has(sessionId)) return;
    deletingSessionIdsRef.current.add(sessionId);

    let result: { ok?: boolean; removedCronTasks?: number } | undefined;
    try {
      result = await window.agentDesktop.deleteSession({ sessionId }) as
        typeof result;
      if (result?.ok !== true) throw new Error('会话删除未完成，请重试。');
    } catch (err) {
      if (!isSessionAlreadyRemovedError(err)) {
        removedSessionIdsRef.current.delete(sessionId);
        await refreshSummaries().catch(() => undefined);
        showPermissionNotice(err instanceof Error ? err.message : String(err), 'error', 6000);
        return;
      }
    } finally {
      deletingSessionIdsRef.current.delete(sessionId);
    }

    removedSessionIdsRef.current.add(sessionId);
    setSummaries((prev) => prev.filter((entry) => entry.id !== sessionId));
    if (result?.removedCronTasks) {
      const notice = `会话已删除，同时清理了 ${result.removedCronTasks} 个定时任务`;
      showPermissionNotice(notice, 'info', 5000);
    }
    if (activeSessionIdRef.current === sessionId) {
      navigateToHome({ forceDiscardDirty: true });
    }
    const nextModes = new Map(sessionAgentModes);
    nextModes.delete(sessionId);
    persistSessionAgentModes(nextModes);
    await refreshSummaries().catch(() => undefined);
  }, [navigateToHome, refreshSummaries, sessionAgentModes, persistSessionAgentModes, showPermissionNotice]);

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
    files?: ComposerAttachment[],
    skills?: Array<{ name: string; displayName?: string; source?: string }>,
    agentType?: string,
    selectedResource?: AppComposerResource | null,
  ) => {
    // Show activity during IPC/runtime startup, before the first busy event.
    const request = Symbol();
    const epoch = queueEpochs.current.get(sessionId) ?? 0;
    setPendingSendRequests(previous => new Map(previous).set(sessionId, request));
    try {
      const paths = files?.filter(file => !file.resource).map(file => file.path) ?? [];
      if (paths.length) {
        const detail = await window.agentDesktop.getSession({ sessionId });
        if (detail.agentMode === 'local') {
          const resolved = await window.agentDesktop.preview.resolveFiles({ sessionId, paths });
          const missing = resolved.filter(item => !('file' in item));
          if (missing.length) throw new Error(`附件已失效，请重新选择：${missing.map(item => item.inputPath).join('、')}`);
        }
      }
      if (epoch !== (queueEpochs.current.get(sessionId) ?? 0)) throw new Error('发送已停止，草稿已保留。');
      await window.agentDesktop.send({
        sessionId,
        prompt,
        appContext: selectedResource ? resourceContext(selectedResource) : undefined,
        skills,
        agentType,
        mode: intent,
        files: files?.filter((file) => !file.resource).map((file) => file.path),
        resources: files?.flatMap((file) => file.resource ? [file.resource] : []),
      });
    } finally {
      setPendingSendRequests(previous => {
        if (previous.get(sessionId) !== request) return previous;
        const next = new Map(previous);
        next.delete(sessionId);
        return next;
      });
    }
  }, [selectedAssistant]);

  // Dispatch the next queued message when a turn ends. Kept in a ref so the
  // once-registered agent:state listener always calls the latest version.
  const flushQueuedMessagesRef = React.useRef<(sessionId: string) => void>(() => {});
  const flushingQueues = React.useRef(new Set<string>());
  React.useEffect(() => {
    flushQueuedMessagesRef.current = (sessionId: string) => {
      if (flushingQueues.current.has(sessionId)) return;
      const queue = queuedMessagesRef.current[sessionId] ?? [];
      const next = queue.find(item => !item.status || item.status === 'queued');
      if (!next) return;
      flushingQueues.current.add(sessionId);
      const epoch = queueEpochs.current.get(sessionId) ?? 0;
      updateQueue(sessionId, items => items.map(item => item.id === next.id ? { ...item, status: 'dispatching' } : item));
      void (async () => {
        try {
          const detail = await window.agentDesktop.getSession({ sessionId });
          if (epoch !== (queueEpochs.current.get(sessionId) ?? 0)) {
            updateQueue(sessionId, items => items.map(item => item.id === next.id ? { ...item, status: 'draft', notice: '已停止排队，内容已保留。' } : item));
            return;
          }
          if (next.workspace !== undefined && next.workspace !== detail.workspace) throw new Error('工作区已变化，请切回原工作区后编辑。');
          await dispatchToSession(sessionId, next.prompt, next.intent, next.files, next.skills, next.agentType, next.appSelection);
          updateQueue(sessionId, items => items.filter(item => item.id !== next.id));
        } catch (err) {
          // A transport rejection does not prove that the Host never accepted
          // the message. Preserve it for review, never enqueue an automatic replay.
          updateQueue(sessionId, items => items.map(item => item.id === next.id ? { ...item, status: 'draft',
            notice: `发送未确认，请先核对会话记录。${cleanIpcErrorMessage(err)}` } : item));
        } finally {
          flushingQueues.current.delete(sessionId);
          // turn-end can arrive before send() resolves. Reconcile once after
          // releasing the lock so that event ordering cannot strand the queue.
          if (epoch === (queueEpochs.current.get(sessionId) ?? 0) && !removedSessionIdsRef.current.has(sessionId)) {
            void window.agentDesktop.getSession({ sessionId }).then(detail => {
              if (!detail.busy && epoch === (queueEpochs.current.get(sessionId) ?? 0)) flushQueuedMessagesRef.current(sessionId);
            }).catch(() => {});
          }
        }
      })();
    };
  }, [dispatchToSession, updateQueue]);

  const submitPrompt = React.useCallback(async (
    intent: ComposerIntent,
    files?: ComposerAttachment[],
    workspace?: string,
    skills?: Array<{ name: string; displayName?: string; source?: string }>,
    agent?: DesktopAgentDefinition,
  ) => {
    const hasText = input.trim().length > 0;
    const hasFiles = files && files.length > 0;
    if (!hasText && !hasFiles) return;
    if (planDecisionBusy) return;

    const prompt = input.trim();
    const selection = appSelection;
    const messageWorkspace = activeSessionId ? activeDetail?.workspace : workspace || appDraftWorkspace;

    // Session is busy: queue the message; it is dispatched automatically when
    // the current turn ends (same as typing while the CLI REPL is running).
    // Claim it before asynchronous App preparation so Stop/turn-end can see it.
    // The Host resolves and validates App resources again when dispatching.
    if (activeDetail?.busy && activeSessionId) {
      const queued: QueuedMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        prompt,
        skills,
        files,
        intent,
        agentType: agent?.agentType,
        agent,
        appSelection: selection,
        workspace: messageWorkspace,
        status: 'queued',
      };
      updateQueue(activeSessionId, (prev) => [...prev, queued]);
      setInput('');
      setAppSelection(null);
      return;
    }

    let sessionId = activeSessionId;
    let filesToSend = files;
    let sendAttempted = false;
    const submitEpoch = activeSessionId ? queueEpochs.current.get(activeSessionId) ?? 0 : 0;
    setInput('');
    setAppSelection(current => current === selection ? null : current);
    try {
      if (selection && (activeSessionId ? activeDetail?.agentMode : newSessionAgentMode) === 'remote-direct') throw new Error('工作流需要本地会话，请先切换工作电脑');
      if (selection) await window.agentDesktop.prepareAppResource({ context: resourceContext(selection), sessionId: activeSessionId || undefined, workspace: workspace || appDraftWorkspace });
      let sessionJustCreated = false;
      if (!sessionId) {
        // Reuse an in-flight creation so a re-entrant submit (double-send or a
        // retry after an errored first turn) binds to the SAME session/workspace
        // instead of spawning a second directory.
        if (!creatingSessionRef.current) {
          setPreparingNewSession(true);
          creatingSessionRef.current = createAndOpenSession(
            undefined,
            workspace || appDraftWorkspace,
            selectedAssistant?.name,
            draftConnectorIds,
            newSessionPermissionMode,
            newSessionAgentMode,
            draftAppIds,
            draftAppServiceIds,
          ).finally(() => {
            creatingSessionRef.current = null;
            setPreparingNewSession(false);
          });
          sessionJustCreated = true;
        }
        sessionId = await creatingSessionRef.current;
        if (sessionJustCreated) { setDraftAppIds([]); setDraftAppServiceIds([]); }
      }
      if (!sessionId) return;

      // If we just created a new session and have files, copy them to the new workspace
      if (sessionJustCreated && hasFiles) {
        const newFiles: ComposerAttachment[] = [];
        for (const file of files!) {
          if (file.resource) {
            newFiles.push(file);
            continue;
          }
          const result = await window.agentDesktop.copyFileToWorkspace({
            sessionId,
            sourcePath: file.path,
            fileName: file.name,
          }) as { path: string } | { error: string };
          if ('path' in result) {
            newFiles.push({ ...file, path: result.path });
          } else {
            throw new Error(`附件复制失败：${file.name}。${result.error}`);
          }
        }
        filesToSend = newFiles;
      }

      if (submitEpoch !== (queueEpochs.current.get(sessionId) ?? 0)) throw new Error('发送已停止，草稿已保留。');
      sendAttempted = true;
      await dispatchToSession(sessionId, prompt, intent, filesToSend, skills, agent?.agentType, selection);
    } catch(error) {
      const current: ComposerDraft = { text: inputDraftRef.current, files: composerAttachmentsRef.current,
        choices: composerChoicesRef.current, appSelection: appSelectionDraftRef.current };
      if (activeSessionIdRef.current === sessionId && composerIsEmpty(current) &&
        (messageWorkspace === undefined || messageWorkspace === (sessionId ? activeDetailRef.current?.workspace : appDraftWorkspace))) {
        setInput(prompt); setComposerAttachments(filesToSend ?? []);
        setComposerChoices({ skills: skills ?? [], agent: agent ?? null });
        setAppSelection(selection);
        handleComposerIntentChange(intent);
      } else {
        updateQueue(sessionId || 'home', items => [...items, { id: crypto.randomUUID(), prompt, intent, files: filesToSend,
          skills, agent, agentType: agent?.agentType, appSelection: selection, workspace: messageWorkspace,
          status: 'draft', notice: sendAttempted ? '发送未确认，请先核对会话记录。' : `发送准备失败，内容已保留。${cleanIpcErrorMessage(error)}` }]);
      }
      throw error;
    }
  }, [appSelection, appDraftWorkspace, activeDetail?.busy, activeDetail?.workspace, activeDetail?.agentMode, activeSessionId, createAndOpenSession, dispatchToSession, draftConnectorIds, draftAppIds, draftAppServiceIds, input, newSessionAgentMode, newSessionPermissionMode, planDecisionBusy, selectedAssistant, updateQueue, handleComposerIntentChange]);

  const handleSend = React.useCallback(async (
    files?: ComposerAttachment[],
    workspace?: string,
    skills?: Array<{ name: string; displayName?: string; source?: string }>,
    agent?: DesktopAgentDefinition,
  ) => {
    try {
      await submitPrompt(composerIntent, files, workspace, skills, agent);
    } catch (error) {
      const reason = cleanIpcErrorMessage(error);
      showPermissionNotice(`消息发送失败：${reason}`, 'error', 6000);
      pushAppNotification({
        severity: 'error',
        source: '会话',
        title: '消息发送失败',
        message: reason,
        details: getErrorMessage(error),
      });
    }
  }, [composerIntent, submitPrompt, showPermissionNotice, pushAppNotification]);

  const interactionRequests = React.useRef(new Map<string, { id: string; kind: InteractionKind; prompt: string; details?: InteractionDetails }>());
  const handleSessionInteraction = React.useCallback(async (kind: InteractionKind, prompt: string, details?: InteractionDetails) => {
    const sessionId = activeSessionId;
    if (!sessionId) throw new Error('请先打开主会话。');
    const originalInput = inputDraftRef.current;
    const epoch = queueEpochs.current.get(sessionId) ?? 0;
    const key = `${sessionId}:${kind}`;
    const previous = interactionRequests.current.get(key);
    const request = previous?.prompt === prompt && JSON.stringify(previous.details) === JSON.stringify(details)
      ? previous : { id: crypto.randomUUID(), kind, prompt, details };
    interactionRequests.current.set(key, request);
    const result = await window.agentDesktop.sessionInteraction({ sessionId, action: kind, id: request.id, prompt, details });
    if (result.status === 'unknown') throw new Error('上次请求状态未确认，请先核对会话记录。');
    if (kind === 'steer' && result.status === 'cancelled') throw new Error('这条补充已取消，内容已保留。');
    if (kind === 'steer' && ['not_running', 'unsupported', 'deferred'].includes(result.status)) {
      if (epoch !== (queueEpochs.current.get(sessionId) ?? 0)) throw new Error('发送已停止，内容已保留。');
      const queued: QueuedMessage = { ...details, id: request.id, prompt, intent: details?.intent || composerIntent,
        workspace: details?.workspace || activeDetail?.workspace, status: 'queued' };
      updateQueue(sessionId, items => items.some(item => item.id === request.id) ? items : [...items, queued]);
      // Only an explicit non-acceptance can use the ordinary send path. Lost
      // transport receipts remain retryable with the same ID, never auto-replayed.
      void window.agentDesktop.getSession({ sessionId }).then(detail => {
        if (!detail.busy && epoch === (queueEpochs.current.get(sessionId) ?? 0)) flushQueuedMessagesRef.current(sessionId);
      }).catch(() => {});
    } else if (!['accepted', 'consumed', 'running', 'completed', 'truncated', 'empty', 'tool_unavailable', 'failed', 'cancelled', 'timeout'].includes(result.status)) {
      throw new Error('消息接收状态未确认，内容已保留。');
    }
    if (interactionRequests.current.get(key) === request) interactionRequests.current.delete(key);
    if (kind === 'steer' && activeSessionIdRef.current === sessionId && inputDraftRef.current === originalInput) setInput('');
  }, [activeSessionId, composerIntent, activeDetail?.workspace, updateQueue]);


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

  const handleRejectQuestion = React.useCallback(async (request: AskUserQuestionRequest, message?: string) => {
    const isToolPermission = request.input?.metadata?.source === 'session:tool-permission';
    await window.agentDesktop.rejectQuestion({
      requestId: request.requestId,
      sessionId: request.sessionId,
      message: message || (isToolPermission
        ? 'User denied tool permission'
        : 'User declined to answer questions'),
    });
    updateQuestionRequests((prev) => prev.filter((entry) => entry.requestId !== request.requestId));
    dismissPermissionNotice();
  }, [dismissPermissionNotice, updateQuestionRequests]);

  const handleStop = React.useCallback(async () => {
    if (!activeSessionId) return;
    // Preserve independent snapshots before abort, so busy=false cannot send them.
    queueEpochs.current.set(activeSessionId, (queueEpochs.current.get(activeSessionId) ?? 0) + 1);
    const queue = queuedMessagesRef.current[activeSessionId] ?? [];
    const preserved = preserveQueuedMessages(queue);
    const first = preserved.find(item => item.status === 'draft');
    const current: ComposerDraft = { text: inputDraftRef.current, files: composerAttachmentsRef.current,
      choices: composerChoicesRef.current, appSelection: appSelectionDraftRef.current };
    if (first && composerIsEmpty(current)) {
      const result = withdrawMessage(preserved, first.id, current, activeDetailRef.current?.workspace);
      updateQueue(activeSessionId, () => result.queue);
      if (result.restored) {
        setInput(result.draft.text); setComposerAttachments(result.draft.files);
        setComposerChoices(result.draft.choices!); setAppSelection(result.draft.appSelection || null);
        handleComposerIntentChange(result.draft.intent!);
      }
    } else {
      updateQueue(activeSessionId, () => preserved);
    }
    updateQuestionRequests((prev) => prev.filter((entry) => entry.sessionId !== activeSessionId));
    await window.agentDesktop.abort({ sessionId: activeSessionId });
  }, [activeSessionId, updateQueue, updateQuestionRequests, handleComposerIntentChange]);

  const handleEditQueuedMessage = React.useCallback((id: string) => {
    const sessionId = activeSessionIdRef.current || 'home';
    const result = withdrawMessage(queuedMessagesRef.current[sessionId] ?? [], id,
      { text: inputDraftRef.current, files: composerAttachmentsRef.current, choices: composerChoicesRef.current,
        appSelection: appSelectionDraftRef.current }, activeSessionIdRef.current ? activeDetailRef.current?.workspace : appDraftWorkspace);
    updateQueue(sessionId, () => result.queue);
    if (result.restored) {
      setInput(result.draft.text); setComposerAttachments(result.draft.files);
      setComposerChoices(result.draft.choices!); setAppSelection(result.draft.appSelection || null);
      handleComposerIntentChange(result.draft.intent!);
    }
  }, [updateQueue, handleComposerIntentChange, appDraftWorkspace]);

  const handleRestoreInteraction = React.useCallback((item: SessionInteraction) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    const queued: QueuedMessage = { ...item.details, id: item.id, prompt: item.prompt, intent: item.details?.intent || composerIntent, status: 'draft' };
    const existing = queuedMessagesRef.current[sessionId] ?? [];
    const result = withdrawMessage([...existing.filter(entry => entry.id !== item.id), queued], item.id,
      { text: inputDraftRef.current, files: composerAttachmentsRef.current, choices: composerChoicesRef.current, appSelection: appSelectionDraftRef.current },
      activeDetailRef.current?.workspace);
    updateQueue(sessionId, () => result.queue);
    if (result.restored) {
      setInput(result.draft.text); setComposerAttachments(result.draft.files);
      setComposerChoices(result.draft.choices!); setAppSelection(result.draft.appSelection || null);
      handleComposerIntentChange(result.draft.intent!);
    }
  }, [composerIntent, updateQueue, handleComposerIntentChange]);

  const handleRemoveQueuedMessage = React.useCallback((id: string) => {
    updateQueue(activeSessionId || 'home', (prev) => prev.filter((q) => q.id !== id || q.status === 'dispatching'));
  }, [activeSessionId, updateQueue]);

  const handlePickWorkspace = React.useCallback(async () => {
    if (!activeSessionId) return;
    const dir = await window.agentDesktop.pickDirectory();
    if (!dir) return;
    const detail = await window.agentDesktop.setSessionWorkspace({ sessionId: activeSessionId, workspace: dir });
    if (activeSessionIdRef.current !== detail.id) return;
    activeDetailRef.current = detail;
    setActiveDetail(detail);
    setSummaries((prev) => prev.map((entry) => (entry.id === detail.id ? detail : entry)));
    clearSessionWorkspaceState();
  }, [activeSessionId, clearSessionWorkspaceState]);

  const handleRefreshWorkspace = React.useCallback(async () => {
    await refreshWorkspaceSnapshot();
  }, [refreshWorkspaceSnapshot]);

  const handleOpenWorkspace = React.useCallback(async () => {
    if (!activeSessionId) return;
    try { await window.agentDesktop.openWorkspace({ sessionId: activeSessionId }); }
    catch (error) { showPermissionNotice(error instanceof Error ? error.message : String(error), 'error', 6000); }
  }, [activeSessionId, showPermissionNotice]);

  const handleToggleFolder = React.useCallback(async (path: string) => {
    const detail = activeDetailRef.current;
    if (!detail || detail.id !== activeSessionIdRef.current) return;
    const next = new Set(expandedDirsRef.current);
    if (next.has(path)) {
      next.delete(path);
      expandedDirsRef.current = next;
      setExpandedDirs(next);
      return;
    }
    next.add(path);
    expandedDirsRef.current = next;
    setExpandedDirs(next);
    try {
      await workspaceDirectoryLoader.load({ sessionId: detail.id, workspace: detail.workspace }, path);
    } catch {
      if (activeSessionIdRef.current !== detail.id || activeDetailRef.current?.workspace !== detail.workspace) return;
      setExpandedDirs((prev) => {
        const rolled = new Set(prev);
        rolled.delete(path);
        expandedDirsRef.current = rolled;
        return rolled;
      });
    }
  }, [workspaceDirectoryLoader]);

  const handleSelectFile = React.useCallback(async (path: string) => {
    if (!activeSessionId) return;
    const existing = previewTabsRef.current.find((entry) => entry.path === path);
    if (existing) {
      openPreviewWindow(existing);
      return;
    }
    const data = await window.agentDesktop.readWorkspaceFile({
      sessionId: activeSessionId,
      filePath: path,
    });
    openPreviewWindow(data);
  }, [activeSessionId, openPreviewWindow]);

  const handleLaunchApp = React.useCallback(async (name: string, options?: { settings?: boolean; route?: string }) => {
    try {
      const app = apps.find(item => item.name === name);
      if (!app) throw new Error('App 未安装');
      const entry = getAppPrimaryEntry(app);
      if (options?.settings || entry?.location === 'settings') {
        const setting = getAppSettingsEntries([app]).find(item => options?.route ? item.route === options.route : entry?.location !== 'settings' || item.id === entry.settingsId);
        if (!setting) throw new Error('App 未声明设置页');
        if (setting.unavailableReason) throw new Error(setting.unavailableReason);
        if (app.navigation?.location === 'settings') {
          setSettingsInitialAppId(setting.id);
          setActiveView('settings');
        } else {
          setEmbeddedAppName(name);
          setEmbeddedAppRoute(setting.route);
          setActiveView('embedded-app');
        }
        return;
      }
      const reason = entry?.unavailableReason || appPageUnavailableReason(app);
      if (reason) throw new Error(reason);
      if (!app.hasUi || (!entry && app.navigation?.location !== 'none')) throw new Error('App 没有可用页面');
      setEmbeddedAppName(name);
      setEmbeddedAppRoute(entry?.route || '');
      setActiveView('embedded-app');
    } catch (error: any) {
      showPermissionNotice(`App 打开失败：${cleanIpcErrorMessage(error?.message || String(error))}`, 'error', 6000);
    }
  }, [apps, showPermissionNotice]);

  const handleOpenEmbeddedApp = React.useCallback((name: string, route = '') => {
    setEmbeddedAppName(name);
    setEmbeddedAppRoute(route);
    setActiveView('embedded-app');
  }, []);

  const handleSelectAssistant = React.useCallback((assistant: InstalledAssistant) => {
    setSelectedAssistant(assistant);
  }, []);

  const handleClearAssistant = React.useCallback(() => {
    setSelectedAssistant(null);
  }, []);

  const selectedToolServiceIds = activeSessionId ? (activeDetail?.appServiceIds || []) : draftAppServiceIds;
  const selectedToolAppIds = activeSessionId ? (activeDetail?.appIds || []) : draftAppIds;
  const enqueueAppSelection = React.useCallback((operation: () => Promise<unknown>) => {
    setAppSelectionPending(true);
    const task = appSelectionQueue.current.catch(() => {}).then(operation);
    appSelectionQueue.current = task;
    void task.catch(error => showPermissionNotice(cleanIpcErrorMessage(String(error.message || error)), 'error', 6000))
      .finally(() => { if (appSelectionQueue.current === task) setAppSelectionPending(false); });
  }, [showPermissionNotice]);

  const applyAppSessionDetail = React.useCallback((detail: SessionDetail) => {
    if (activeSessionIdRef.current === detail.id) {
      setActiveDetail(detail); activeDetailRef.current = detail;
    }
    setSummaries(previous => upsertSummary(previous, detail));
  }, []);

  const handleToggleToolApp = React.useCallback((id: string) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      const app = apps.find(item => toolAppId(item) === id);
      if (!draftAppIds.includes(id) && (!app || !canSelectToolApp(app))) {
        showPermissionNotice('此 App 暂未提供可用工具，请检查启用状态、授权或服务配置', 'error', 6000);
        return;
      }
      setDraftAppIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
      return;
    }
    enqueueAppSelection(async () => {
      const result = await window.agentDesktop.setSessionApps({ sessionId, toggleAppId: id });
      if (!result.success || !result.data) throw new Error(result.error || 'App 更新失败');
      applyAppSessionDetail(result.data);
    });
  }, [apps, draftAppIds, showPermissionNotice, enqueueAppSelection, applyAppSessionDetail]);

  const handleToolServices = React.useCallback((appId: string, ids: string[], toggleId?: string) => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      const app = apps.find(item => toolAppId(item) === appId);
      const available = app ? getAppToolServices(app).filter(service => service.available).map(service => service.id) : [];
      const requested = toggleId ? [toggleId] : ids;
      if (requested.some(id => !available.includes(id) && !draftAppServiceIds.includes(id))) {
        showPermissionNotice('此子服务暂不可用，请检查启用状态、授权或服务配置', 'error', 6000); return;
      }
      setDraftAppServiceIds(previous => toggleId
        ? previous.includes(toggleId) ? previous.filter(id => id !== toggleId) : [...previous, toggleId]
        : [...previous.filter(id => parseAppServiceKey(id)?.appId !== appId), ...ids]);
      return;
    }
    enqueueAppSelection(async () => {
      const result = await window.agentDesktop.setSessionApps(toggleId ? { sessionId, toggleServiceId: toggleId } : { sessionId, serviceAppId: appId, appServiceIds: ids });
      if (!result.success || !result.data) throw new Error(result.error || '子服务更新失败');
      applyAppSessionDetail(result.data);
    });
  }, [apps, draftAppServiceIds, showPermissionNotice, enqueueAppSelection, applyAppSessionDetail]);

  const addAppResourceOwner = React.useCallback(async (sessionId: string | undefined, providerId: string) => {
    const { appId, data } = await window.agentDesktop.selectAppResource({ sessionId, providerId });
    if (data) applyAppSessionDetail(data);
    if (!sessionId) {
      const app = apps.find(item => toolAppId(item) === appId);
      if (app?.toolSelection === 'services') setDraftAppServiceIds(previous => [...new Set([...previous, ...getAppToolServices(app).filter(service => service.available).map(service => service.id)])]);
      else setDraftAppIds(previous => [...new Set([...previous, appId])]);
    }
    return appId;
  }, [apps, applyAppSessionDetail]);

  const handleSelectAppResource = React.useCallback((resource: AppComposerResource | null) => {
    if (!resource) { setAppSelection(null); return; }
    const sessionId = activeSessionIdRef.current || undefined;
    enqueueAppSelection(async () => {
      const appId = await addAppResourceOwner(sessionId, resource.providerId);
      if ((activeSessionIdRef.current || undefined) === sessionId) setAppSelection({ ...resource, appId });
    });
  }, [enqueueAppSelection, addAppResourceOwner]);

  const selectedConnectorIds = React.useMemo(
    () => (activeSessionId ? (activeDetail?.connectorIds ?? []) : draftConnectorIds).filter(id => !apps.some(app => app.connectorApp?.id === id)),
    [activeDetail?.connectorIds, activeSessionId, draftConnectorIds, apps],
  );

  React.useEffect(() => {
    const authorizedIds = new Set(
      installedConnectors.filter(isAuthorizedConnector).map((connector) => connector.id),
    );
    setDraftConnectorIds((prev) => prev.filter((id) => authorizedIds.has(id)));
  }, [installedConnectors]);

  const handleToggleConnector = React.useCallback(async (connector: InstalledConnector) => {
    const current = activeSessionId ? (activeDetailRef.current?.connectorIds ?? []) : draftConnectorIds;
    const isSelected = current.includes(connector.id);
    if (!isSelected && !isAuthorizedConnector(connector)) {
      showPermissionNotice(`${connector.name} 尚未完成认证，不能加入会话`, 'error', 6000);
      return false;
    }
    const next = isSelected
      ? current.filter((id) => id !== connector.id)
      : [...current, connector.id];

    if (!activeSessionId) {
      setDraftConnectorIds(next);
      return true;
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
      return false;
    }
    const detail = res.data;
    setActiveDetail(detail);
    activeDetailRef.current = detail;
    setSummaries((prev) => upsertSummary(prev, detail));
    return true;
  }, [activeSessionId, draftConnectorIds, pushAppNotification, showPermissionNotice]);

  React.useEffect(() => window.agentDesktop.onAppOpenSession(({ sessionId, toolUseId }) => {
    void openSession(sessionId).then(opened => {
      if (!opened) { showPermissionNotice('对应会话不存在或当前无法打开。', 'error', 6000); return; }
      toolFocusRequestIdRef.current += 1;
      setToolFocusTarget(toolUseId ? { sessionId, toolUseId, requestId: toolFocusRequestIdRef.current } : null);
    }).catch(error => showPermissionNotice(String(error.message || error), 'error', 6000));
  }), [openSession, showPermissionNotice]);

  React.useEffect(() => window.agentDesktop.onAppComposerBound?.(({ sessionId, context }) => {
    const selection = { ...context, appId: context.providerId.split('/')[0], title: 'App 项目' };
    composerDraftsRef.current[sessionId] = { ...(composerDraftsRef.current[sessionId] || { text: '', files: [] }), appSelection: selection };
    if (activeSessionIdRef.current === sessionId) setAppSelection(selection);
  }), []);

  React.useEffect(() => window.agentDesktop.onAppPrepareComposer(payload => { enqueueAppSelection(async () => {
    const appId = await addAppResourceOwner(payload.sessionId, payload.context.providerId);
    const selection = { ...payload.context, appId, title:payload.title, route:payload.route, workspace:payload.workspace };
    composerDraftsRef.current[draftSessionKeyRef.current] = { text:inputDraftRef.current, files:composerAttachmentsRef.current, appSelection:appSelectionDraftRef.current, choices:composerChoicesRef.current };
    if (payload.sessionId) {
      const previous = composerDraftsRef.current[payload.sessionId];
      composerDraftsRef.current[payload.sessionId] = { ...previous, text: previous?.text || payload.prompt, files: previous?.files || [], appSelection: selection };
      if (!await openSession(payload.sessionId)) return;
      setAppSelection(selection);
      setInput(previous?.text || payload.prompt);
      return;
    }
    composerDraftsRef.current.home = { text:payload.prompt, files:[], appSelection:selection };
    draftSessionKeyRef.current = 'home'; setHydratedComposerKey('home');
    if (!navigateToHome({ preserveIntent: true, preserveAgentMode: true })) return;
    setComposerAttachments([]);
    setSelectedAssistant(null);
    setAppDraftWorkspace(payload.workspace);
    setAppSelection(selection);
    setInput(payload.prompt);
  }); }), [navigateToHome, openSession, enqueueAppSelection, addAppResourceOwner]);

  const handleIterateExistingApp = React.useCallback(async (name: string) => {
    try { await window.agentDesktop.prepareAppAuthoring(name); }
    catch (error) { showPermissionNotice(cleanIpcErrorMessage(String(error)), 'error', 6000); }
  }, [showPermissionNotice]);

  const handleDeleteApp = React.useCallback(async (name: string, options: { deleteData?: boolean; deleteCredentials?: boolean } = {}) => {
    const result = await window.agentDesktop.deleteApp({ name, ...options });
    if (!result?.ok) {
      showPermissionNotice(`App 卸载失败：${cleanIpcErrorMessage(result?.error || '未知错误')}`, 'error', 6000);
      return;
    }
    setVersionsByApp((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    await refreshApps();
  }, [refreshApps, showPermissionNotice]);

  const handleRollbackApp = React.useCallback(async (name: string, versionId: string) => {
    const result = await window.agentDesktop.rollbackApp({ name, versionId });
    if (!result?.ok) {
      showPermissionNotice(`App 回滚失败：${cleanIpcErrorMessage(result?.error || '未知错误')}`, 'error', 6000);
      return;
    }
    await refreshApps();
    await loadAppVersions(name);
  }, [loadAppVersions, refreshApps, showPermissionNotice]);

  const autoSaveSettings = React.useCallback(async (key: keyof DesktopSettings, value: any) => {
    try {
      const payload = { [key]: value };
      const saved = await window.agentDesktop.updateSettings(payload);
      applyDesktopSettings(saved);
    } catch (error: any) {
      setSettingsNotice(error?.message || String(error));
    }
  }, [applyDesktopSettings]);

  React.useEffect(() => {
    if (!desktopSettings || localStorage.getItem('ui.buddyVisibilityMigrated.v1')) return;
    const old = localStorage.getItem('ui.buddyEnabled');
    if (old === null) { localStorage.setItem('ui.buddyVisibilityMigrated.v1', 'done'); return; }
    void window.agentDesktop.updateSettings({ appWidgets: { enabled: old !== 'false' } }).then(saved => {
      applyDesktopSettings(saved); localStorage.setItem('ui.buddyVisibilityMigrated.v1', 'done');
    }).catch(error => setSettingsNotice(error.message));
  }, [Boolean(desktopSettings), applyDesktopSettings]);

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
    const requestId = appearanceSaveRequestRef.current + 1;
    appearanceSaveRequestRef.current = requestId;
    applyAppearanceOptimistically(next);
    void window.agentDesktop.updateSettings({ appearance: next }).then((saved) => {
      if (requestId !== appearanceSaveRequestRef.current) {
        committedAppearanceRef.current = saved.appearance;
        return;
      }
      applyDesktopSettings(saved);
    }).catch((error: any) => {
      if (requestId !== appearanceSaveRequestRef.current) return;
      applyAppearanceOptimistically(committedAppearanceRef.current);
      setSettingsNotice(error?.message || String(error));
    });
  }, [applyAppearanceOptimistically, applyDesktopSettings]);

  const handleThemeModeChange = React.useCallback((mode: ThemeMode) => {
    saveAppearance({ themeMode: mode });
  }, [saveAppearance]);

  const handleCssThemeChange = React.useCallback((id: string) => {
    saveAppearance({ cssThemeId: id as DesktopSettings['appearance']['cssThemeId'] });
  }, [saveAppearance]);

  const previewAppearance = React.useCallback((patch: Partial<DesktopSettings['appearance']>) => {
    applyAppearanceOptimistically({ ...appearanceRef.current, ...patch });
  }, [applyAppearanceOptimistically]);

  const handleNewSessionModeChange = React.useCallback(async (mode: 'local' | 'remote-direct') => {
    setNewSessionAgentMode(mode);
    await refreshAssistants(mode);
  }, [refreshAssistants]);

  const renderSettingsView = () => (
    <SettingsView
      apps={apps}
      settingsDraft={settingsDraft}
      setSettingsDraft={setSettingsDraft}
      settingsNotice={settingsNotice}
      autoSaveSettings={autoSaveSettings}
      autoSaveImageSettings={autoSaveImageSettings}
      themeMode={themeMode}
      setThemeMode={handleThemeModeChange}
      cssThemeId={cssThemeId}
      setCssThemeId={handleCssThemeChange}
      onToolDisplayModeChange={(mode) => {
        saveAppearance({ toolDisplayMode: mode });
      }}
      onAppearancePreview={previewAppearance}
      onAppearanceCommit={saveAppearance}
      workspace={activeDetail && activeDetail.agentMode !== 'remote-direct'
        ? activeDetail.workspace
        : undefined}
      initialSection={settingsInitialSection}
      initialAppSettingId={settingsInitialAppId}
      onOpenAppManagement={(name) => { setAppManagementName(apps.find(app => app.name === name)?.id || name); setActiveView('apps'); }}
    />
  );

  const notificationCenter = (
    <NotificationCenter
      placement={window.mossWeb ? 'sidebar' : 'window'}
      notifications={appNotifications}
      onMarkRead={(id) => {
        void window.agentDesktop.notifications.markRead(id);
      }}
      onMarkAllRead={() => {
        void window.agentDesktop.notifications.markAllRead();
      }}
      onRemove={(id) => {
        void window.agentDesktop.notifications.remove(id);
      }}
      onClear={() => {
        void window.agentDesktop.notifications.clear()
          .then(() => { saveAppNotifications([], window.localStorage); })
          .catch(() => {});
      }}
      onResolveDecision={async (decisionId, allowed, choice) => {
        if (window.mossWeb?.capabilities?.features.confirmations) {
          const pending = await window.agentDesktop.confirmations.list();
          if (pending.requests.some(item => item.id === decisionId)) {
            window.dispatchEvent(new CustomEvent('moss:show-confirmation', { detail: decisionId }));
            return;
          }
        }
        await window.agentDesktop.decisions.respond({ decisionId, allowed, choice });
      }}
    />
  );

  return (
    <AppToolSelectionContext.Provider value={{ apps: (activeSessionId ? activeDetail?.agentMode === 'remote-direct' : newSessionAgentMode === 'remote-direct') ? apps.filter(app => app.connectorApp) : apps, selectedIds: selectedToolAppIds, selectedServiceIds: selectedToolServiceIds, toggleService: id => handleToolServices(parseAppServiceKey(id)?.appId || '', [], id), setServices: handleToolServices, enabled: true, pending: appSelectionPending, nextTurn: Boolean(activeDetail?.appToolsPending), toggle: handleToggleToolApp, openManager: () => setActiveView('apps') }}>
    <AppComposerContext.Provider value={{ selection: appSelection, select: handleSelectAppResource }}>
    <UserAvatarContext.Provider value={desktopSettings?.userAvatar ?? ''}>
    <ToolDisplaySettingsProvider
      toolDisplayMode={desktopSettings?.appearance.toolDisplayMode ?? 'expanded'}
    >
    <div
      className={`${themeMode === 'dark' ? 'dark' : ''} flex h-screen w-full flex-col overflow-hidden app-shell`}
      style={getChatAppearanceStyle(desktopSettings?.appearance)}
    >
      <HostConfirmations />
      <WebAuthorizations />
      <WebAppPreviews />
      <WebInteractions />
      {hydratedComposerKey === (activeSessionId || 'home') && <WebComposerDraft key={activeSessionId || 'home'} session={activeSessionId || 'home'}
        value={{ text: input, files: composerAttachments, appSelection, choices: composerChoices, intent: composerIntent,
          workspace: activeSessionId ? activeDetail?.workspace : appDraftWorkspace, queued: queuedMessages[activeSessionId || 'home'] }}
        restore={draft => {
          if (activeSessionId && draft.workspace !== undefined && draft.workspace !== activeDetail?.workspace) {
            updateQueue(activeSessionId, items => [...items, ...recoverQueuedMessages(draft.queued),
              ...(composerIsEmpty(draft) ? [] : [{ ...messageFromDraft(draft, crypto.randomUUID()), notice: '工作区已变化，请切回原工作区后编辑。' }])]);
            return;
          }
          setInput(draft.text); setComposerAttachments(draft.files); setAppSelection(draft.appSelection || null);
          setComposerChoices(draft.choices ?? { skills: [], agent: null });
          if (!activeSessionId) setAppDraftWorkspace(draft.workspace);
          if (draft.intent) handleComposerIntentChange(draft.intent);
          if (draft.queued?.length) updateQueue(activeSessionId || 'home', items => {
            const ids = new Set(items.map(item => item.id));
            return [...items, ...recoverQueuedMessages(draft.queued).filter(item => !ids.has(item.id))];
          });
        }} />}
      {!window.mossWeb && <div className={`moss-window-chrome ${isMacOS ? '' : 'moss-window-chrome-native'} relative shrink-0`}>
        <div
          className="moss-window-drag h-9"
          style={{ paddingLeft: isMacOS ? 84 : 0 }}
        />
        <div
          className="absolute top-1"
          style={{ right: isMacOS ? 8 : 144 }}
        >
          {notificationCenter}
        </div>
      </div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-h-0 shrink-0 overflow-hidden"
          style={{ width: effectiveLeftCollapsed ? 68 : layout.leftWidth }}
        >
          <ComputerUseControl />
          <AppSidebar
            headerActions={window.mossWeb ? notificationCenter : undefined}
            sessions={sidebarSessions}
            apps={apps}
            activeSessionId={activeSessionId}
            activeView={activeView}
            appsCount={apps.length}
            projectsCount={projects.length}
            themeMode={themeMode}
            collapsed={effectiveLeftCollapsed}
            searchQuery={sessionSearchQuery}
            localEnabled={desktopSettings?.localEnabled ?? true}
            remoteEnabled={desktopSettings?.remoteEnabled ?? false}
            agentMailEnabled={agentMailEnabled}
            onChangeView={(view) => {
              if (view === 'settings') { setSettingsInitialSection('basic-info'); setSettingsInitialAppId(null); }
              if (view === 'apps') setAppManagementName(null);
              setActiveView(view);
            }}
            onChangeTheme={handleThemeModeChange}
            onSelectSession={handleSelectSession}
            onLaunchApp={handleOpenEmbeddedApp}
            onNewSession={handleNewSession}
            onDeleteSession={handleDeleteSession}
            onRenameSession={handleRenameSession}
            onTogglePin={handleTogglePin}
            onSearchChange={setSessionSearchQuery}
            onOpenGlobalSearch={() => setGlobalSearchOpen(true)}
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
          {embeddedAppName ? (
            <div
              className={activeView === 'embedded-app' ? 'h-full min-h-0' : 'hidden'}
              aria-hidden={activeView === 'embedded-app' ? undefined : true}
            >
              <EmbeddedAppView
                key={`${embeddedAppName}:${embeddedAppRoute}:${embeddedAppRevision}`}
                appName={embeddedAppName}
                app={apps.find(app => app.name === embeddedAppName)}
                workspace={activeDetail?.workspace}
                route={embeddedAppRoute}
              />
            </div>
          ) : null}
          {activeView === 'embedded-app' ? null : activeView === 'chat' ? (
            activeSessionId ? (
              <ChatArea
                messages={chatMessages}
                interactions={latestSessionInteractions(activeDetail?.history ?? [])}
                onRestoreInteraction={handleRestoreInteraction}
                onInteraction={activeDetail?.agentMode !== 'remote-direct' && !activeDetail?.isSubAgent ? handleSessionInteraction : undefined}
                value={input}
                loading={Boolean(activeDetail?.busy || pendingSendRequests.has(activeSessionId))}
                busyStartedAt={activeDetail?.busyStartedAt ?? null}
                readOnlyReason={activeDetail?.resumeReadOnlyReason || null}
                hasActiveSession={Boolean(activeSessionId)}
                isProjectSession={Boolean(activeDetail?.projectId)}
                sessionTitle={activeDetail ? displaySessionTitle(activeDetail) : 'New Session'}
                sessionId={activeSessionId || undefined}
                sessionWorkspace={activeDetail?.workspace || undefined}
                sessionAgentMode={activeDetail?.agentMode || sessionAgentModes.get(activeSessionId) || 'local'}
                focusedToolUseId={toolFocusTarget?.sessionId === activeSessionId ? toolFocusTarget.toolUseId : undefined}
                focusedToolRequestId={toolFocusTarget?.sessionId === activeSessionId ? toolFocusTarget.requestId : undefined}
                focusedMessageId={messageFocusTarget?.sessionId === activeSessionId ? messageFocusTarget.messageId : undefined}
                focusedMessageRequestId={messageFocusTarget?.sessionId === activeSessionId ? messageFocusTarget.requestId : undefined}
                pendingPlanApproval={activeDetail?.pendingPlanApproval || null}
                planDecisionBusy={planDecisionBusy}
                leftCollapsed={effectiveLeftCollapsed}
                rightCollapsed={layout.rightCollapsed}
                composerIntent={composerIntent}
                permissionMode={activeDetail?.permissionMode ?? desktopSettings?.permissionMode ?? 'default'}
                onPermissionModeChange={handleSessionPermissionModeChange}
                permissionModeChanging={permissionModeSettingSessionId === activeSessionId}
                childSessions={activeChildSessions}
                onReturnToParentSession={activeDetail?.isSubAgent && activeDetail.parentSessionId
                  ? () => { void openSession(activeDetail.parentSessionId!); }
                  : undefined}
                onChange={setInput}
                onComposerIntentChange={handleComposerIntentChange}
                onToggleLeftSidebar={() => toggleSidebar('left')}
                onToggleRightSidebar={() => toggleSidebar('right')}
                onApprovePlan={handleApprovePlan}
                onRejectPlan={handleRejectPlan}
                onForkSession={handleForkSession}
                forkingSession={forkingSessionId === activeSessionId}
                forkDisabledReason={forkDisabledReason}
                terminalActions={<SessionTerminalActions key={`terminal:${activeSessionId}`} session={activeDetail} />}
                sessionInfo={<SessionInfoButton key={`info:${activeSessionId}`}
                  session={activeDetail?.id === activeSessionId ? activeDetail : null}
                  messages={chatMessages} childSessions={activeChildSessions}
                  backgroundTasks={backgroundTasks[activeSessionId] ?? []} />}
                toolDisplayMode={activeToolDisplayMode}
                sessionToolDisplayMode={activeDetail?.toolDisplayMode ?? null}
                globalToolDisplayMode={globalToolDisplayMode}
                onToolDisplayModeChange={handleSessionToolDisplayModeChange}
                toolDisplaySettingBusy={toolDisplaySettingSessionId === activeSessionId}
                onSend={handleSend}
                onStop={handleStop}
                onOpenChildSession={(sessionId) => { void openSession(sessionId); }}
                installedAssistants={installedAssistants}
                selectedAssistant={selectedAssistant}
                onSelectAssistant={handleSelectAssistant}
                onClearAssistant={handleClearAssistant}
                installedConnectors={activeDetail?.projectId ? [] : installedConnectors.filter(connector => !apps.some(app => app.connectorApp?.id === connector.id))}
                selectedConnectorIds={selectedConnectorIds}
                onToggleConnector={activeDetail?.projectId || !installedConnectors.some(connector => !apps.some(app => app.connectorApp?.id === connector.id)) ? undefined : handleToggleConnector}
                onOpenConnectorHub={() => setActiveView('apps')}
                onOpenExpertHub={() => setActiveView('experts')}
                onOpenAgentManager={() => {
                  setSettingsInitialSection('agents');
                  setSettingsInitialAppId(null);
                  setActiveView('settings');
                }}
                onOpenSkillHub={() => setActiveView('skills')}
                remoteEnabled={desktopSettings?.remoteEnabled ?? false}
                queuedMessages={queuedMessages[activeSessionId] ?? []}
                onRemoveQueuedMessage={handleRemoveQueuedMessage}
                onEditQueuedMessage={handleEditQueuedMessage}
                composerChoices={composerChoices}
                onComposerChoicesChange={setComposerChoices}
                backgroundTasks={backgroundTasks[activeSessionId] ?? []}
                composerAttachments={composerAttachments}
                onComposerAttachmentsChange={setComposerAttachments}
                contextUsage={contextUsage}
                turnTokens={turnTokens}
                agentTeams={agentTeamsBySession[activeSessionId] ?? null}
                toolPermissionRequest={activeToolPermissionRequest}
                questionRequest={activeQuestionRequest}
                onSubmitQuestion={handleSubmitQuestion}
                onDiscussQuestion={handleRejectQuestion}
                onSubmitToolPermission={handleSubmitQuestion}
                onRejectToolPermission={handleRejectQuestion}
              />
            ) : (
              <ChatArea
                messages={[]}
                value={input}
                loading={preparingNewSession}
                hasActiveSession={false}
                queuedMessages={queuedMessages.home ?? []}
                onEditQueuedMessage={handleEditQueuedMessage}
                onRemoveQueuedMessage={handleRemoveQueuedMessage}
                composerAttachments={composerAttachments}
                onComposerAttachmentsChange={setComposerAttachments}
                composerChoices={composerChoices}
                onComposerChoicesChange={setComposerChoices}
                sessionTitle=""
                sessionWorkspace={undefined}
                homeWorkspace={appDraftWorkspace}
                onHomeWorkspaceChange={setAppDraftWorkspace}
                pendingPlanApproval={null}
                planDecisionBusy={false}
                leftCollapsed={effectiveLeftCollapsed}
                rightCollapsed={layout.rightCollapsed}
                composerIntent={composerIntent}
                permissionMode={newSessionPermissionMode}
                onPermissionModeChange={setNewSessionPermissionMode}
                childSessions={[]}
                onChange={setInput}
                onComposerIntentChange={handleComposerIntentChange}
                onToggleLeftSidebar={() => toggleSidebar('left')}
                onToggleRightSidebar={() => toggleSidebar('right')}
                onApprovePlan={handleApprovePlan}
                onRejectPlan={handleRejectPlan}
                onSend={handleSend}
                onStop={handleStop}
                onOpenChildSession={(sessionId) => { void openSession(sessionId); }}
                installedAssistants={installedAssistants}
                selectedAssistant={selectedAssistant}
                onSelectAssistant={handleSelectAssistant}
                onClearAssistant={handleClearAssistant}
                installedConnectors={installedConnectors.filter(connector => !apps.some(app => app.connectorApp?.id === connector.id))}
                selectedConnectorIds={selectedConnectorIds}
                onToggleConnector={installedConnectors.some(connector => !apps.some(app => app.connectorApp?.id === connector.id)) ? handleToggleConnector : undefined}
                onOpenConnectorHub={() => setActiveView('apps')}
                onOpenExpertHub={() => setActiveView('experts')}
                onOpenAgentManager={() => {
                  setSettingsInitialSection('agents');
                  setSettingsInitialAppId(null);
                  setActiveView('settings');
                }}
                onOpenSkillHub={() => setActiveView('skills')}
                remoteEnabled={desktopSettings?.remoteEnabled ?? false}
                newSessionMode={newSessionAgentMode}
                onNewSessionModeChange={handleNewSessionModeChange}
              />
            )
          ) : activeView === 'overview' ? (
            <OverviewView sessionSummaryEnabled={desktopSettings?.sessionMemory?.enabled === true} />
          ) : activeView === 'cron' ? (
            <CronView onOpenSession={handleSelectSession} remoteEnabled={desktopSettings?.remoteEnabled ?? false} />
          ) : activeView === 'mail' && agentMailEnabled ? (
            <AgentMailView
              enabled={agentMailEnabled}
              onOpenSettings={() => { setSettingsInitialAppId(null); setActiveView('settings'); }}
            />
          ) : activeView === 'skills' || activeView === 'experts' ? (
            <ResourceHubView
              activeTab={activeView}
              onChangeTab={setActiveView}
            />
          ) : activeView === 'projects' ? (
            <ProjectWorkspace
              projects={projects}
              activeProjectId={activeProjectId}
              refreshSignal={projectRefreshSignal}
              onActiveProjectChange={setActiveProjectId}
              onProjectsChange={refreshProjectWorkspace}
              onOpenSession={handleSelectSession}
            />
          ) : activeView === 'apps' || activeView === 'connectors' ? (
            <AppsPanel
              apps={apps}
              onUseApp={app => { if (navigateToHome({ resetInput: true })) setDraftAppIds([app.id || app.name]); }}
              versionsByApp={versionsByApp}
              initialExpandedApp={appManagementName}
              onLaunch={handleLaunchApp}
              onDelete={handleDeleteApp}
              onIterate={handleIterateExistingApp}
              onLoadVersions={loadAppVersions}
              onRollback={handleRollbackApp}
              onRefresh={refreshApps}
            />
          ) : (
            renderSettingsView()
          )}
        </div>

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
              style={{ width: layout.rightCollapsed ? 0 : layout.rightWidth, minWidth: layout.rightCollapsed ? 0 : RIGHT_WIDTH_RANGE.min }}
            >
              <TaskPanel
                browserTabId={presentation.snapshot?.resources.find(resource => resource.id === presentation.snapshot.state.activeId)?.source.tabId}
                onBrowserReady={() => { const request = presentation.snapshot?.request; if (request) void window.agentDesktop.presentation.acknowledge({ sessionId: activeSessionId, ...request, state: 'shown' }).catch(() => {}); }}
                navigation={<PresentationToolbar snapshot={presentation.snapshot} action={presentation.action}/>}
                showBrowser={presentation.snapshot?.state.activeId === 'browser' || presentation.snapshot?.resources.some(resource => resource.id === presentation.snapshot.state.activeId && resource.source.type === 'browser-tab' && resource.availability !== 'expired' && resource.availability !== 'unavailable')}
                content={presentation.snapshot && !['workspace', 'browser'].includes(presentation.snapshot.state.activeId) ? <PresentationContent snapshot={presentation.snapshot} action={presentation.action}/> : undefined}
                collapsed={layout.rightCollapsed}
                searchQuery={workspaceQuery}
                onSearchChange={setWorkspaceQuery}
                onRefresh={handleRefreshWorkspace}
                onOpenWorkspace={handleOpenWorkspace}
                treeItems={workspaceTree}
                expandedPaths={expandedDirs}
                selectedFilePath={selectedFilePath}
                onFocusFile={setSelectedFilePath}
                onToggleFolder={handleToggleFolder}
                onSelectFile={handleSelectFile}
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
                workspace={activeDetail?.workspace}
                workspaceRemote={activeDetail?.agentMode === 'remote-direct'}
                workspaceBusy={Boolean(activeDetail?.busy)}
                hasUnsavedEdits={Boolean(presentation.snapshot?.state.dirty) || previewTabs.some(tab => getPreviewTabMetadata(tab).dirty)}
                onVersionRestored={handleRefreshWorkspace}
              />
            </div>
          </>
        )}

        <AppWidgetHost apps={apps} enabled={desktopSettings?.appWidgets?.enabled !== false} />
        <GlobalSessionSearch
          open={globalSearchOpen}
          onClose={() => setGlobalSearchOpen(false)}
          onSelect={handleOpenSearchResult}
        />
        <UpdateModal />
      </div>
    </div>
    </ToolDisplaySettingsProvider>
    </UserAvatarContext.Provider>
    </AppComposerContext.Provider>
    </AppToolSelectionContext.Provider>
  );
}
