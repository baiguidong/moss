"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const SLASH_COMMANDS = [
  { name: "/clear", description: "清除对话历史" },
  { name: "/compact", description: "压缩对话上下文" },
  { name: "/model", description: "切换模型", args: "model" },
  { name: "/effort", description: "设置推理强度", args: "effort" },
  { name: "/config", description: "查看或修改配置" },
  { name: "/help", description: "显示帮助信息" },
  { name: "/cost", description: "查看当前会话费用" },
  { name: "/memory", description: "管理记忆" },
  { name: "/status", description: "查看当前状态" },
  { name: "/diff", description: "查看代码变更" },
  { name: "/doctor", description: "诊断问题" },
  { name: "/theme", description: "切换主题" },
  { name: "/mcp", description: "管理 MCP 服务器" },
  { name: "/review", description: "代码审查" },
  { name: "/commit", description: "生成 commit 信息" },
  { name: "/btw", description: "快速提问" },
  { name: "/skills", description: "管理技能" },
  { name: "/vim", description: "切换 Vim 模式" },
  { name: "/login", description: "登录" },
  { name: "/logout", description: "登出" },
  { name: "/version", description: "查看版本" },
  { name: "/context", description: "管理上下文文件" },
  { name: "/init", description: "初始化项目" },
  { name: "/rename", description: "重命名会话" },
  { name: "/tasks", description: "管理任务列表" },
  { name: "/share", description: "分享对话" },
  { name: "/ide", description: "IDE 集成设置" },
];

const MODEL_OPTIONS = [
  { value: "sonnet", label: "Sonnet", description: "快速、平衡" },
  { value: "opus", label: "Opus", description: "最强推理" },
  { value: "haiku", label: "Haiku", description: "最快、最轻" },
  { value: "sonnet-4-6", label: "Sonnet 4.6", description: "最新 Sonnet" },
  { value: "opus-4-6", label: "Opus 4.6", description: "最新 Opus" },
];

const EFFORT_OPTIONS = [
  { value: "low", label: "low", description: "快速、简洁的实现" },
  { value: "medium", label: "medium", description: "平衡方式" },
  { value: "high", label: "high", description: "全面实现，充分测试" },
  { value: "max", label: "max", description: "最强推理（仅 Opus）" },
  { value: "auto", label: "auto", description: "模型默认" },
];

const COMMANDS_WITH_ARGS: Record<string, { name: string; description: string; args: string; optionList: { value: string; label: string; description: string }[] }> = {
  model: {
    name: "/model",
    description: "切换模型",
    args: "model",
    optionList: MODEL_OPTIONS,
  },
  effort: {
    name: "/effort",
    description: "设置推理强度",
    args: "effort",
    optionList: EFFORT_OPTIONS,
  },
};

export function SlashCommandMenu({
  filter,
  onSelect,
  selectedIndex,
  onSetSelectedIndex,
}: {
  filter: string;
  onSelect: (command: string) => void;
  selectedIndex: number;
  onSetSelectedIndex: (index: number) => void;
}) {
  const filtered = React.useMemo(() => {
    if (!filter.startsWith("/")) return [];
    const query = filter.toLowerCase().slice(1);
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.name.toLowerCase().startsWith("/" + query) ||
        cmd.description.toLowerCase().includes(query)
    );
  }, [filter]);

  React.useEffect(() => {
    onSetSelectedIndex(0);
  }, [filter, onSetSelectedIndex]);

  if (filtered.length === 0) return null;

  const visible = filtered.slice(0, 8);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.5)] backdrop-blur">
      <div className="max-h-60 overflow-y-auto py-1">
        {visible.map((cmd, i) => (
          <button
            key={cmd.name}
            type="button"
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
              i === selectedIndex
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
            onClick={() => onSelect(cmd.name)}
          >
            <span className="min-w-[80px] font-mono text-xs text-primary">{cmd.name}</span>
            <span className="text-xs">{cmd.description}</span>
            {COMMANDS_WITH_ARGS[cmd.name.slice(1)] && (
              <span className="ml-auto text-[10px] text-muted-foreground/60">&lt;{COMMANDS_WITH_ARGS[cmd.name.slice(1)].args}&gt;</span>
            )}
          </button>
        ))}
      </div>
      {filtered.length > 8 && (
        <div className="border-t border-border/50 px-3 py-1 text-xs text-muted-foreground">
          还有 {filtered.length - 8} 个命令...
        </div>
      )}
    </div>
  );
}

export function SlashCommandSubMenu({
  commandName,
  onSelect,
  selectedIndex,
  onSetSelectedIndex,
}: {
  commandName: string;
  onSelect: (value: string) => void;
  selectedIndex: number;
  onSetSelectedIndex: (index: number) => void;
}) {
  const cmdKey = commandName.startsWith("/") ? commandName.slice(1) : commandName;
  const cmd = COMMANDS_WITH_ARGS[cmdKey];
  if (!cmd?.optionList) return null;

  const options = cmd.optionList;

  React.useEffect(() => {
    onSetSelectedIndex(0);
  }, [onSetSelectedIndex]);

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 overflow-hidden rounded-xl border border-border/70 bg-card/95 shadow-[0_8px_30px_-8px_rgba(0,0,0,0.5)] backdrop-blur">
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground">
        {cmd.name} — 选择参数：
      </div>
      <div className="max-h-52 overflow-y-auto pb-1">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            className={cn(
              "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
              i === selectedIndex
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
            onClick={() => onSelect(opt.value)}
          >
            <span className="min-w-[60px] font-mono text-xs text-primary">{opt.value}</span>
            <span className="text-xs">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function getSlashCommandFilter(text: string, cursorPos: number): string | null {
  const lineBeforeCursor = text.slice(0, cursorPos);
  const lines = lineBeforeCursor.split("\n");
  const lastLine = lines[lines.length - 1];

  if (!lastLine.startsWith("/")) return null;

  const hasSpace = lastLine.includes(" ");
  if (hasSpace) return null;

  return lastLine;
}

export { SLASH_COMMANDS, COMMANDS_WITH_ARGS };