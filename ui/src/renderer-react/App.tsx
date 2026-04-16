import * as React from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { AppsPanel } from '@/components/apps-panel';
import { ChatArea } from '@/components/chat-area';
import { TaskPanel, type PreviewTabData } from '@/components/task-panel';
import { ExecutionPetPanel } from '@/components/execution-pet-panel';
import SnakeGame from '@/components/SnakeGame';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { buildChatMessages } from '@/lib/agent-transcript';
import type {
  AgentEvent,
  AppVersion,
  DesktopSettings,
  ExecutionSummary,
  FileTreeNode,
  SessionDetail,
  SessionSummary,
  StoredApp,
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
      rightWidth: clamp(Number(parsed.rightWidth) || DEFAULT_LAYOUT.rightWidth, RIGHT_WIDTH_RANGE.min, RIGHT_WIDTH_RANGE.max),
      leftCollapsed: Boolean(parsed.leftCollapsed),
      rightCollapsed: Boolean(parsed.rightCollapsed),
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function toSidebarSessions(summaries: SessionSummary[], pinnedIds: Set<string>) {
  return summaries.map((session) => ({
    ...session,
    preview: formatSidebarPreview(session.preview),
    time: formatRelativeTime(session.updatedAt),
    workspaceLabel: basename(session.workspace),
    isPinned: pinnedIds.has(session.id),
  }));
}

type ThemeMode = 'dark' | 'light';
type ComposerIntent = 'chat' | 'plan' | 'create-app' | 'iterate-app';
type LayoutState = {
  leftWidth: number;
  rightWidth: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
};

const LAYOUT_STORAGE_KEY = 'ui.panelLayout.v1';
const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 248,
  rightWidth: 280,
  leftCollapsed: false,
  rightCollapsed: false,
};
const LEFT_WIDTH_RANGE = { min: 210, max: 420 };
const RIGHT_WIDTH_RANGE = { min: 280, max: 560 };

function upsertSummary(list: SessionSummary[], summary: SessionSummary) {
  const next = list.some((entry) => entry.id === summary.id)
    ? list.map((entry) => (entry.id === summary.id ? summary : entry))
    : [summary, ...list];
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

function filterVisibleNodes(items: any[], query: string, cache: Map<string, any>, expandedDirs: Set<string>): FileTreeNode[] {
  const lower = query.trim().toLowerCase();
  return items
    .map((item) => {
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
  const [activeView, setActiveView] = React.useState<'chat' | 'apps' | 'settings' | 'snake'>('chat');
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem('ui.themeMode');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {}
    return 'dark';
  });
  const [sessionSearchQuery, setSessionSearchQuery] = React.useState('');
  const [layout, setLayout] = React.useState<LayoutState>(() => loadPanelLayout());
  const [summaries, setSummaries] = React.useState<SessionSummary[]>([]);
  const [apps, setApps] = React.useState<StoredApp[]>([]);
  const [versionsByApp, setVersionsByApp] = React.useState<Record<string, AppVersion[]>>({});
  const [selectedAppName, setSelectedAppName] = React.useState('');
  const [composerIntent, setComposerIntent] = React.useState<ComposerIntent>('chat');
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null);
  const [activeDetail, setActiveDetail] = React.useState<SessionDetail | null>(null);
  const [input, setInput] = React.useState('');
  const [pinnedIds, setPinnedIds] = React.useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('ui.pinnedSessions');
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  });
  const [workspaceQuery, setWorkspaceQuery] = React.useState('');
  const [expandedDirs, setExpandedDirs] = React.useState<Set<string>>(new Set());
  const [directoryCache, setDirectoryCache] = React.useState<Map<string, any>>(new Map());
  const [selectedFilePath, setSelectedFilePath] = React.useState<string | null>(null);
  const [previewTabs, setPreviewTabs] = React.useState<PreviewTabData[]>([]);
  const [activePreviewPath, setActivePreviewPath] = React.useState<string | null>(null);
  const [desktopSettings, setDesktopSettings] = React.useState<DesktopSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = React.useState<DesktopSettings | null>(null);
  const [settingsSaving, setSettingsSaving] = React.useState(false);
  const [settingsNotice, setSettingsNotice] = React.useState('');
  const [planDecisionBusy, setPlanDecisionBusy] = React.useState(false);
  const [executions, setExecutions] = React.useState<ExecutionSummary[]>([]);
  const workspaceRefreshTimerRef = React.useRef<number | null>(null);
  const layoutRef = React.useRef(layout);
  const activeSessionIdRef = React.useRef<string | null>(null);
  const activeDetailRef = React.useRef<SessionDetail | null>(null);
  const expandedDirsRef = React.useRef<Set<string>>(new Set());
  const previewTabsRef = React.useRef<PreviewTabData[]>([]);
  const openSessionRequestIdRef = React.useRef(0);

  const clearSessionWorkspaceState = React.useCallback(() => {
    setDirectoryCache(new Map());
    setExpandedDirs(new Set());
    setSelectedFilePath(null);
    setPreviewTabs([]);
    setActivePreviewPath(null);
    setWorkspaceQuery('');
  }, []);

  const persistPinned = React.useCallback((next: Set<string>) => {
    setPinnedIds(next);
    localStorage.setItem('ui.pinnedSessions', JSON.stringify(Array.from(next)));
  }, []);

  const refreshSummaries = React.useCallback(async () => {
    const list = await window.agentDesktop.listSessions();
    setSummaries(list);
    return list;
  }, []);

  const refreshApps = React.useCallback(async () => {
    const nextApps = await window.agentDesktop.listApps();
    setApps(nextApps);
    return nextApps;
  }, []);

  const loadAppVersions = React.useCallback(async (name: string) => {
    const versions = await window.agentDesktop.listAppVersions({ name });
    setVersionsByApp((prev) => ({ ...prev, [name]: versions }));
    return versions;
  }, []);

  const applyDesktopSettings = React.useCallback((next: DesktopSettings) => {
    setDesktopSettings(next);
    setSettingsDraft(next);
  }, []);

  const navigateToHome = React.useCallback((options?: { resetInput?: boolean; resetApp?: boolean; preserveIntent?: boolean }) => {
    setActiveView('chat');
    setActiveSessionId(null);
    setActiveDetail(null);
    clearSessionWorkspaceState();
    if (!options?.preserveIntent) {
      setComposerIntent('chat');
    }
    if (options?.resetInput) {
      setInput('');
    }
    if (options?.resetApp) {
      setSelectedAppName('');
    }
  }, [clearSessionWorkspaceState]);

  const openSession = React.useCallback(async (sessionId: string) => {
    const requestId = ++openSessionRequestIdRef.current;
    const detail = await window.agentDesktop.getSession({ sessionId });
    if (requestId !== openSessionRequestIdRef.current) {
      return;
    }
    setActiveView('chat');
    setActiveSessionId(sessionId);
    setActiveDetail(detail);
    clearSessionWorkspaceState();
  }, [clearSessionWorkspaceState]);

  const createAndOpenSession = React.useCallback(async () => {
    const created = await window.agentDesktop.createSession({});
    setSummaries((prev) => upsertSummary(prev, created.summary));
    await openSession(created.summary.id);
    return created.summary.id;
  }, [openSession]);

  const ensureRootDirectory = React.useCallback(async (sessionId: string, workspace: string) => {
    const data = await window.agentDesktop.listWorkspaceDir({ sessionId, dirPath: workspace });
    setDirectoryCache(new Map([[workspace, data]]));
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
    expandedDirsRef.current = expandedDirs;
  }, [expandedDirs]);

  React.useEffect(() => {
    previewTabsRef.current = previewTabs;
  }, [previewTabs]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', themeMode === 'dark');
    root.style.colorScheme = themeMode;
    localStorage.setItem('ui.themeMode', themeMode);
  }, [themeMode]);

  React.useEffect(() => {
    return () => {
      document.body.classList.remove('layout-resizing');
    };
  }, []);

  React.useEffect(() => {
    if (selectedAppName && !apps.some((entry) => entry.name === selectedAppName)) {
      setSelectedAppName('');
    }
  }, [apps, selectedAppName]);

  // Poll for active sub-agent executions (pets)
  React.useEffect(() => {
    if (!activeSessionId) {
      setExecutions([]);
      return;
    }
    let mounted = true;
    const loadExecutions = async () => {
      try {
        const result = await window.agentDesktop.listExecutions(activeSessionId);
        if (mounted && result?.executions) {
          setExecutions(result.executions);
        }
      } catch {
        // ignore
      }
    };
    loadExecutions();
    const timer = window.setInterval(loadExecutions, 3000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [activeSessionId]);

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

    const pathsToRefresh = [detail.workspace, ...Array.from(expandedDirsRef.current)];
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
        try {
          return await window.agentDesktop.readWorkspaceFile({
            sessionId,
            filePath: tab.path,
          });
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
        const nextSettings = await window.agentDesktop.getSettings();
        if (!status.cliReady) {
          setBootError('缺少 cli-node.js。先在仓库根目录执行 bun run build:node。');
        }
        applyDesktopSettings(nextSettings);
        await refreshApps();
        await refreshSummaries();
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
  }, [applyDesktopSettings, openSession, refreshApps, refreshSummaries]);

  React.useEffect(() => {

    const offEvent = window.agentDesktop.onEvent((payload) => {
      if (payload.sessionId !== activeSessionIdRef.current) return;
      setActiveDetail((prev) => {
        if (!prev) return prev;
        return { ...prev, history: [...prev.history, payload.payload] };
      });
    });

    const offState = window.agentDesktop.onState((payload) => {
      if (payload?.summary) {
        setSummaries((prev) => upsertSummary(prev, payload.summary));
        if (payload.summary.id === activeSessionIdRef.current) {
          setActiveDetail((prev) => (prev ? { ...prev, ...payload.summary } : prev));
        }
      }
    });

    const offPermission = window.agentDesktop.onPermission((payload) => {
      if (payload?.sessionId !== activeSessionIdRef.current) return;
      const toolName = payload?.request?.tool_name || 'Tool';
      setPermissionNotice(`${toolName} 正在请求权限确认`);
      window.setTimeout(() => {
        setPermissionNotice((current) =>
          current === `${toolName} 正在请求权限确认` ? '' : current
        );
      }, 4000);
    });

    const offMeta = window.agentDesktop.onSessionMeta((summary) => {
      setSummaries((prev) => upsertSummary(prev, summary));
      if (summary.id === activeSessionIdRef.current) {
        setActiveDetail((prev) => (prev ? { ...prev, ...summary } : prev));
      }
    });

    const offRemoved = window.agentDesktop.onSessionRemoved(({ sessionId }) => {
      setSummaries((prev) => prev.filter((entry) => entry.id !== sessionId));
      if (sessionId === activeSessionIdRef.current) {
        navigateToHome();
      }
    });

    const offAppsChanged = window.agentDesktop.onAppsChanged(() => {
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

    return () => {
      if (workspaceRefreshTimerRef.current) {
        window.clearTimeout(workspaceRefreshTimerRef.current);
        workspaceRefreshTimerRef.current = null;
      }
      offEvent();
      offState();
      offPermission();
      offMeta();
      offRemoved();
      offAppsChanged();
      offWorkspaceChanged();
      offSettingsChanged();
    };
  }, [applyDesktopSettings, navigateToHome, refreshApps, refreshWorkspaceSnapshot]);

  const sidebarSessions = React.useMemo(
    () => toSidebarSessions(summaries, pinnedIds),
    [summaries, pinnedIds]
  );

  const chatMessages = React.useMemo(
    () => buildChatMessages(activeDetail?.history || []),
    [activeDetail?.history]
  );

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

  const toggleSidebar = React.useCallback((side: 'left' | 'right') => {
    setLayout((prev) => (
      side === 'left'
        ? { ...prev, leftCollapsed: !prev.leftCollapsed }
        : { ...prev, rightCollapsed: !prev.rightCollapsed }
    ));
  }, []);

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
    navigateToHome({ resetInput: true, resetApp: true });
  }, [navigateToHome]);

  const handleSelectSession = React.useCallback(async (sessionId: string) => {
    await openSession(sessionId);
    setActiveView('chat');
  }, [openSession]);

  const handleDeleteSession = React.useCallback(async (sessionId: string) => {
    await window.agentDesktop.deleteSession({ sessionId });
    if (activeSessionId === sessionId) {
      navigateToHome();
    }
    await refreshSummaries();
  }, [activeSessionId, navigateToHome, refreshSummaries]);

  const handleRenameSession = React.useCallback(async (sessionId: string, newTitle: string) => {
    if (!newTitle.trim()) return;
    try {
      await window.agentDesktop.updateSession({ sessionId, title: newTitle });
    } catch (e) {
      console.error('Rename failed:', e);
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

  const submitPrompt = React.useCallback(async (intent: ComposerIntent, files?: Array<{ name: string; path: string }>) => {
    const hasText = input.trim().length > 0;
    const hasFiles = files && files.length > 0;
    if (!hasText && !hasFiles) return;
    if (activeDetail?.busy || planDecisionBusy) return;
    if (intent === 'iterate-app' && !selectedAppName) return;

    const prompt = input.trim();
    setInput('');

    let sessionId = activeSessionId;
    let sessionJustCreated = false;
    if (!sessionId) {
      sessionId = await createAndOpenSession();
      sessionJustCreated = true;
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

    const result = await window.agentDesktop.send({
      sessionId,
      prompt,
      mode: intent === 'chat' ? undefined : intent,
      appName: intent === 'iterate-app' ? selectedAppName : undefined,
      files: filesToSend?.map(f => f.path),
    });
    const detail = await window.agentDesktop.getSession({ sessionId });
    setActiveDetail(detail);
    setSummaries((prev) => upsertSummary(prev, detail));

    if (intent === 'create-app' || intent === 'iterate-app') {
      await refreshApps();
      const changedApp = result?.createdApp || result?.updatedApp;
      if (changedApp?.name) {
        setSelectedAppName(changedApp.name);
        setComposerIntent('iterate-app');
        await loadAppVersions(changedApp.name);
      }
    }
  }, [activeDetail?.busy, activeSessionId, createAndOpenSession, input, loadAppVersions, planDecisionBusy, refreshApps, selectedAppName]);

  const handleSend = React.useCallback(async (files?: Array<{ name: string; path: string }>) => {
    await submitPrompt(composerIntent, files);
  }, [composerIntent, submitPrompt]);

  const handleApprovePlan = React.useCallback(async () => {
    if (!activeSessionId) return;
    setPlanDecisionBusy(true);
    try {
      const result = await window.agentDesktop.approvePlan({ sessionId: activeSessionId });
      const detail = await window.agentDesktop.getSession({ sessionId: activeSessionId });
      setActiveDetail(detail);
      setSummaries((prev) => upsertSummary(prev, detail));

      const changedApp = result?.createdApp;
      if (changedApp?.name) {
        await refreshApps();
        setSelectedAppName(changedApp.name);
        setComposerIntent('iterate-app');
        await loadAppVersions(changedApp.name);
      }
    } finally {
      setPlanDecisionBusy(false);
    }
  }, [activeSessionId, loadAppVersions, refreshApps]);

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

  const handleStop = React.useCallback(async () => {
    if (!activeSessionId) return;
    await window.agentDesktop.abort({ sessionId: activeSessionId });
  }, [activeSessionId]);

  const handlePickWorkspace = React.useCallback(async () => {
    if (!activeSessionId) return;
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
  }, [activeSessionId]);

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
    const data = await window.agentDesktop.listWorkspaceDir({
      sessionId: activeSessionId,
      dirPath: path,
    });
    setDirectoryCache((prev) => new Map(prev).set(path, data));
  }, [activeSessionId, expandedDirs]);

  const handleSelectFile = React.useCallback(async (path: string) => {
    if (!activeSessionId) return;
    const data = await window.agentDesktop.readWorkspaceFile({
      sessionId: activeSessionId,
      filePath: path,
    });
    setSelectedFilePath(path);
    setPreviewTabs((prev) => {
      const existing = prev.find((entry) => entry.path === data.path);
      if (existing) {
        return prev.map((entry) => (entry.path === data.path ? data : entry));
      }
      return [...prev, data];
    });
    setActivePreviewPath(data.path);
  }, [activeSessionId]);

  const handleLaunchApp = React.useCallback(async (name: string) => {
    await window.agentDesktop.launchApp({ name });
  }, []);

  const handleIterateExistingApp = React.useCallback(async (name: string) => {
    setSelectedAppName(name);
    setActiveView('chat');
    if (!activeSessionId) {
      navigateToHome({ preserveIntent: true });
    }
    setComposerIntent('iterate-app');
  }, [activeSessionId, navigateToHome]);

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
      setComposerIntent('iterate-app');
    }
    await refreshApps();
    await loadAppVersions(name);
  }, [loadAppVersions, refreshApps]);

  const handleSaveSettings = React.useCallback(async () => {
    if (!settingsDraft || !desktopSettings) return;
    setSettingsSaving(true);
    try {
      const payload: Partial<DesktopSettings> = {};

      // 仅当值发生变化且不为空时，才加入更新负载
      if (settingsDraft.bypassPermissions !== desktopSettings.bypassPermissions) {
        payload.bypassPermissions = settingsDraft.bypassPermissions;
      }
      if (settingsDraft.model && settingsDraft.model !== desktopSettings.model) {
        payload.model = settingsDraft.model;
      }
      if (settingsDraft.maxTurns !== desktopSettings.maxTurns) {
        payload.maxTurns = settingsDraft.maxTurns;
      }
      if (settingsDraft.appendSystemPrompt !== desktopSettings.appendSystemPrompt) {
        payload.appendSystemPrompt = settingsDraft.appendSystemPrompt;
      }
      if (settingsDraft.thinkingMode !== desktopSettings.thinkingMode) {
        payload.thinkingMode = settingsDraft.thinkingMode;
      }
      if (settingsDraft.thinkingBudgetTokens !== desktopSettings.thinkingBudgetTokens) {
        payload.thinkingBudgetTokens = settingsDraft.thinkingBudgetTokens;
      }

      if (Object.keys(payload).length === 0) {
        setSettingsNotice('配置未发生变化');
        return;
      }

      const saved = await window.agentDesktop.updateSettings(payload);
      applyDesktopSettings(saved);
      const suffix = saved.skippedSessionCount
        ? `；${saved.skippedSessionCount} 个已有会话已建立运行时，新配置主要对新会话生效`
        : '';
      setSettingsNotice(`已保存到 ${saved.settingsPath}${suffix}`);
    } catch (error: any) {
      setSettingsNotice(error?.message || String(error));
    } finally {
      setSettingsSaving(false);
    }
  }, [applyDesktopSettings, desktopSettings, settingsDraft]);

  const renderSettingsView = () => (
    <div className="h-full overflow-auto bg-background px-8 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-[28px] border border-border/80 bg-card/80 p-8 shadow-[0_24px_80px_-36px_rgba(0,0,0,0.45)]">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">桌面端设置</h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                这里配置嵌入式 Claude agent 的默认运行参数。当前支持的项目来自本地嵌入层实际支持的 Claude CLI 会话参数。
              </p>
            </div>
            <Button onClick={handleSaveSettings} disabled={!settingsDraft || settingsSaving}>
              {settingsSaving ? '保存中...' : '保存设置'}
            </Button>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">权限模式</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                打开后，工具调用不再弹确认框，直接使用 allow-all / bypass 模式。
              </p>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-border bg-background text-primary"
                  checked={Boolean(settingsDraft?.bypassPermissions)}
                  onChange={(event) => {
                    if (!settingsDraft) return;
                    setSettingsDraft({
                      ...settingsDraft,
                      bypassPermissions: event.target.checked,
                    });
                  }}
                />
                <div>
                  <p className="text-sm font-medium text-foreground">跳过所有权限确认</p>
                  <p className="mt-1 text-xs leading-6 text-muted-foreground">
                    适合你完全信任当前工作区和工具执行结果的场景。
                  </p>
                </div>
              </label>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">默认模型</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                对应 CLI 里的 `model`，会作为新会话的默认主模型。
              </p>
              <Input
                className="mt-4 bg-background text-foreground"
                value={settingsDraft?.model || ''}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  setSettingsDraft({
                    ...settingsDraft,
                    model: event.target.value,
                  });
                }}
                placeholder="claude-sonnet-4-6"
              />
              <p className="mt-4 text-sm font-medium text-foreground">图片模型</p>
              <Input
                className="mt-2 bg-background text-foreground"
                value={settingsDraft?.visionModel || ''}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  setSettingsDraft({
                    ...settingsDraft,
                    visionModel: event.target.value,
                  });
                }}
              />
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">最大轮次</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                对应 CLI 里的 `maxTurns`，限制单次会话的最大 agent turn 数。
              </p>
              <Input
                type="number"
                min={1}
                max={10000}
                className="mt-4 bg-background text-foreground"
                value={settingsDraft?.maxTurns ?? 100}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  setSettingsDraft({
                    ...settingsDraft,
                    maxTurns: Number.parseInt(event.target.value || '1', 10),
                  });
                }}
              />
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">思考模式</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                对应 CLI 的 thinking 能力。`adaptive` 让模型自行决定，`enabled` 使用固定预算，`disabled` 关闭扩展思考。
              </p>
              <select
                className="mt-4 h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none"
                value={settingsDraft?.thinkingMode || 'disabled'}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  setSettingsDraft({
                    ...settingsDraft,
                    thinkingMode: event.target.value as DesktopSettings['thinkingMode'],
                  });
                }}
              >
                <option value="disabled">disabled (关闭)</option>
                <option value="adaptive">adaptive (自动)</option>
                <option value="enabled">enabled (强制开启)</option>
                <option value="">default (保持手动配置)</option>
              </select>
              {settingsDraft?.thinkingMode === 'enabled' && (
                <Input
                  type="number"
                  min={1024}
                  max={128000}
                  className="mt-3 bg-background text-foreground"
                  value={settingsDraft?.thinkingBudgetTokens ?? 16000}
                  onChange={(event) => {
                    if (!settingsDraft) return;
                    setSettingsDraft({
                      ...settingsDraft,
                      thinkingBudgetTokens: Number.parseInt(event.target.value || '1024', 10),
                    });
                  }}
                  placeholder="thinking budget tokens"
                />
              )}
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">API URL</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                自定义 API 端点地址，留空则使用默认地址。
              </p>
              <Input
                className="mt-4 bg-background text-foreground"
                value={settingsDraft?.url || ''}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  setSettingsDraft({
                    ...settingsDraft,
                    url: event.target.value,
                  });
                }}
                placeholder="https://api.anthropic.com"
              />
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">API Key</p>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                自定义 API Key，留空则使用环境变量中的密钥。
              </p>
              <div className="mt-4 flex gap-2">
                <Input
                  className="bg-background text-foreground font-mono text-xs"
                  value={settingsDraft?.apiKey || ''}
                  onChange={(event) => {
                    if (!settingsDraft) return;
                    setSettingsDraft({
                      ...settingsDraft,
                      apiKey: event.target.value,
                    });
                  }}
                  placeholder="sk-ant-..."
                />
                {settingsDraft?.apiKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(settingsDraft.apiKey || '');
                    }}
                  >
                    复制
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-border/70 bg-background/60 p-5">
            <p className="text-sm font-medium text-foreground">追加系统提示</p>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              对应 CLI 里的 `appendSystemPrompt`。会追加到默认系统提示后面，适合放全局开发约束或回复风格。
            </p>
            <Textarea
              className="mt-4 min-h-[180px] bg-background text-foreground"
              value={settingsDraft?.appendSystemPrompt || ''}
              onChange={(event) => {
                if (!settingsDraft) return;
                setSettingsDraft({
                  ...settingsDraft,
                  appendSystemPrompt: event.target.value,
                });
              }}
              placeholder="例如：默认使用中文回复；修改代码前先解释关键影响；避免自动删除用户未要求的文件。"
            />
          </div>

          <div className="mt-6 rounded-2xl border border-border/70 bg-background/60 p-5 text-sm leading-7">
            <p className="font-medium text-foreground">当前存储</p>
            <p className="mt-2 text-muted-foreground">
              配置文件：{desktopSettings?.settingsPath || '加载中'}
            </p>
            <p className="text-muted-foreground">
              API URL：{desktopSettings?.url || '（未设置）'}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">API Key：</span>
              {desktopSettings?.apiKey ? (
                <>
                  <code className="text-xs text-muted-foreground">{'********' + desktopSettings.apiKey.slice(-4)}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1 text-xs"
                    onClick={() => navigator.clipboard.writeText(desktopSettings.apiKey || '')}
                  >
                    复制
                  </Button>
                </>
              ) : (
                <span className="text-muted-foreground">（未设置）</span>
              )}
            </div>
            {desktopSettings?.settingsParseError && (
              <p className="mt-2 text-destructive">
                解析设置文件失败：{desktopSettings.settingsParseError}
              </p>
            )}
            {settingsNotice && (
              <p className="mt-2 text-muted-foreground">{settingsNotice}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`${themeMode === 'dark' ? 'dark' : ''} flex h-screen w-full flex-col overflow-hidden app-shell`}>
      <div className="moss-window-chrome shrink-0">
        <div
          className="moss-window-drag h-9"
          style={{ paddingLeft: isMacOS ? 84 : 0 }}
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="min-h-0 shrink-0 overflow-hidden"
          style={{ width: layout.leftCollapsed ? 68 : layout.leftWidth }}
        >
          <AppSidebar
            sessions={sidebarSessions}
            activeSessionId={activeSessionId}
            activeView={activeView}
            appsCount={apps.length}
            themeMode={themeMode}
            collapsed={layout.leftCollapsed}
            searchQuery={sessionSearchQuery}
            onChangeView={setActiveView}
            onChangeTheme={setThemeMode}
            onSelectSession={handleSelectSession}
            onNewSession={handleNewSession}
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

        <div className="relative min-h-0 flex-1 overflow-hidden">
          {(bootError || permissionNotice) && (
            <div className="pointer-events-none absolute right-4 top-4 z-20 max-w-md rounded-2xl border border-border/80 bg-card/92 px-3 py-2 text-xs text-muted-foreground shadow-[0_18px_48px_-36px_rgba(0,0,0,0.6)] backdrop-blur">
              {bootError || permissionNotice}
            </div>
          )}
          {activeView === 'chat' ? (
            activeSessionId ? (
              <ChatArea
                messages={chatMessages}
                value={input}
                selectedAppName={selectedAppName}
                loading={Boolean(activeDetail?.busy)}
                hasActiveSession={Boolean(activeSessionId)}
                sessionTitle={activeDetail?.title || 'New Session'}
                sessionMessageCount={activeDetail?.messageCount || 0}
                sessionId={activeSessionId || undefined}
                pendingPlanApproval={activeDetail?.pendingPlanApproval || null}
                planDecisionBusy={planDecisionBusy}
                leftCollapsed={layout.leftCollapsed}
                rightCollapsed={layout.rightCollapsed}
                composerIntent={composerIntent}
                onChange={setInput}
                onComposerIntentChange={setComposerIntent}
                onToggleLeftSidebar={() => toggleSidebar('left')}
                onToggleRightSidebar={() => toggleSidebar('right')}
                onApprovePlan={handleApprovePlan}
                onRejectPlan={handleRejectPlan}
                onSend={handleSend}
                onStop={handleStop}
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
                pendingPlanApproval={null}
                planDecisionBusy={false}
                leftCollapsed={layout.leftCollapsed}
                rightCollapsed={layout.rightCollapsed}
                composerIntent={composerIntent}
                onChange={setInput}
                onComposerIntentChange={setComposerIntent}
                onToggleLeftSidebar={() => toggleSidebar('left')}
                onToggleRightSidebar={() => toggleSidebar('right')}
                onApprovePlan={handleApprovePlan}
                onRejectPlan={handleRejectPlan}
                onSend={handleSend}
                onStop={handleStop}
              />
            )
          ) : activeView === 'apps' ? (
            <AppsPanel
              apps={apps}
              versionsByApp={versionsByApp}
              onLaunch={handleLaunchApp}
              onDelete={handleDeleteApp}
              onIterate={handleIterateExistingApp}
              onLoadVersions={loadAppVersions}
              onRollback={handleRollbackApp}
            />
          ) : activeView === 'snake' ? (
            <SnakeGame />
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
              style={{ width: layout.rightCollapsed ? 68 : layout.rightWidth }}
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
                previewContent={activePreview?.content || '点击文件后在这里预览内容。'}
                previewTitle={activePreview?.relativePath || '未选择文件'}
              />
            </div>
          </>
        )}

        <ExecutionPetPanel
          executions={executions}
          onFocus={(executionId) => {
            void window.agentDesktop.focusExecution(executionId);
          }}
        />
      </div>
    </div>
  );
}
