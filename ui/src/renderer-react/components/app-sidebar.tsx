"use client";

import * as React from "react";
import {
  Box,
  LayoutGrid,
  Plus,
  Settings,
  MoreHorizontal,
  Trash2,
  Edit3,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SidebarSession {
  id: string;
  title: string;
  preview: string;
  time: string;
  isPinned?: boolean;
}

interface AppSidebarProps {
  sessions: SidebarSession[];
  activeSessionId: string | null;
  activeView: "chat" | "apps" | "settings";
  appsCount: number;
  onChangeView: (view: "chat" | "apps" | "settings") => void;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
}

function NavItem({
  icon,
  label,
  isActive,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClick}
            className={cn(
              "h-10 w-10 rounded-xl transition-all",
              isActive
                ? "bg-primary text-primary-foreground shadow-md"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
            )}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right" className="bg-popover text-popover-foreground">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function SessionItem({
  session,
  isActive,
  onClick,
  onDelete,
  onRename,
  onTogglePin,
}: {
  session: SidebarSession;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
  onTogglePin: () => void;
}) {
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setShowMenu(true)}
      onMouseLeave={() => setShowMenu(false)}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-1 rounded-xl border px-3 py-2.5 transition-all",
        isActive
          ? "border-primary/30 bg-primary/12 shadow-sm"
          : "border-sidebar-border/70 bg-sidebar-accent/20 hover:bg-sidebar-accent/50"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          {session.isPinned && <Pin className="h-3 w-3 shrink-0 text-primary" />}
          <span
            className={cn(
              "block min-w-0 truncate text-sm font-medium",
              isActive ? "text-primary" : "text-sidebar-foreground"
            )}
            title={session.title}
          >
            {session.title}
          </span>
        </div>
        <div
          className={cn(
            "flex items-center gap-1 transition-opacity",
            showMenu ? "opacity-100" : "opacity-0"
          )}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-sidebar-foreground/50 hover:text-sidebar-foreground"
                onClick={(event) => event.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-40"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenuItem onClick={onTogglePin}>
                <Pin className="mr-2 h-4 w-4" />
                {session.isPinned ? "取消置顶" : "置顶"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRename}>
                <Edit3 className="mr-2 h-4 w-4" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="block min-w-0 flex-1 truncate text-xs text-sidebar-foreground/50">
          {session.preview || ""}
        </span>
        <span className="shrink-0 text-xs text-sidebar-foreground/40">{session.time}</span>
      </div>
    </div>
  );
}

export function AppSidebar({
  sessions,
  activeSessionId,
  activeView,
  onChangeView,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onTogglePin,
}: AppSidebarProps) {
  const pinnedSessions = sessions.filter((session) => session.isPinned);
  const recentSessions = sessions.filter((session) => !session.isPinned);

  return (
    <div className="flex h-full min-h-0 w-72 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-md">
            <Box className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold text-sidebar-foreground">Moss</span>
        </div>
      </div>

      <div className="border-b border-sidebar-border px-3 py-2">
        <Button
          variant="outline"
          className="w-full justify-center gap-2 rounded-lg border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent"
          onClick={onNewSession}
        >
          <Plus className="h-4 w-4" />
          新会话
        </Button>
      </div>

      <div className="border-b border-sidebar-border px-4 py-3 text-center text-sm font-medium text-sidebar-foreground">
        历史会话
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {pinnedSessions.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1.5 text-xs font-medium text-sidebar-foreground/40">置顶会话</div>
              {pinnedSessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  isActive={activeSessionId === session.id}
                  onClick={() => onSelectSession(session.id)}
                  onDelete={() => onDeleteSession(session.id)}
                  onRename={() => onRenameSession(session.id)}
                  onTogglePin={() => onTogglePin(session.id)}
                />
              ))}
            </div>
          )}

          <div>
            {recentSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                isActive={activeSessionId === session.id}
                onClick={() => onSelectSession(session.id)}
                onDelete={() => onDeleteSession(session.id)}
                onRename={() => onRenameSession(session.id)}
                onTogglePin={() => onTogglePin(session.id)}
              />
            ))}
          </div>
        </div>
      </ScrollArea>

      <div className="border-t border-sidebar-border px-3 py-2">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChangeView("apps")}
            className={cn(
              "flex-1 gap-2 rounded-lg transition-all",
              activeView === "apps"
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Apps
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChangeView("settings")}
            className={cn(
              "flex-1 gap-2 rounded-lg transition-all",
              activeView === "settings"
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
      </div>
    </div>
  );
}
