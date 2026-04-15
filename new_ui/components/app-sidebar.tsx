"use client";

import * as React from "react";
import {
  Box,
  MessageSquare,
  Plus,
  Settings,
  HelpCircle,
  LogOut,
  MoreHorizontal,
  Trash2,
  Edit3,
  Pin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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

interface ChatSession {
  id: string;
  title: string;
  preview: string;
  time: string;
  isPinned?: boolean;
}

const mockSessions: ChatSession[] = [
  {
    id: "1",
    title: "页面 UI 优化",
    preview: "帮我优化页面ui，现在的太丑了",
    time: "刚刚",
    isPinned: true,
  },
  {
    id: "2",
    title: "查看桌面文件",
    preview: "你帮我看下桌面有什么",
    time: "10分钟前",
  },
  {
    id: "3",
    title: "代码重构建议",
    preview: "这段代码怎么优化比较好",
    time: "1小时前",
  },
  {
    id: "4",
    title: "API 接口调试",
    preview: "接口返回 500 错误",
    time: "昨天",
  },
  {
    id: "5",
    title: "数据库设计",
    preview: "帮我设计一个用户表",
    time: "3天前",
  },
];

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  className?: string;
}

function NavItem({ icon, label, isActive, onClick, className }: NavItemProps) {
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
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              className
            )}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="bg-popover text-popover-foreground"
        >
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
}: {
  session: ChatSession;
  isActive: boolean;
  onClick: () => void;
}) {
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setShowMenu(true)}
      onMouseLeave={() => setShowMenu(false)}
      className={cn(
        "group relative flex cursor-pointer flex-col gap-1 rounded-lg px-3 py-2.5 transition-all",
        isActive
          ? "bg-primary/15 border border-primary/30"
          : "hover:bg-sidebar-accent/50 border border-transparent"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {session.isPinned && (
            <Pin className="h-3 w-3 shrink-0 text-primary" />
          )}
          <span
            className={cn(
              "truncate text-sm font-medium",
              isActive ? "text-primary" : "text-sidebar-foreground"
            )}
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
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-40"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem>
                <Pin className="mr-2 h-4 w-4" />
                {session.isPinned ? "取消置顶" : "置顶"}
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Edit3 className="mr-2 h-4 w-4" />
                重命名
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-sidebar-foreground/50">
          {session.preview}
        </span>
        <span className="shrink-0 text-xs text-sidebar-foreground/40">
          {session.time}
        </span>
      </div>
    </div>
  );
}

export function AppSidebar() {
  const [activeNav, setActiveNav] = React.useState<"chat" | "settings">("chat");
  const [activeSession, setActiveSession] = React.useState("1");

  return (
    <div className="flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-sidebar-border px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 shadow-md">
            <Box className="h-4.5 w-4.5 text-primary-foreground" />
          </div>
          <span className="text-base font-semibold text-sidebar-foreground">
            Sudoclaw
          </span>
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-3 py-2 border-b border-sidebar-border">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 rounded-lg border-sidebar-border bg-sidebar-accent/50 text-sidebar-foreground hover:bg-sidebar-accent"
        >
          <Plus className="h-4 w-4" />
          新会话
        </Button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-sidebar-border px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveNav("chat")}
          className={cn(
            "flex-1 gap-2 rounded-lg transition-all",
            activeNav === "chat"
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
          )}
        >
          <MessageSquare className="h-4 w-4" />
          会话
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setActiveNav("settings")}
          className={cn(
            "flex-1 gap-2 rounded-lg transition-all",
            activeNav === "settings"
              ? "bg-sidebar-accent text-sidebar-foreground"
              : "text-sidebar-foreground/60 hover:text-sidebar-foreground"
          )}
        >
          <Settings className="h-4 w-4" />
          设置
        </Button>
      </div>

      {/* Content Area */}
      <ScrollArea className="flex-1">
        {activeNav === "chat" ? (
          <div className="flex flex-col gap-1 p-2">
            {/* Pinned Sessions */}
            {mockSessions.filter((s) => s.isPinned).length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1.5 text-xs font-medium text-sidebar-foreground/40">
                  置顶会话
                </div>
                {mockSessions
                  .filter((s) => s.isPinned)
                  .map((session) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isActive={activeSession === session.id}
                      onClick={() => setActiveSession(session.id)}
                    />
                  ))}
              </div>
            )}

            {/* Recent Sessions */}
            <div>
              <div className="px-2 py-1.5 text-xs font-medium text-sidebar-foreground/40">
                最近会话
              </div>
              {mockSessions
                .filter((s) => !s.isPinned)
                .map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    isActive={activeSession === session.id}
                    onClick={() => setActiveSession(session.id)}
                  />
                ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-3">
            <SettingsItem icon={<Edit3 />} label="个人资料" />
            <SettingsItem icon={<Box />} label="模型设置" />
            <SettingsItem icon={<MessageSquare />} label="快捷指令" />
            <SettingsItem icon={<HelpCircle />} label="帮助中心" />
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent cursor-pointer">
          <Avatar className="h-9 w-9 border-2 border-sidebar-border">
            <AvatarFallback className="bg-gradient-to-br from-primary to-primary/70 text-xs font-medium text-primary-foreground">
              hi
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col">
            <span className="text-sm font-medium text-sidebar-foreground">
              用户
            </span>
            <span className="text-xs text-sidebar-foreground/50">
              免费版
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-sidebar-foreground/50 hover:text-sidebar-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingsItem({
  icon,
  label,
}: {
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <div className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
      <span className="h-4 w-4">{icon}</span>
      <span className="text-sm">{label}</span>
    </div>
  );
}
