import * as React from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { AppsPanel } from '@/components/apps-panel';
import { ChatArea } from '@/components/chat-area';
import { TaskPanel, type PreviewTabData } from '@/components/task-panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Textarea } from '@/components/ui/textarea';
import { buildChatMessages } from '@/lib/agent-transcript';
import type {
  AgentEvent,
  AppVersion,
  DesktopSettings,
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

function toSidebarSessions(summaries: SessionSummary[], pinnedIds: Set<string>) {
  return summaries.map((session) => ({
    ...session,
    preview: formatSidebarPreview(session.preview),
    time: formatRelativeTime(session.updatedAt),
    isPinned: pinnedIds.has(session.id),
  }));
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
  const [bootError, setBootError] = React.useState('');
  const [permissionNotice, setPermissionNotice] = React.useState('');
  const [activeView, setActiveView] = React.useState<'chat' | 'apps' | 'settings'>('chat');
  const [summaries, setSummaries] = React.useState<SessionSummary[]>([]);
  const [apps, setApps] = React.useState<StoredApp[]>([]);
  const [versionsByApp, setVersionsByApp] = React.useState<Record<string, AppVersion[]>>({});
  const [selectedAppName, setSelectedAppName] = React.useState('');
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
  const workspaceRefreshTimerRef = React.useRef<number | null>(null);
  const activeSessionIdRef = React.useRef<string | null>(null);
  const activeDetailRef = React.useRef<SessionDetail | null>(null);
  const expandedDirsRef = React.useRef<Set<string>>(new Set());
  const previewTabsRef = React.useRef<PreviewTabData[]>([]);
  const openSessionRequestIdRef = React.useRef(0);

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

  const openSession = React.useCallback(async (sessionId: string) => {
    const requestId = ++openSessionRequestIdRef.current;
    const detail = await window.agentDesktop.getSession({ sessionId });
    if (requestId !== openSessionRequestIdRef.current) {
      return;
    }
    setActiveView('chat');
    setActiveSessionId(sessionId);
    setActiveDetail(detail);
    setDirectoryCache(new Map());
    setExpandedDirs(new Set());
    setSelectedFilePath(null);
    setPreviewTabs([]);
    setActivePreviewPath(null);
    setWorkspaceQuery('');
  }, []);

  const ensureRootDirectory = React.useCallback(async (sessionId: string, workspace: string) => {
    const data = await window.agentDesktop.listWorkspaceDir({ sessionId, dirPath: workspace });
    setDirectoryCache(new Map([[workspace, data]]));
  }, []);

  React.useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

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
    if (selectedAppName && !apps.some((entry) => entry.name === selectedAppName)) {
      setSelectedAppName('');
    }
  }, [apps, selectedAppName]);

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
        const list = await refreshSummaries();
        if (cancelled) return;
        if (list.length > 0) {
          await openSession(list[0].id);
        } else {
          setActiveSessionId(null);
          setActiveDetail(null);
        }
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
        setSummaries((prev) =>
          prev
            .map((entry) => (entry.id === payload.summary.id ? payload.summary : entry))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        );
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
      setSummaries((prev) => {
        const next = prev.some((entry) => entry.id === summary.id)
          ? prev.map((entry) => (entry.id === summary.id ? summary : entry))
          : [summary, ...prev];
        return next.sort((a, b) => b.updatedAt - a.updatedAt);
      });
      if (summary.id === activeSessionIdRef.current) {
        setActiveDetail((prev) => (prev ? { ...prev, ...summary } : prev));
      }
    });

    const offRemoved = window.agentDesktop.onSessionRemoved(({ sessionId }) => {
      setSummaries((prev) => prev.filter((entry) => entry.id !== sessionId));
      if (sessionId === activeSessionIdRef.current) {
        setActiveSessionId(null);
        setActiveDetail(null);
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
  }, [applyDesktopSettings, refreshApps, refreshWorkspaceSnapshot]);

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

  const handleNewSession = React.useCallback(async () => {
    const created = await window.agentDesktop.createSession({});
    await openSession(created.summary.id);
    setActiveView('chat');
  }, [openSession]);

  const handleSelectSession = React.useCallback(async (sessionId: string) => {
    await openSession(sessionId);
    setActiveView('chat');
  }, [openSession]);

  const handleDeleteSession = React.useCallback(async (sessionId: string) => {
    await window.agentDesktop.deleteSession({ sessionId });
    const list = await refreshSummaries();
    if (activeSessionId === sessionId) {
      if (list.length > 0) {
        await openSession(list[0].id);
      } else {
        setActiveSessionId(null);
        setActiveDetail(null);
      }
    }
  }, [activeSessionId, openSession, refreshSummaries]);

  const handleRenameSession = React.useCallback(async (sessionId: string) => {
    const current = summaries.find((entry) => entry.id === sessionId);
    const nextTitle = window.prompt('重命名会话', current?.title || 'New Session');
    if (!nextTitle) return;
    const detail = await window.agentDesktop.updateSession({ sessionId, title: nextTitle });
    setSummaries((prev) => prev.map((entry) => (entry.id === sessionId ? detail : entry)));
    if (activeSessionId === sessionId) {
      setActiveDetail(detail);
    }
  }, [activeSessionId, summaries]);

  const handleTogglePin = React.useCallback((sessionId: string) => {
    const next = new Set(pinnedIds);
    if (next.has(sessionId)) next.delete(sessionId);
    else next.add(sessionId);
    persistPinned(next);
  }, [persistPinned, pinnedIds]);

  const handleSend = React.useCallback(async () => {
    if (!activeSessionId || !input.trim()) return;
    const prompt = input.trim();
    setInput('');
    await window.agentDesktop.send({ sessionId: activeSessionId, prompt });
    const detail = await window.agentDesktop.getSession({ sessionId: activeSessionId });
    setActiveDetail(detail);
  }, [activeSessionId, input]);

  const handlePlan = React.useCallback(async () => {
    if (!activeSessionId || !input.trim()) return;
    const prompt = input.trim();
    setInput('');
    await window.agentDesktop.send({
      sessionId: activeSessionId,
      prompt,
      mode: 'plan',
    });
    const detail = await window.agentDesktop.getSession({ sessionId: activeSessionId });
    setActiveDetail(detail);
  }, [activeSessionId, input]);

  const handleCreateApp = React.useCallback(async () => {
    if (!activeSessionId || !input.trim()) return;
    const prompt = input.trim();
    setInput('');
    const result = await window.agentDesktop.send({
      sessionId: activeSessionId,
      prompt,
      mode: 'create-app',
    });
    const detail = await window.agentDesktop.getSession({ sessionId: activeSessionId });
    setActiveDetail(detail);
    await refreshApps();
    if (result?.createdApp) {
      setSelectedAppName(result.createdApp.name);
      await loadAppVersions(result.createdApp.name);
      setActiveView('apps');
    }
  }, [activeSessionId, input, loadAppVersions, refreshApps]);

  const handleIterateApp = React.useCallback(async () => {
    if (!activeSessionId || !input.trim() || !selectedAppName) return;
    const prompt = input.trim();
    setInput('');
    const result = await window.agentDesktop.send({
      sessionId: activeSessionId,
      prompt,
      mode: 'iterate-app',
      appName: selectedAppName,
    });
    const detail = await window.agentDesktop.getSession({ sessionId: activeSessionId });
    setActiveDetail(detail);
    await refreshApps();
    if (result?.updatedApp) {
      setSelectedAppName(result.updatedApp.name);
      await loadAppVersions(result.updatedApp.name);
      setActiveView('apps');
    }
  }, [activeSessionId, input, loadAppVersions, refreshApps, selectedAppName]);

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
      const created = await window.agentDesktop.createSession({});
      setSummaries((prev) => [created.summary, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
      await openSession(created.summary.id);
    }
  }, [activeSessionId, openSession]);

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
    await window.agentDesktop.rollbackApp({ name, versionId });
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
              设置文件：{desktopSettings?.settingsPath || '加载中'}
            </p>
            <p className="text-muted-foreground">
              认证文件：{desktopSettings?.settingsPath || '~/.moss/settings.json'}
            </p>
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
    <div className="dark flex h-screen w-full overflow-hidden">
      <AppSidebar
        sessions={sidebarSessions}
        activeSessionId={activeSessionId}
        activeView={activeView}
        appsCount={apps.length}
        onChangeView={setActiveView}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleDeleteSession}
        onRenameSession={handleRenameSession}
        onTogglePin={handleTogglePin}
      />

      <div className="min-h-0 flex-1">
        {activeView === 'chat' ? (
          <ResizablePanelGroup direction="horizontal" className="min-h-0 flex-1">
            <ResizablePanel defaultSize={65} minSize={40} className="min-h-0">
              <ChatArea
                title={
                  activeDetail?.title === 'New Session'
                    ? ''
                    : (activeDetail?.title || 'AI 助手')
                }
                subtitle={
                  bootError ||
                  permissionNotice ||
                  (activeDetail ? `工作区: ${activeDetail.workspace}` : '选择一个会话开始')
                }
                messages={chatMessages}
                value={input}
                apps={apps}
                selectedAppName={selectedAppName}
                loading={Boolean(activeDetail?.busy)}
                hasActiveSession={Boolean(activeSessionId)}
                onCreateSession={handleNewSession}
                onChange={setInput}
                onSelectAppName={setSelectedAppName}
                onSend={handleSend}
                onPlan={handlePlan}
                onCreateApp={handleCreateApp}
                onIterateApp={handleIterateApp}
                onStop={handleStop}
              />
            </ResizablePanel>

            <ResizableHandle withHandle className="bg-border" />

            <ResizablePanel defaultSize={35} minSize={25} maxSize={50} className="min-h-0">
              <TaskPanel
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
            </ResizablePanel>
          </ResizablePanelGroup>
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
    </div>
  );
}
