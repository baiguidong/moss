"use client";

import * as React from "react";
import {
  LayoutGrid,
  Monitor,
  MessageSquareText,
  MoonStar,
  PenSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Search,
  Settings,
  SunMedium,
  Trash2,
  X,
  AlarmClock,
  Bot,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Hammer,
  Plug,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  filterSidebarSessionsByQuery,
  getSessionNodePreview,
  groupProjectSessionTrees,
  groupSessionNodes,
  groupSidebarSessions,
  SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT,
  type SessionGroupId,
} from "@/lib/session-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionTreeChildItem } from "@/components/session-tree-child-item";
import type { StoredApp } from "../types";

export interface SidebarSession {
  id: string;
  title: string;
  preview: string;
  time: string;
  workspaceLabel: string;
  busy: boolean;
  isPinned?: boolean;
  agentMode?: 'local' | 'remote-direct';
  projectId?: string | null;
  projectName?: string | null;
  sessionKind?: 'chat' | 'cron';
  originChannel?: 'desktop' | 'feishu' | 'cron';
  sourceSessionId?: string | null;
  sourceSessionTitle?: string | null;
  cronTaskId?: string | null;
  isSubAgent?: boolean;
  parentSessionId?: string | null;
  subagentStatus?: 'running' | 'completed' | 'failed' | null;
}

export type MainView = "chat" | "projects" | "skills" | "connectors" | "experts" | "apps" | "settings" | "cron" | "audit" | "embedded-app";

interface AppSidebarProps {
  sessions: SidebarSession[];
  apps: StoredApp[];
  activeSessionId: string | null;
  activeView: MainView;
  appsCount: number;
  projectsCount: number;
  themeMode: "dark" | "light" | "system";
  collapsed: boolean;
  searchQuery: string;
  localEnabled?: boolean;
  remoteEnabled?: boolean;
  newSessionMode?: 'local' | 'remote-direct';
  onChangeView: (view: MainView) => void;
  onChangeTheme: (theme: "dark" | "light" | "system") => void;
  onSelectSession: (sessionId: string) => void;
  onLaunchApp: (name: string) => void;
  onNewSession: () => void;
  onNewSessionModeChange?: (mode: 'local' | 'remote-direct') => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, newTitle: string) => void;
  onTogglePin: (sessionId: string) => void;
  onToggleCollapse: () => void;
  onSearchChange: (query: string) => void;
}

function getAppShortcutLabel(app: StoredApp) {
  return app.displayName || app.title || app.name;
}

function SessionItem({
  session,
  isActive,
  onClick,
  onDelete,
  onRename,
  onTogglePin,
  childSessions = [],
}: {
  session: SidebarSession;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
  onTogglePin: () => void;
  childSessions?: SidebarSession[];
}) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [editValue, setEditValue] = React.useState(session.title);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleRename = () => {
    setEditValue(session.title);
    setIsEditing(true);
  };

  const handleConfirmRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.title) {
      onRename(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleConfirmRename();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(session.title);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      className={cn(
        "group relative h-8 w-full max-w-full overflow-hidden rounded-lg border px-2 text-left transition-colors",
        isActive
          ? "border-primary/25 bg-primary/10 shadow-[0_8px-24px_-24px_rgba(0,0,0,0.65)]"
          : "border-transparent bg-transparent hover:border-sidebar-border/70 hover:bg-sidebar-accent/80",
      )}
    >
      <div className="flex h-full min-w-0 items-center gap-1 overflow-hidden">
        {!session.isSubAgent ? <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-6 w-6 shrink-0 rounded-lg text-sidebar-foreground/60 hover:text-sidebar-foreground"
              onClick={(event) => event.stopPropagation()}
              title="会话设置"
            >
              <Settings className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-40"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenuItem onClick={onTogglePin}>
              <Pin className="mr-2 h-4 w-4" />
              {session.isPinned ? "取消置顶" : "置顶会话"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleRename}>
              <PenSquare className="mr-2 h-4 w-4" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> : null}
        {session.isPinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleConfirmRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-primary/50 bg-background px-1 text-[13px] font-medium leading-5 text-sidebar-foreground outline-none focus:border-primary"
          />
        ) : (
          <span className="block w-0 min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-sidebar-foreground">
            {session.title}
          </span>
        )}
        {childSessions.length > 0 ? (
          <span
            className="flex h-5 shrink-0 items-center gap-1 rounded-md bg-sidebar-accent px-1.5 text-[10px] tabular-nums text-sidebar-foreground/65"
            title={`${childSessions.length} 个子任务`}
          >
            <Bot className="h-3 w-3" />
            {childSessions.length}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AppShortcutItem({
  app,
  onLaunch,
}: {
  app: StoredApp;
  onLaunch: () => void;
}) {
  const label = getAppShortcutLabel(app);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onLaunch}
      onKeyDown={(e) => e.key === 'Enter' && onLaunch()}
      className="group relative w-full max-w-full overflow-hidden rounded-xl border border-transparent px-2 py-1 text-left transition-colors hover:border-sidebar-border/70 hover:bg-sidebar-accent/80"
    >
      <div className="flex min-w-0 items-center gap-2 overflow-hidden">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <Monitor className="h-3.5 w-3.5" />
        </span>
        <span className="block w-0 min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-sidebar-foreground">
          {label}
        </span>
      </div>
    </div>
  );
}

function ThemeButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-sidebar-accent text-sidebar-foreground/65 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function AppSidebar({
  sessions,
  apps,
  activeSessionId,
  activeView,
  appsCount,
  themeMode,
  collapsed,
  searchQuery,
  localEnabled = true,
  remoteEnabled = false,
  newSessionMode = 'local',
  onChangeView,
  onChangeTheme,
  onSelectSession,
  onLaunchApp,
  onNewSession,
  onNewSessionModeChange,
  onDeleteSession,
  onRenameSession,
  onTogglePin,
  onToggleCollapse,
  onSearchChange,
}: AppSidebarProps) {
  const showModePicker = remoteEnabled;
  const [isSearchOpen, setIsSearchOpen] = React.useState(Boolean(searchQuery));
  const [expandedSessionGroups, setExpandedSessionGroups] = React.useState<Partial<Record<SessionGroupId, boolean>>>({});
  const [collapsedSessionGroups, setCollapsedSessionGroups] = React.useState<Partial<Record<SessionGroupId, boolean>>>({});
  const [collapsedProjects, setCollapsedProjects] = React.useState<Record<string, boolean>>({});
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (searchQuery) setIsSearchOpen(true);
  }, [searchQuery]);

  React.useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus();
  }, [isSearchOpen]);

  const filteredSessions = filterSidebarSessionsByQuery(sessions, searchQuery);
  // 根据当前选择的模式过滤会话
  const localSessions = filteredSessions.filter((s) => !s.agentMode || s.agentMode === 'local');
  const remoteSessions = filteredSessions.filter((s) => s.agentMode === 'remote-direct');

  // 当有切换器时，根据选择的模式显示对应会话
  // 无切换器时（只有本地），显示所有会话
  const displaySessions = showModePicker
    ? (newSessionMode === 'remote-direct' ? remoteSessions : localSessions)
    : filteredSessions;

  const sessionGroups = groupSidebarSessions(displaySessions).filter((group) => group.id !== 'project');
  const projectTrees = groupProjectSessionTrees(displaySessions);
  const sessionGroupIcons = {
    feishu: Bot,
    chat: MessageSquareText,
    cron: AlarmClock,
    project: FolderKanban,
  };
  const visibleSessionGroups = sessionGroups.map((group) => ({
    ...group,
    nodes: groupSessionNodes(group.sessions),
    visibleNodes: collapsedSessionGroups[group.id]
      ? []
      : expandedSessionGroups[group.id]
        ? groupSessionNodes(group.sessions)
        : getSessionNodePreview(groupSessionNodes(group.sessions), activeSessionId),
  }));
  const orderedSessions = [
    ...visibleSessionGroups.flatMap((group) => group.visibleNodes.flatMap((node) => [node.session, ...node.children])),
    ...projectTrees.flatMap((project) => project.sessions.flatMap((node) => [node.session, ...node.children])),
  ];

  const toggleSessionGroupCollapsed = (groupId: SessionGroupId) => {
    setCollapsedSessionGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  const toggleSessionGroupExpanded = (groupId: SessionGroupId) => {
    setExpandedSessionGroups((current) => ({
      ...current,
      [groupId]: !current[groupId],
    }));
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 w-full max-w-full flex-col bg-sidebar/96 text-sidebar-foreground backdrop-blur overflow-hidden">
      <div className={cn(collapsed ? "px-2 py-3" : "px-3 py-3")}>
        <div className={cn("flex items-center", collapsed ? "justify-start" : "justify-between gap-3")}>
          {!collapsed && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <img src="./build/icon.png" alt="Moss" className="h-5 w-5 rounded-sm object-contain" />
                <div className="text-sm font-semibold lowercase tracking-[0.14em] text-sidebar-foreground">
                  moss
                </div>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 rounded-xl"
            onClick={onToggleCollapse}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-0.5">
          <Button
            variant="ghost"
            className={cn("h-8 rounded-lg", collapsed ? "w-8 justify-center px-0" : "justify-start !pl-2")}
            onClick={onNewSession}
            title="新会话"
          >
            <PenSquare className="h-4 w-4" />
            {!collapsed && "新会话"}
          </Button>
          <Button
            variant={activeView === "projects" ? "secondary" : "ghost"}
            className={cn("h-8 rounded-lg", collapsed ? "w-8 justify-center px-0" : "justify-start !pl-2")}
            onClick={() => onChangeView("projects")}
            title="项目"
          >
            <FolderKanban className="h-4 w-4" />
            {!collapsed && "项目"}
          </Button>
          <Button
            variant={activeView === "skills" ? "secondary" : "ghost"}
            className={cn("h-8 rounded-lg", collapsed ? "w-8 justify-center px-0" : "justify-start !pl-2")}
            onClick={() => onChangeView("skills")}
            title="技能"
          >
            <Hammer className="h-4 w-4" />
            {!collapsed && "技能"}
          </Button>
          <Button
            variant={activeView === "connectors" ? "secondary" : "ghost"}
            className={cn("h-8 rounded-lg", collapsed ? "w-8 justify-center px-0" : "justify-start !pl-2")}
            onClick={() => onChangeView("connectors")}
            title="连接器"
          >
            <Plug className="h-4 w-4" />
            {!collapsed && "连接器"}
          </Button>
          <Button
            variant={activeView === "experts" ? "secondary" : "ghost"}
            className={cn("h-8 rounded-lg", collapsed ? "w-8 justify-center px-0" : "justify-start !pl-2")}
            onClick={() => onChangeView("experts")}
            title="专家"
          >
            <UsersRound className="h-4 w-4" />
            {!collapsed && "专家"}
          </Button>
          <Button
            variant={activeView === "cron" ? "secondary" : "ghost"}
            className={cn("h-8 rounded-lg", collapsed ? "w-8 justify-center px-0" : "justify-start !pl-2")}
            onClick={() => onChangeView("cron")}
            title="定时任务"
          >
            <AlarmClock className="h-4 w-4" />
            {!collapsed && "定时任务"}
          </Button>
          <Button
            variant={activeView === "audit" ? "secondary" : "ghost"}
            className={cn("h-8 rounded-lg", collapsed ? "w-8 justify-center px-0" : "justify-start !pl-2")}
            onClick={() => onChangeView("audit")}
            title="审计中心"
          >
            <ShieldCheck className="h-4 w-4" />
            {!collapsed && "审计中心"}
          </Button>
        </div>
      </div>

      {collapsed ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col items-start gap-1.5 p-2">
            {orderedSessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session.id)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors",
                  activeSessionId === session.id
                    ? "bg-primary/20 text-primary"
                    : "bg-sidebar-accent/60 text-sidebar-foreground hover:bg-sidebar-accent"
                )}
                title={session.title}
              >
                {session.title.charAt(0).toUpperCase()}
              </button>
            ))}
          </div>
        </ScrollArea>
      ) : (
        <>
          <div className="px-3 pb-1.5 pt-0.5">
            <div className="flex min-w-0 items-center gap-1.5">
              {showModePicker && (
                <div className="flex min-w-0 flex-1 items-center gap-1.5 px-1 text-[13px]" role="tablist" aria-label="会话模式">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={newSessionMode !== 'remote-direct'}
                    onClick={() => onNewSessionModeChange?.('local')}
                    className={cn(
                      "h-7 transition-colors",
                      newSessionMode !== 'remote-direct'
                        ? "font-medium text-sidebar-foreground"
                        : "font-medium text-sidebar-foreground/40 hover:text-sidebar-foreground/70",
                    )}
                  >
                    本地
                  </button>
                  <span className="text-sidebar-foreground/25" aria-hidden="true">/</span>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={newSessionMode === 'remote-direct'}
                    onClick={() => onNewSessionModeChange?.('remote-direct')}
                    className={cn(
                      "h-7 transition-colors",
                      newSessionMode === 'remote-direct'
                        ? "font-medium text-sidebar-foreground"
                        : "font-medium text-sidebar-foreground/40 hover:text-sidebar-foreground/70",
                    )}
                  >
                    云端
                  </button>
                </div>
              )}
              <Button
                variant={isSearchOpen ? "secondary" : "ghost"}
                size="icon-sm"
                className="h-8 w-8 shrink-0 rounded-lg"
                onClick={() => {
                  if (isSearchOpen) {
                    onSearchChange("");
                    setIsSearchOpen(false);
                  } else {
                    setIsSearchOpen(true);
                  }
                }}
                title={isSearchOpen ? "关闭搜索" : "搜索会话"}
                aria-label={isSearchOpen ? "关闭搜索" : "搜索会话"}
              >
                {isSearchOpen ? <X className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
              </Button>
            </div>
            {isSearchOpen && (
              <div className="relative mt-1.5">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={searchInputRef}
                  placeholder="搜索会话..."
                  value={searchQuery}
                  onChange={(e) => onSearchChange(e.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    onSearchChange("");
                    setIsSearchOpen(false);
                  }}
                  className="h-7 rounded-lg border-transparent bg-sidebar-accent/45 pl-7 pr-2 text-[11px] placeholder:text-muted-foreground/55 focus-visible:border-sidebar-border"
                />
              </div>
            )}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-3 p-2 max-w-full overflow-hidden">
              {sessionGroups.length > 0 || projectTrees.length > 0 ? (
                <>
                {visibleSessionGroups.map((group) => {
                  const GroupIcon = sessionGroupIcons[group.id];
                  const isCollapsed = Boolean(collapsedSessionGroups[group.id]);
                  const isExpanded = Boolean(expandedSessionGroups[group.id]);
                  const hasOverflow = group.nodes.length > SIDEBAR_SESSION_GROUP_PREVIEW_LIMIT;
                  return (
                    <section key={group.id}>
                      <div className="mb-1 flex h-7 w-full items-center rounded-md px-1 text-[11px] font-medium text-sidebar-foreground/55">
                        <button
                          type="button"
                          className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                          onClick={() => toggleSessionGroupCollapsed(group.id)}
                          aria-expanded={!isCollapsed}
                        >
                          <GroupIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{group.label}</span>
                          <span className="shrink-0 tabular-nums">({group.sessions.length})</span>
                        </button>
                        {!isCollapsed && hasOverflow && (
                          <button
                            type="button"
                            className="h-6 shrink-0 rounded-md px-1.5 text-[10px] text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                            onClick={() => toggleSessionGroupExpanded(group.id)}
                          >
                            {isExpanded ? '收起' : '全部'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                          onClick={() => toggleSessionGroupCollapsed(group.id)}
                          aria-label={isCollapsed ? `展开${group.label}` : `折叠${group.label}`}
                        >
                          {isCollapsed ? (
                            <ChevronRight className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      {!isCollapsed && (
                        <div className="space-y-0.5">
                          {group.visibleNodes.map((node) => (
                            <React.Fragment key={node.session.id}>
                              <SessionItem
                                session={node.session}
                                childSessions={node.children}
                                isActive={activeSessionId === node.session.id}
                                onClick={() => onSelectSession(node.session.id)}
                                onDelete={() => onDeleteSession(node.session.id)}
                                onRename={(newTitle) => onRenameSession(node.session.id, newTitle)}
                                onTogglePin={() => onTogglePin(node.session.id)}
                              />
                              {node.children.map((child, childIndex) => (
                                <SessionTreeChildItem
                                  key={child.id}
                                  title={child.title}
                                  busy={child.busy}
                                  status={child.subagentStatus}
                                  isLastChild={childIndex === node.children.length - 1}
                                  isActive={activeSessionId === child.id}
                                  onClick={() => onSelectSession(child.id)}
                                />
                              ))}
                            </React.Fragment>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })}
                {projectTrees.map((project) => {
                  const isCollapsed = Boolean(collapsedProjects[project.id]);
                  const sessionCount = project.sessions.reduce(
                    (count, node) => count + 1 + node.children.length,
                    0,
                  );
                  return (
                    <section key={`project-${project.id}`}>
                      <button
                        type="button"
                        className="mb-1 flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium text-sidebar-foreground/55 transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
                        onClick={() => setCollapsedProjects((current) => ({
                          ...current,
                          [project.id]: !current[project.id],
                        }))}
                        aria-expanded={!isCollapsed}
                      >
                        <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate text-left">{project.label}</span>
                        <span className="shrink-0 tabular-nums">({sessionCount})</span>
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      {!isCollapsed ? (
                        <div className="space-y-0.5">
                          {project.sessions.map((node) => (
                            <React.Fragment key={node.session.id}>
                              <SessionItem
                                session={node.session}
                                childSessions={node.children}
                                isActive={activeSessionId === node.session.id}
                                onClick={() => onSelectSession(node.session.id)}
                                onDelete={() => onDeleteSession(node.session.id)}
                                onRename={(newTitle) => onRenameSession(node.session.id, newTitle)}
                                onTogglePin={() => onTogglePin(node.session.id)}
                              />
                              {node.children.map((child, childIndex) => (
                                <SessionTreeChildItem
                                  key={child.id}
                                  title={child.title}
                                  busy={child.busy}
                                  status={child.subagentStatus}
                                  isLastChild={childIndex === node.children.length - 1}
                                  isActive={activeSessionId === child.id}
                                  onClick={() => onSelectSession(child.id)}
                                />
                              ))}
                            </React.Fragment>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  );
                })}
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-sidebar-border px-4 py-4 text-sm text-sidebar-foreground/55">
                  {showModePicker && newSessionMode === 'remote-direct' ? '暂无云端会话' : '还没有历史会话'}
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}

      <div className="border-t border-sidebar-border px-2.5 py-2.5">
        <div className={cn("grid gap-2", collapsed ? "grid-cols-1" : "grid-cols-1")}>
          {apps.map((app) => (
            collapsed ? (
              <button
                key={app.id || app.name}
                type="button"
                onClick={() => onLaunchApp(app.name)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
                title={getAppShortcutLabel(app)}
              >
                <Monitor className="h-4 w-4" />
              </button>
            ) : (
              <AppShortcutItem
                key={app.id || app.name}
                app={app}
                onLaunch={() => onLaunchApp(app.name)}
              />
            )
          ))}
        </div>

        {/* Apps 和 设置 */}
        <div className={cn("grid gap-2 mt-2", collapsed ? "grid-cols-1" : "grid-cols-2")}>
          <Button
            variant={activeView === "apps" ? "secondary" : "ghost"}
            className={cn("rounded-xl", collapsed ? "justify-center px-0 h-8 w-8" : "justify-start")}
            onClick={() => onChangeView("apps")}
          >
            <LayoutGrid className="h-4 w-4" />
            {!collapsed && (
              <>
                Apps
                <span className="ml-auto text-[11px] text-muted-foreground">{appsCount}</span>
              </>
            )}
          </Button>
          <Button
            variant={activeView === "settings" ? "secondary" : "ghost"}
            className={cn("rounded-xl", collapsed ? "justify-center px-0 h-8 w-8" : "justify-start")}
            onClick={() => onChangeView("settings")}
          >
            <Settings className="h-4 w-4" />
            {!collapsed && "设置"}
          </Button>
        </div>
      </div>
    </div>
  );
}
