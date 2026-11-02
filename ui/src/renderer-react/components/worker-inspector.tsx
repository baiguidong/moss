import * as React from "react";
import { ArrowUpRight, X } from "lucide-react";
import { AgentExecutionRecord } from "./agent-execution-record";
import type { SessionSummary } from "../types";

export function WorkerInspector({ worker, onOpen, onClose }: {
  worker: SessionSummary; onOpen: () => void; onClose: () => void;
}) {
  const load = React.useCallback(() => window.agentDesktop.getSession({ sessionId: worker.id }), [worker.id]);
  return <aside aria-label="子 Agent 详情" className="absolute inset-y-0 right-0 z-20 flex w-[min(360px,100%)] shrink-0 flex-col border-l border-border bg-background shadow-xl @[800px]/workers-workspace:static @[800px]/workers-workspace:w-80 @[800px]/workers-workspace:shadow-none">
    <div className="shrink-0 border-b border-border/60 p-4">
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{worker.title}</h3><p className="mt-1 text-[11px] text-muted-foreground">{[worker.workerName, worker.assistantName].filter(Boolean).join(" · ")}</p></div><button type="button" onClick={onClose} aria-label="关闭 Agent 详情" className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button></div>
      <p className="mt-2 text-[10px] text-muted-foreground">创建于 {new Date(worker.createdAt).toLocaleString()} · {worker.messageCount} 条消息</p>
      <button type="button" onClick={onOpen} className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border py-2 text-xs hover:bg-muted">打开完整会话<ArrowUpRight className="h-3.5 w-3.5" /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4"><AgentExecutionRecord requestKey={worker.id} load={load} live={worker.busy || worker.subagentStatus === "running"} /></div>
  </aside>;
}
