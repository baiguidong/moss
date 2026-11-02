import * as React from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, RefreshCw, Terminal } from "lucide-react";
import { buildWorkerRenderMessagesFromSubagentEvents } from "@/lib/agent-transcript";
import { cn } from "@/lib/utils";
import type { AgentEvent } from "../types";

export function AgentExecutionRecord({ requestKey, load, live = false }: {
  requestKey: string; load: () => Promise<{ history: AgentEvent[] }>; live?: boolean;
}) {
  const [data, setData] = React.useState<{ key: string; history: AgentEvent[] } | null>(null);
  const [error, setError] = React.useState("");
  const [retry, setRetry] = React.useState(0);
  const [mode, setMode] = React.useState("output");
  const [limit, setLimit] = React.useState(60);
  React.useEffect(() => {
    let cancelled = false, pending = false;
    setError("");
    setLimit(60);
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await load();
        if (!cancelled) { setData({ key: requestKey, history: result.history }); setError(""); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "读取执行记录失败");
      } finally { pending = false; }
    };
    void refresh();
    const timer = live ? window.setInterval(refresh, 5000) : null;
    return () => { cancelled = true; if (timer !== null) window.clearInterval(timer); };
  }, [requestKey, load, live, retry]);
  const history = data?.key === requestKey ? data.history : null;
  const messages = React.useMemo(() => buildWorkerRenderMessagesFromSubagentEvents(history ?? []), [history]);
  const timestamps = (history ?? []).map(event => typeof event.timestamp === "number" ? event.timestamp : Date.parse(event.timestamp)).filter(Number.isFinite);
  const spanSeconds = timestamps.length > 1 ? Math.max(0, Math.round((timestamps.reduce((a, b) => Math.max(a, b), -Infinity) - timestamps.reduce((a, b) => Math.min(a, b), Infinity)) / 1000)) : null;
  const results = new Map(messages.filter(message => message.type === "tool_result").map(message => [message.toolUseId, message]));
  const output = messages.filter(message => message.type === "assistant_text").at(-1);
  const records = messages.filter(message => mode === "tools" ? message.type === "tool_use"
    : ["user_text", "assistant_text", "tool_use"].includes(message.type));
  return <div className="min-w-0 space-y-3" aria-label="Agent 执行记录">
    <div className="flex items-center gap-1" role="tablist" aria-label="执行记录内容">
      {[["output", "最新输出"], ["tools", "工具调用"], ["all", "全部记录"]].map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={mode === value} onClick={() => setMode(value)} className={cn("rounded-md px-2 py-1.5 text-[11px]", mode === value ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>{label}</button>)}
      <button type="button" className="ml-auto rounded-md p-1.5 hover:bg-muted" aria-label="刷新执行记录" onClick={() => setRetry(value => value + 1)}><RefreshCw className="h-3.5 w-3.5" /></button>
    </div>
    {history?.length ? <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span>{messages.filter(message => message.type === "tool_use").length} 次工具调用</span>{spanSeconds !== null ? <span title="首条到末条保留记录之间的时间，包含等待时间">记录跨度 {Math.floor(spanSeconds / 60)} 分 {spanSeconds % 60} 秒</span> : null}</div> : null}
    {error ? <div role="alert" className="break-words rounded-lg bg-destructive/5 p-3 text-xs text-destructive">{error}<button type="button" onClick={() => setRetry(value => value + 1)} className="ml-2 underline">重试</button></div> : null}
    {!history && !error ? <div role="status" className="flex items-center gap-2 py-6 text-xs text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取执行记录…</div>
      : history?.length === 0 ? <p className="py-4 text-xs text-muted-foreground">暂无可用的执行记录</p>
        : mode === "output" ? output?.type === "assistant_text" ? <pre className="whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/15 p-3 font-sans text-xs leading-5 [overflow-wrap:anywhere]">{output.content}</pre> : <p className="py-4 text-xs text-muted-foreground">尚未记录文字输出，可查看工具调用。</p>
          : <div className="space-y-2">
            {records.length > limit ? <button type="button" className="w-full rounded-lg border py-2 text-xs hover:bg-muted" onClick={() => setLimit(value => value + 60)}>显示更早记录（剩余 {records.length - limit} 条）</button> : null}
            {records.slice(-limit).map(message => {
              if (message.type === "tool_use") {
                const result = results.get(message.toolUseId);
                return <details key={message.id} className="rounded-lg border border-border/60 bg-background">
                  <summary className="flex cursor-pointer items-center gap-2 p-2.5 text-xs">
                    {result?.isError ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" /> : result ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate font-medium">{message.displayName || message.toolName}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{result ? result.isError ? "失败" : "完成" : "未记录结果"}</span>
                  </summary>
                  <div className="space-y-2 border-t border-border/60 p-2.5 text-[11px]">
                    <div className="font-medium text-muted-foreground">输入</div><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.inputText || JSON.stringify(message.input ?? {}, null, 2)}</pre>
                    {result ? <><div className="font-medium text-muted-foreground">结果</div><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{result.content}</pre></> : null}
                  </div>
                </details>;
              }
              if (message.type !== "user_text" && message.type !== "assistant_text") return null;
              return <details key={message.id} className="rounded-lg border border-border/60 p-2.5 text-xs">
                <summary className="cursor-pointer font-medium">{message.type === "user_text" ? "任务输入" : "Agent 输出"} <span className="ml-1 font-normal text-muted-foreground">{message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></summary>
                <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-5 [overflow-wrap:anywhere]">{message.content}</pre>
              </details>;
            })}
            {records.length === 0 ? <p className="py-4 text-xs text-muted-foreground">暂无工具调用</p> : null}
          </div>}
  </div>;
}
