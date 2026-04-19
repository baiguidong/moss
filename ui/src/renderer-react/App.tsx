import * as React from 'react';
import { Monitor, MoonStar, SunMedium } from 'lucide-react';
import { AppSidebar } from '@/components/app-sidebar';
import { AppsPanel } from '@/components/apps-panel';
import { ChatArea } from '@/components/chat-area';
import { TaskPanel, type PreviewTabData } from '@/components/task-panel';
import { ExecutionPetPanel } from '@/components/execution-pet-panel';
import { BuddyCompanion, BuddySummary, isBuddyEnabled, setBuddyEnabled } from '@/components/buddy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  collectAgentTranscriptDebugInfo,
  buildMainChatMessagesFromHistory,
  buildWorkerMessagesFromSubagentEvents,
  type ChatMessage,
  type WorkerThread,
  type WorkerThreadStatus,
} from '@/lib/agent-transcript';
import { PRESET_THEMES, DEFAULT_THEME_ID, type ICssTheme } from '@/theme/presets';
import { applyCssTheme, getStoredThemeId, setStoredThemeId } from '@/theme/cssTheme';
import type {
  AgentEvent,
  AppVersion,
  CoordinatorTask,
  DesktopSettings,
  ExecutionSummary,
  FileTreeNode,
  SessionDetail,
  SessionSummary,
  StoredApp,
  WorkerSubagentResult,
} from './types';

type RendererDebugEntry = {
  source: 'renderer';
  label: string;
  timestamp: string;
  payload: Record<string, any>;
};

type RendererDebugSink = ((entry: RendererDebugEntry) => void) | null;

let rendererDebugSink: RendererDebugSink = null;

function setRendererDebugSink(sink: RendererDebugSink) {
  rendererDebugSink = sink;
}

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

type ThemeMode = 'dark' | 'light' | 'system';
type ComposerIntent = 'chat' | 'plan' | 'create-app' | 'iterate-app' | 'coordinator';
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

function summarizeRendererEvent(payload: any) {
  const event = payload?.payload ?? payload;
  if (!event || typeof event !== 'object') {
    return { type: typeof event, detail: String(event) };
  }

  const summary: Record<string, any> = {
    type: event.type || 'unknown',
  };

  if (typeof event.subtype === 'string') {
    summary.subtype = event.subtype;
  }

  if (typeof event.session_id === 'string') {
    summary.runtimeSessionId = event.session_id;
  }

  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    summary.blockTypes = event.message.content.map((block: any) => block?.type).filter(Boolean);
    summary.toolUses = event.message.content
      .filter((block: any) => block?.type === 'tool_use')
      .map((block: any) => ({ id: block.id, name: block.name }));
  } else if (event.type === 'user') {
    if (typeof event.prompt === 'string') {
      summary.promptPreview = event.prompt.slice(0, 120);
    }
    if (Array.isArray(event.message?.content)) {
      summary.blockTypes = event.message.content.map((block: any) => block?.type).filter(Boolean);
      const text = event.message.content
        .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
        .map((block: any) => block.text)
        .join('\n\n');
      if (text) {
        summary.textPreview = text.slice(0, 160);
      }
      summary.toolResults = event.message.content
        .filter((block: any) => block?.type === 'tool_result')
        .map((block: any) => ({ toolUseId: block.tool_use_id, isError: Boolean(block.is_error) }));
    }
  } else if (event.type === 'stream_event') {
    summary.streamType = event.event?.type;
    summary.blockType = event.event?.content_block?.type;
    summary.deltaType = event.event?.delta?.type;
  } else if (event.type === 'tool_progress') {
    summary.toolName = event.tool_name;
    summary.toolUseId = event.tool_use_id || event.parent_tool_use_id;
  } else if (event.type === 'error') {
    summary.message = String(event.message || '').slice(0, 200);
  }

  return summary;
}

function traceRendererEvent(label: string, payload: any, extra: Record<string, any> = {}) {
  const entryPayload = {
    ...extra,
    summary: summarizeRendererEvent(payload),
    payload,
  };
  console.log(`[event-trace][renderer] ${label}`, entryPayload);
  rendererDebugSink?.({
    source: 'renderer',
    label: `[event-trace][renderer] ${label}`,
    timestamp: new Date().toISOString(),
    payload: entryPayload,
  });
}

function logCoordinatorDebug(label: string, payload: Record<string, any>) {
  console.log(label, payload);
  rendererDebugSink?.({
    source: 'renderer',
    label,
    timestamp: new Date().toISOString(),
    payload,
  });
}

function serializeDebugEntry(entry: RendererDebugEntry): string {
  try {
    return JSON.stringify(entry);
  } catch (error) {
    return JSON.stringify({
      source: entry.source,
      label: entry.label,
      timestamp: entry.timestamp,
      payload: {
        error: `Failed to serialize debug payload: ${String(error)}`,
      },
    });
  }
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
  const [activeView, setActiveView] = React.useState<'chat' | 'apps' | 'settings'>('chat');
  const getSystemTheme = (): 'dark' | 'light' => {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  const resolveTheme = (pref: ThemeMode): 'dark' | 'light' => {
    return pref === 'system' ? getSystemTheme() : pref;
  };

  const [themeMode, setThemeMode] = React.useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem('ui.themeMode');
      if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
    } catch {}
    return 'light';
  });
  const [cssThemeId, setCssThemeId] = React.useState<string>(() => {
    return getStoredThemeId() || 'grid-theme';
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
  const [settingsNotice, setSettingsNotice] = React.useState('');
  const [planDecisionBusy, setPlanDecisionBusy] = React.useState(false);
  const [executions, setExecutions] = React.useState<ExecutionSummary[]>([]);
  const [coordinatorTasks, setCoordinatorTasks] = React.useState<CoordinatorTask[]>([]);
  const [activeWorkerThreadId, setActiveWorkerThreadId] = React.useState<string | null>(null);
  const [stickyWorkerTaskStatuses, setStickyWorkerTaskStatuses] = React.useState<Record<string, 'completed' | 'failed'>>({});
  const [workerSubagentResults, setWorkerSubagentResults] = React.useState<Record<string, WorkerSubagentResult>>({});
  // Workers from previous coordinator runs in the same session (persisted across switches).
  const [archivedWorkerThreads, setArchivedWorkerThreads] = React.useState<WorkerThread[]>([]);
  const archivedWorkerThreadsRef = React.useRef<WorkerThread[]>([]);
  const [forceBuddyUpdate, setForceBuddyUpdate] = React.useState(0);
  const workspaceRefreshTimerRef = React.useRef<number | null>(null);
  const debugLogFilePathRef = React.useRef<string | null>(null);
  const debugLogLinesRef = React.useRef<string[]>([]);
  const debugLogFlushTimerRef = React.useRef<number | null>(null);
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

  const createAndOpenSession = React.useCallback(async (title?: string, workspace?: string) => {
    const created = await window.agentDesktop.createSession(workspace ? { title, workspace } : title ? { title } : {});
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
    const resolved = resolveTheme(themeMode);
    root.setAttribute('data-theme', resolved);
    root.style.colorScheme = resolved;
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
    setArchivedWorkerThreads([]);
    archivedWorkerThreadsRef.current = [];
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
      const archived = archivedWorkerThreadsRef.current;
      const sid = activeSessionIdRef.current;
      if ((threads.length > 0 || archived.length > 0) && sid) {
        // Persist worker metadata (messages excluded — they live in .jsonl files).
        const data = {
          current: threads.map((t) => ({ ...t, messages: [] as ChatMessage[] })),
          archived: archived.map((t) => ({ ...t, messages: [] as ChatMessage[] })),
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
    setArchivedWorkerThreads((prev) => {
      const next = [...toArchive, ...prev];
      archivedWorkerThreadsRef.current = next;
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
      let archived: WorkerThread[] = [];
      if (Array.isArray(saved)) {
        current = saved;
      } else if (saved && typeof saved === 'object') {
        if (Array.isArray(saved.current)) current = saved.current;
        if (Array.isArray(saved.archived)) archived = saved.archived;
      }
      if (current.length === 0 && archived.length === 0) return;
      frozenWorkerThreadsRef.current = current;
      setArchivedWorkerThreads(archived);
      archivedWorkerThreadsRef.current = archived;
      // Re-fetch event streams to populate message history — also triggers a re-render
      // so resolvedWorkerThreads picks up the restored frozenWorkerThreadsRef.
      void window.agentDesktop.getWorkerResults({ sessionId: activeSessionId })
        .then((res) => {
          if (activeSessionIdRef.current !== activeSessionId) return;
          setWorkerSubagentResults(res?.results ?? {});
        });
    } catch {}
  }, [activeSessionId, activeDetail?.workerSummariesJson]);

  const flushDebugLogToFile = React.useCallback(async () => {
    const filePath = debugLogFilePathRef.current;
    if (!filePath) return;
    const text = debugLogLinesRef.current.join('\n');
    const bytes = Array.from(new TextEncoder().encode(text ? `${text}\n` : ''));
    await window.agentDesktop.fs.writeFile(filePath, bytes);
  }, []);

  const enqueueDebugLogLine = React.useCallback((entry: RendererDebugEntry) => {
    const serialized = serializeDebugEntry(entry);
    debugLogLinesRef.current.push(serialized);

    if (debugLogFlushTimerRef.current !== null) return;
    debugLogFlushTimerRef.current = window.setTimeout(() => {
      debugLogFlushTimerRef.current = null;
      void flushDebugLogToFile();
    }, 250);
  }, [flushDebugLogToFile]);

  React.useEffect(() => {
    setRendererDebugSink((entry) => {
      enqueueDebugLogLine(entry);
    });
    return () => {
      setRendererDebugSink(null);
    };
  }, [enqueueDebugLogLine]);

  React.useEffect(() => {
    const workspace = activeDetail?.workspace;
    if (!workspace) {
      debugLogFilePathRef.current = null;
      return;
    }

    const nextPath = `${workspace.replace(/[\\/]+$/, '')}/coordinator-ui-debug.log`;
    if (debugLogFilePathRef.current === nextPath) return;

    debugLogFilePathRef.current = nextPath;
    debugLogLinesRef.current = [];
    enqueueDebugLogLine({
      source: 'renderer',
      label: '[coordinator-debug] log-file-initialized',
      timestamp: new Date().toISOString(),
      payload: {
        sessionId: activeSessionId,
        workspace,
        filePath: nextPath,
      },
    });
    void flushDebugLogToFile();
  }, [activeDetail?.workspace, activeSessionId, enqueueDebugLogLine, flushDebugLogToFile]);

  React.useEffect(() => {
    return () => {
      if (debugLogFlushTimerRef.current !== null) {
        window.clearTimeout(debugLogFlushTimerRef.current);
        debugLogFlushTimerRef.current = null;
      }
      void flushDebugLogToFile();
    };
  }, [flushDebugLogToFile]);

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
      traceRendererEvent('agent:event', payload, {
        activeSessionId: activeSessionIdRef.current,
      });
      setActiveDetail((prev) => {
        if (!prev) return prev;
        return { ...prev, history: [...prev.history, payload.payload] };
      });
    });

    const offState = window.agentDesktop.onState((payload) => {
      traceRendererEvent('agent:state', payload, {
        activeSessionId: activeSessionIdRef.current,
      });
      if (payload?.summary) {
        setSummaries((prev) => upsertSummary(prev, payload.summary));
        if (payload.summary.id === activeSessionIdRef.current) {
          setActiveDetail((prev) => (prev ? { ...prev, ...payload.summary } : prev));
        }
      }
    });

    const offPermission = window.agentDesktop.onPermission((payload) => {
      if (payload?.sessionId !== activeSessionIdRef.current) return;
      traceRendererEvent('agent:permission', payload, {
        activeSessionId: activeSessionIdRef.current,
      });
      const toolName = payload?.request?.tool_name || 'Tool';
      setPermissionNotice(`${toolName} 正在请求权限确认`);
      window.setTimeout(() => {
        setPermissionNotice((current) =>
          current === `${toolName} 正在请求权限确认` ? '' : current
        );
      }, 4000);
    });

    const offMeta = window.agentDesktop.onSessionMeta((summary) => {
      traceRendererEvent('agent:session-meta', summary, {
        activeSessionId: activeSessionIdRef.current,
      });
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

    // Listen for teammate spawn events to auto-create execution windows
    const offTeammateSpawned = window.agentDesktop.onTeammateSpawned(async (payload) => {
      const { sessionId, taskId, description, prompt } = payload;
      if (sessionId !== activeSessionIdRef.current) return;
      traceRendererEvent('coordinator:teammate-spawned', payload, {
        activeSessionId: activeSessionIdRef.current,
        taskId,
      });
      // Create execution window for this teammate
      try {
        await window.agentDesktop.createExecutionForTeammate({
          sessionId,
          taskId,
          description,
          prompt,
        });
        // Refresh executions list
        const executions = await window.agentDesktop.listExecutions(sessionId);
        if (executions?.executions) {
          setExecutions(executions.executions);
        }
      } catch (err) {
        console.error('[App] Failed to create execution window for teammate:', err);
      }
    });

    // Listen for teammate completion events
    const offTeammateCompleted = window.agentDesktop.onTeammateCompleted(async (payload) => {
      const { sessionId, taskId, description, status } = payload;
      if (sessionId !== activeSessionIdRef.current) return;
      traceRendererEvent('coordinator:teammate-completed', payload, {
        activeSessionId: activeSessionIdRef.current,
        taskId,
        status,
      });

      // Update the execution window state via IPC
      try {
        await window.agentDesktop.updateTeammateState({ taskId, sessionId, completed: true });
      } catch (err) {
        console.error('[App] Failed to update teammate state:', err);
      }

      // Refresh executions list
      const executions = await window.agentDesktop.listExecutions(sessionId);
      if (executions?.executions) {
        setExecutions(executions.executions);
      }
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
      offTeammateSpawned();
      offTeammateCompleted();
    };
  }, [applyDesktopSettings, navigateToHome, refreshApps, refreshWorkspaceSnapshot]);

  const sidebarSessions = React.useMemo(
    () => toSidebarSessions(summaries, pinnedIds),
    [summaries, pinnedIds]
  );

  // Worker threads are built directly from coordinatorTasks (authoritative for
  // list + agentId + status) and workerSubagentResults (authoritative for content).
  // The frozen list accumulates all workers ever seen so completed ones remain
  // visible even after the backend removes them from coordinatorTasks.
  const resolvedWorkerThreads = React.useMemo(() => {
    const live = coordinatorTasks.map((task, index) => {
      const stickyStatus = stickyWorkerTaskStatuses[task.id];
      const taskStatus = mapCoordinatorTaskStatus(task.status);
      // isIdle is the SDK-native signal: true means the worker has finished.
      const status: WorkerThreadStatus = stickyStatus
        || (task.isIdle ? (taskStatus === 'failed' ? 'failed' : 'completed') : taskStatus)
        || 'queued';
      // agentId (e.g. "alice@team1") is the key used in .jsonl filenames;
      // task.id is the internal taskId which differs from the file-based agentId.
      const resultKey = task.agentId || task.id;
      const subagentResult = workerSubagentResults[resultKey];
      const resultText = subagentResult?.resultText || undefined;
      const summary = resultText || undefined;
      const messages = subagentResult?.events?.length
        ? buildWorkerMessagesFromSubagentEvents(subagentResult.events)
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
      // will pick this up and update archivedWorkerThreads state.
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
          ? buildWorkerMessagesFromSubagentEvents(subagentResult.events)
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
        const [detail, workerResultsRes] = await Promise.all([
          window.agentDesktop.getSession({ sessionId: activeSessionId }),
          window.agentDesktop.getWorkerResults({ sessionId: activeSessionId }),
        ]);
        if (activeSessionIdRef.current !== activeSessionId) return;
        setActiveDetail(detail);
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
  const chatMessages = React.useMemo(
    () => buildMainChatMessagesFromHistory(activeDetail?.history || []),
    [activeDetail?.history],
  );

  const transcriptDebugInfo = React.useMemo(
    () => collectAgentTranscriptDebugInfo(
      activeDetail?.history || [],
      resolvedWorkerThreads,
      chatMessages,
    ),
    [activeDetail?.history, resolvedWorkerThreads, chatMessages]
  );

  React.useEffect(() => {
    if (!activeSessionId || !activeDetail?.history?.length) return;
    logCoordinatorDebug('[coordinator-debug] transcript-derivation', {
      sessionId: activeSessionId,
      busy: Boolean(activeDetail?.busy),
      info: transcriptDebugInfo,
    });
  }, [activeSessionId, activeDetail?.busy, activeDetail?.history?.length, transcriptDebugInfo]);

  React.useEffect(() => {
    if (!activeSessionId) return;
    logCoordinatorDebug('[coordinator-debug] task-snapshot', {
      sessionId: activeSessionId,
      tasks: coordinatorTasks.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        isIdle: task.isIdle,
        description: task.description,
      })),
    });
  }, [activeSessionId, coordinatorTasks]);

  React.useEffect(() => {
    if (!activeSessionId) return;
    logCoordinatorDebug('[coordinator-debug] worker-task-reconcile', {
      sessionId: activeSessionId,
      workerCount: resolvedWorkerThreads.length,
      taskCount: coordinatorTasks.length,
      workers: resolvedWorkerThreads.map((thread) => ({
        id: thread.id,
        agentId: thread.agentId,
        title: thread.title,
        status: thread.status,
        hasResultText: Boolean(thread.resultText?.trim()),
        messageCount: thread.messages.length,
      })),
    });
  }, [activeSessionId, coordinatorTasks, resolvedWorkerThreads]);

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

  const submitPrompt = React.useCallback(async (intent: ComposerIntent, files?: Array<{ name: string; path: string }>, workspace?: string) => {
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
      sessionId = await createAndOpenSession(undefined, workspace);
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

    // Reset auxiliary tracking state before sending. frozenWorkerThreadsRef is
    // intentionally NOT cleared here so multi-turn coordinators keep their
    // worker panel visible during follow-up turns. The resolvedWorkerThreads
    // memo resets frozen automatically when genuinely new task IDs appear.
    refreshedTerminalWorkerIdsRef.current = new Set();
    prevCoordinatorTaskIdsRef.current = new Set();
    setStickyWorkerTaskStatuses({});
    setWorkerSubagentResults({});

    const result = await window.agentDesktop.send({
      sessionId,
      prompt,
      mode: intent === 'chat' ? undefined : intent,
      appName: intent === 'iterate-app' ? selectedAppName : undefined,
      files: filesToSend?.map(f => f.path),
      coordinatorMode: intent === 'coordinator' ? true : undefined,
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

  const handleSend = React.useCallback(async (files?: Array<{ name: string; path: string }>, workspace?: string) => {
    await submitPrompt(composerIntent, files, workspace);
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
    setComposerIntent('iterate-app');
    if (!activeSessionId) {
      navigateToHome({ preserveIntent: true });
      await createAndOpenSession(`迭代 ${name}`);
    }
  }, [activeSessionId, navigateToHome, createAndOpenSession]);

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

  const autoSaveSettings = React.useCallback(async (key: keyof DesktopSettings, value: any) => {
    try {
      const payload = { [key]: value };
      const saved = await window.agentDesktop.updateSettings(payload);
      applyDesktopSettings(saved);
    } catch (error: any) {
      setSettingsNotice(error?.message || String(error));
    }
  }, [applyDesktopSettings]);

  const renderSettingsView = () => (
    <div className="h-full overflow-auto bg-background px-8 py-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-[28px] border border-border/80 bg-card/80 p-8 shadow-[0_24px_80px_-36px_rgba(0,0,0,0.45)]">
          <div className="grid gap-6 lg:grid-cols-2">
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
                    const value = event.target.checked;
                    setSettingsDraft({
                      ...settingsDraft,
                      bypassPermissions: value,
                    });
                    void autoSaveSettings('bypassPermissions', value);
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
              <Input
                className="mt-4 bg-background text-foreground"
                value={settingsDraft?.model || ''}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  const value = event.target.value;
                  setSettingsDraft({
                    ...settingsDraft,
                    model: value,
                  });
                  void autoSaveSettings('model', value);
                }}
                placeholder="claude-sonnet-4-6"
              />
              <p className="mt-4 text-sm font-medium text-foreground">图片模型</p>
              <Input
                className="mt-2 bg-background text-foreground"
                value={settingsDraft?.visionModel || ''}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  const value = event.target.value;
                  setSettingsDraft({
                    ...settingsDraft,
                    visionModel: value,
                  });
                  void autoSaveSettings('visionModel', value);
                }}
              />
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">最大轮次</p>
              <Input
                type="number"
                min={1}
                max={10000}
                className="mt-4 bg-background text-foreground"
                value={settingsDraft?.maxTurns ?? 100}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  const value = Number.parseInt(event.target.value || '1', 10);
                  setSettingsDraft({
                    ...settingsDraft,
                    maxTurns: value,
                  });
                  void autoSaveSettings('maxTurns', value);
                }}
              />
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/60 p-5">
              <p className="text-sm font-medium text-foreground">思考模式</p>
              <select
                className="mt-4 h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none"
                value={settingsDraft?.thinkingMode || 'disabled'}
                onChange={(event) => {
                  if (!settingsDraft) return;
                  const value = event.target.value as DesktopSettings['thinkingMode'];
                  setSettingsDraft({
                    ...settingsDraft,
                    thinkingMode: value,
                  });
                  void autoSaveSettings('thinkingMode', value);
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
                    const value = Number.parseInt(event.target.value || '1024', 10);
                    setSettingsDraft({
                      ...settingsDraft,
                      thinkingBudgetTokens: value,
                    });
                    void autoSaveSettings('thinkingBudgetTokens', value);
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
                  const value = event.target.value;
                  setSettingsDraft({
                    ...settingsDraft,
                    url: value,
                  });
                  void autoSaveSettings('url', value);
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
                    const value = event.target.value;
                    setSettingsDraft({
                      ...settingsDraft,
                      apiKey: value,
                    });
                    void autoSaveSettings('apiKey', value);
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
            <Textarea
              className="mt-4 min-h-[180px] bg-background text-foreground"
              value={settingsDraft?.appendSystemPrompt || ''}
              onChange={(event) => {
                if (!settingsDraft) return;
                const value = event.target.value;
                setSettingsDraft({
                  ...settingsDraft,
                  appendSystemPrompt: value,
                });
                void autoSaveSettings('appendSystemPrompt', value);
              }}
              placeholder="例如：默认使用中文回复；修改代码前先解释关键影响；避免自动删除用户未要求的文件。"
            />
          </div>

          {settingsNotice && (
              <p className="mt-2 text-muted-foreground">{settingsNotice}</p>
            )}
        </div>

        {/* Buddy Settings */}
        <div className="rounded-[28px] border border-border/80 bg-card/80 p-8 shadow-[0_24px_80px_-36px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">Buddy 伴侣精灵</h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                开启后在侧边栏显示你的专属宠物陪伴。
              </p>
            </div>
            <label className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">{isBuddyEnabled() ? '已开启' : '已关闭'}</span>
              <input
                type="checkbox"
                className="h-5 w-5 rounded border-border bg-background text-primary"
                checked={isBuddyEnabled()}
                onChange={(event) => {
                  setBuddyEnabled(event.target.checked);
                  setForceBuddyUpdate((n) => n + 1);
                }}
              />
            </label>
          </div>
          {isBuddyEnabled() && (
            <div className="mt-4">
              <BuddySummary />
            </div>
          )}
        </div>

        {/* Theme Settings */}
        <div className="rounded-[28px] border border-border/80 bg-card/80 p-8 shadow-[0_24px_80px_-36px_rgba(0,0,0,0.45)]">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-foreground">主题</h2>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
                选择浅色、暗色或跟随系统的主题模式。
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3" style={{ maxWidth: 280 }}>
            <button
              type="button"
              onClick={() => setThemeMode('light')}
              className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium transition-colors ${
                themeMode === 'light'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <SunMedium className="h-5 w-5" />
              <span>浅色</span>
            </button>
            <button
              type="button"
              onClick={() => setThemeMode('system')}
              className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium transition-colors ${
                themeMode === 'system'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <Monitor className="h-5 w-5" />
              <span>跟随系统</span>
            </button>
            <button
              type="button"
              onClick={() => setThemeMode('dark')}
              className={`flex flex-col items-center gap-2 rounded-xl border px-4 py-3 text-xs font-medium transition-colors ${
                themeMode === 'dark'
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <MoonStar className="h-5 w-5" />
              <span>暗色</span>
            </button>
          </div>
        </div>

        {/* CSS Theme Presets */}
        <div className="mt-6 rounded-2xl border border-border/70 bg-background/60 p-5">
          <p className="text-sm font-medium text-foreground">背景样式</p>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            选择预设的背景样式。
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {PRESET_THEMES.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => setCssThemeId(theme.id)}
                className={`rounded-xl border px-4 py-2 text-xs font-medium transition-colors ${
                  cssThemeId === theme.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                {theme.name}
              </button>
            ))}
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
                workerThreads={resolvedWorkerThreads}
                archivedWorkerThreads={archivedWorkerThreads}
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
                workerThreads={[]}
                archivedWorkerThreads={[]}
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
        {isBuddyEnabled() && (
          <BuddyCompanion key={forceBuddyUpdate} />
        )}
      </div>
    </div>
  );
}
