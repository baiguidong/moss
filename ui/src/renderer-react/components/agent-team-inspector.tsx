import * as React from "react";
import { Expand, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MEMBER_ACTIVITY_LABELS, memberRelations, messagesForMember, tasksForMember, visibleTeamMessages, type TeamMemberView } from "@/lib/agent-team-members";
import { AgentExecutionRecord } from "./agent-execution-record";
import type { AgentTeamRun, AgentTeamSnapshot } from "../types";

export function AgentTeamInspector({ sessionId, run, snapshot, frame, member, members, onSelect, onClose }: {
  sessionId: string; run: AgentTeamRun; snapshot: AgentTeamSnapshot; frame: number;
  member: TeamMemberView | null; members: TeamMemberView[];
  onSelect: (id: string) => void; onClose: () => void;
}) {
  const [tab, setTab] = React.useState("tasks");
  const [expanded, setExpanded] = React.useState(false);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const dialogTitle = React.useId();
  React.useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else dialog.current?.close();
  }, [expanded]);
  const tasks = member ? tasksForMember(snapshot.tasks, member) : [];
  const messages = member ? messagesForMember(snapshot.messages, member) : visibleTeamMessages(snapshot.messages);
  const relations = member ? memberRelations(member, members, snapshot) : [];
  const memberId = member?.agentId;
  const load = React.useCallback(() => window.agentDesktop.agentTeams.memberHistory({ sessionId, incarnationId: run.incarnationId, memberId: memberId!, frame }), [sessionId, run.incarnationId, memberId, frame]);
  const requestKey = `${sessionId}:${run.incarnationId}:${memberId}:${frame}`;
  const live = run.status === "live" && frame === run.snapshots.length - 1;
  return <aside aria-label={member ? `${member.name} 的详情` : "团队协作消息"} className="absolute inset-y-0 right-0 z-20 flex w-[min(360px,100%)] shrink-0 flex-col border-l border-border bg-background shadow-xl @[800px]/agent-workspace:static @[800px]/agent-workspace:w-80 @[800px]/agent-workspace:shadow-none">
    <div className="shrink-0 border-b border-border/60 p-4">
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h3 className="break-words text-sm font-semibold">{member?.name ?? "团队协作消息"}</h3><p className="mt-1 text-[11px] text-muted-foreground">{member ? `${MEMBER_ACTIVITY_LABELS[member.activity]}${!member.present ? " · 已退出团队" : ""}` : run.teamName}</p></div><button type="button" aria-label="关闭 Agent 详情" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button></div>
      {member ? <><p className="mt-2 break-words text-[10px] text-muted-foreground">{[member.agentType, member.model].filter(Boolean).join(" · ")}</p><div className="mt-3 flex gap-1" role="tablist" aria-label="成员详情内容">
        {[["tasks", `任务 ${tasks.length}`], ["activity", "执行记录"], ["messages", `消息 ${messages.length}`]].map(([value, label]) => <button key={value} role="tab" type="button" aria-selected={tab === value} onClick={() => setTab(value)} className={cn("rounded-md px-2 py-1.5 text-[11px]", tab === value ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>{label}</button>)}
      </div></> : null}
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {member && tab === "tasks" ? <div className="space-y-4">
        <h4 className="text-xs font-medium">{member.name} 的任务</h4>
        {tasks.map(task => <details key={task.id} open className="rounded-lg border border-border/70 p-3 text-xs">
          <summary className="cursor-pointer font-medium leading-5">#{task.id} {task.subject}</summary>
          <div className={cn("mt-2 text-[10px]", task.status === "completed" ? "text-emerald-600 dark:text-emerald-400" : task.blocked ? "text-amber-600" : "text-muted-foreground")}>{task.status === "completed" ? "已完成" : task.blocked ? "等待依赖" : task.status === "in_progress" ? "进行中" : "已分配"}</div>
          {task.description ? <p className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-muted-foreground">{task.description}</p> : null}
          {task.blockedBy.length > 0 ? <p className="mt-2 text-[10px] text-muted-foreground">依赖：{task.blockedBy.map(id => `#${id} ${snapshot.tasks.find(item => item.id === id)?.subject ?? ""}`).join("、")}</p> : null}
        </details>)}
        {tasks.length === 0 ? <p className="text-xs text-muted-foreground">暂无已分配任务</p> : null}
        {relations.length ? <div className="space-y-2 border-t border-border/60 pt-3"><h4 className="text-xs font-medium">协作关系</h4>{relations.map(relation => <button key={relation.member.agentId} type="button" onClick={() => onSelect(relation.member.agentId)} className="flex w-full flex-col gap-1 rounded-lg bg-muted/30 p-2.5 text-left text-xs hover:bg-muted"><span className="font-medium">{relation.member.name}</span><span className="text-[10px] text-muted-foreground">{[relation.upstream ? `依赖对方 ${relation.upstream} 个任务` : "", relation.downstream ? `对方依赖 ${relation.downstream} 个任务` : "", relation.messages ? `${relation.messages} 条往来消息` : ""].filter(Boolean).join(" · ")}</span></button>)}</div> : null}
      </div> : member && tab === "activity" ? <>
        <button type="button" onClick={() => setExpanded(true)} className="mb-3 flex w-full items-center justify-center gap-1 rounded-lg border py-2 text-xs hover:bg-muted"><Expand className="h-3.5 w-3.5" />展开执行记录</button>
        {!expanded ? <AgentExecutionRecord requestKey={requestKey} load={load} live={live} /> : null}
      </> : <div className="space-y-3">
        {[...messages].reverse().map(message => <details key={message.id} className="rounded-lg border border-border/60 p-3 text-xs">
          <summary className="cursor-pointer list-none"><span className="block text-[10px] text-muted-foreground">{message.from} → {message.to} · {new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span><span className="mt-1.5 block line-clamp-3 leading-5">{message.summary || message.text}</span></summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words border-t border-border/60 pt-2 font-sans text-[11px] leading-5 [overflow-wrap:anywhere]">{message.text}</pre>
        </details>)}
        {messages.length === 0 ? <p className="text-xs text-muted-foreground">暂无协作消息</p> : null}
      </div>}
    </div>
    <dialog ref={dialog} aria-labelledby={dialogTitle} onClose={() => setExpanded(false)} className="m-auto h-[85vh] w-[92vw] max-w-4xl flex-col overflow-hidden rounded-xl border border-border bg-background p-5 text-foreground shadow-2xl backdrop:bg-black/40 open:flex">
      <div className="mb-4 flex items-center justify-between gap-2"><h3 id={dialogTitle} className="text-sm font-semibold">{member?.name} · 执行记录</h3><button type="button" autoFocus aria-label="关闭展开的执行记录" onClick={() => setExpanded(false)} className="rounded-md p-1 hover:bg-muted"><X className="h-4 w-4" /></button></div><div className="min-h-0 flex-1 overflow-y-auto">{expanded ? <AgentExecutionRecord requestKey={requestKey} load={load} live={live} /> : null}</div>
    </dialog>
  </aside>;
}
