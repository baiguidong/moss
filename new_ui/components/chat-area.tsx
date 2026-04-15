"use client";

import * as React from "react";
import { Send, Paperclip, Mic, Sparkles, Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ToolSteps } from "@/components/tool-steps";

type ToolStatus = "pending" | "running" | "success" | "error";

interface ToolStep {
  id: string;
  name: string;
  type: "exec" | "search" | "code" | "api" | "db" | "other";
  status: ToolStatus;
  duration?: number;
  result?: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  toolSteps?: ToolStep[];
  toolsComplete?: boolean;
}

const mockMessages: Message[] = [
  {
    id: "1",
    role: "user",
    content: "你好，请帮我分析一下这个文件的内容。",
    timestamp: new Date(Date.now() - 60000 * 5),
  },
  {
    id: "2",
    role: "assistant",
    content: "好的！我来帮您分析文件内容。",
    timestamp: new Date(Date.now() - 60000 * 4),
    toolSteps: [
      {
        id: "t1",
        name: "file.read",
        type: "search",
        status: "success",
        duration: 123,
        result: "成功读取文件: report.docx (2.3MB)",
      },
      {
        id: "t2",
        name: "content.analyze",
        type: "code",
        status: "success",
        duration: 456,
        result: "分析完成:\n- 段落数: 24\n- 词数: 3,521\n- 主题: 季度财务报告",
      },
    ],
    toolsComplete: true,
  },
  {
    id: "3",
    role: "user",
    content: "你帮我看下桌面有什么",
    timestamp: new Date(Date.now() - 60000 * 2),
  },
  {
    id: "4",
    role: "assistant",
    content: "我来帮您查看桌面的内容。",
    timestamp: new Date(Date.now() - 60000 * 1),
    toolSteps: [
      {
        id: "t3",
        name: "browser.navigate",
        type: "api",
        status: "success",
        duration: 234,
        result: "成功打开文件管理器",
      },
      {
        id: "t4",
        name: "exec.execute",
        type: "exec",
        status: "success",
        duration: 156,
        result: "桌面文件列表:\n├── 项目文档.docx\n├── 数据分析.xlsx\n├── 截图001.png\n├── 会议记录/\n└── 下载/",
      },
    ],
    toolsComplete: true,
  },
];

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn(
        "flex gap-3",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <Avatar className={cn("h-8 w-8 shrink-0", isUser ? "bg-primary" : "bg-secondary")}>
        <AvatarFallback
          className={cn(
            "text-xs",
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-gradient-to-br from-primary/20 to-primary/10 text-primary"
          )}
        >
          {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
        </AvatarFallback>
      </Avatar>
      <div className={cn("max-w-[75%] space-y-2", isUser && "flex flex-col items-end")}>
        {/* Tool steps card (for assistant messages) */}
        {!isUser && message.toolSteps && message.toolSteps.length > 0 && (
          <ToolSteps
            steps={message.toolSteps}
            isComplete={message.toolsComplete}
            autoCollapse={true}
          />
        )}

        {/* Message content */}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-muted text-foreground rounded-tl-sm"
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
          <span
            className={cn(
              "mt-1 block text-[10px]",
              isUser ? "text-primary-foreground/60" : "text-muted-foreground"
            )}
          >
            {message.timestamp.toLocaleTimeString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ChatArea() {
  const [input, setInput] = React.useState("");

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary/20 to-primary/5">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="font-semibold text-foreground">AI 助手</h1>
            <p className="text-xs text-muted-foreground">在线 · 随时为您服务</p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-6 py-4">
        <div className="space-y-6">
          {mockMessages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-border p-4">
        <div className="relative rounded-xl border border-border bg-card shadow-sm transition-shadow focus-within:border-primary/50 focus-within:shadow-md focus-within:shadow-primary/5">
          <Textarea
            placeholder="输入消息..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-h-[60px] resize-none border-0 bg-transparent px-4 py-3 pr-24 text-sm focus-visible:ring-0"
            rows={2}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Mic className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              className="h-8 w-8"
              disabled={!input.trim()}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          AI 可能会产生错误，请核实重要信息
        </p>
      </div>
    </div>
  );
}
