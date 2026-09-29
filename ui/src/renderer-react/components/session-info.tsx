import * as React from 'react';
import { Check, Copy, Info, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copyToClipboard } from '@/components/chat/clipboard';
import { getPermissionModeLabel } from '@/components/permission-mode-selector';
import { buildSessionInfo, formatSessionDuration } from '@/lib/session-info';
import type { TranscriptRenderMessage } from '@/lib/agent-transcript';
import type { BackgroundTaskInfo, SessionDetail, SessionRecordedUsage, SessionSummary } from '../types';

type SessionInfoProps = {
  session: SessionDetail;
  messages: TranscriptRenderMessage[];
  childSessions?: SessionSummary[];
  backgroundTasks?: BackgroundTaskInfo[];
};

const number = (value: number | undefined) => value === undefined ? '暂无记录' : value.toLocaleString('zh-CN');
const date = (value: number) => Number.isFinite(value) && value > 0 ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无记录';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 py-1.5 text-xs leading-5">
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</dd>
  </div>;
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  return <span className="inline-flex max-w-full items-start gap-1">
    <span className="min-w-0 font-mono text-[11px] [overflow-wrap:anywhere]">{value}</span>
    <button type="button" className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      aria-label={copied ? '已复制' : `复制 ${value}`} onClick={async () => {
        const ok = await copyToClipboard(value);
        setCopied(ok);
        setFailed(!ok);
      }}>
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
    {failed && <span role="status" className="text-destructive">复制失败</span>}
  </span>;
}

export function SessionInfoContent({ session, messages, childSessions = [], backgroundTasks = [], recordedUsage = null, usageLoading = false, usageError = false }: SessionInfoProps & {
  recordedUsage?: SessionRecordedUsage | null;
  usageLoading?: boolean;
  usageError?: boolean;
}) {
  const info = React.useMemo(() => buildSessionInfo(session.history), [session.history]);
  const usage = recordedUsage ?? info.historyUsage;
  const userTurns = new Set(messages.filter((message) => message.type === 'user_text').map((message) => message.id)).size;
  const tasks = session.tasks ?? [];
  const status = session.resumeReadOnlyReason ? '只读'
    : session.pendingPlanApproval ? '等待计划确认'
    : session.busy ? '运行中'
    : session.subagentStatus === 'failed' ? '失败'
    : session.subagentStatus === 'completed' || session.completedAt ? '已完成' : '空闲';
  const sourceLabel = recordedUsage
    ? '本会话用量账本；仅含已记录请求，不含分叉前及独立子会话用量。'
    : '按已保留的会话历史统计；可能不完整，分叉会话包含继承的历史用量。';

  return <div className="space-y-6 p-5">
    <section aria-label="会话概览" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[
        ['累计 Token', number(usage?.totals.totalTokens)],
        ['模型请求', number(usage?.totals.requestCount)],
        ['对话轮次', number(userTurns)],
        ['工具调用', number(info.tools.total)],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3">
        <div className="text-[11px] text-muted-foreground">{label}</div>
        <div className="mt-1 break-words text-lg font-semibold tabular-nums">{value}</div>
      </div>)}
    </section>

    <section aria-labelledby="session-info-tokens">
      <h3 id="session-info-tokens" className="mb-2 text-sm font-medium">Token 用量</h3>
      <p className="mb-3 text-[11px] leading-5 text-muted-foreground">
        {usageLoading ? '正在读取用量账本… ' : usageError ? '用量账本暂不可用。' : ''}{sourceLabel}
      </p>
      <dl className="grid grid-cols-2 gap-x-5 gap-y-2 rounded-xl bg-muted/20 p-3 text-xs">
        {[
          ['输入', usage?.totals.inputTokens], ['输出', usage?.totals.outputTokens],
          ['缓存读取', usage?.totals.cacheReadTokens], ['缓存写入', usage?.totals.cacheWriteTokens],
        ].map(([label, value]) => <div key={String(label)} className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{number(value as number | undefined)}</dd>
        </div>)}
      </dl>
      <dl className="mt-2">
        <Field label="最近上下文">{number(info.latestContext?.totalTokens)}{info.latestContext ? ' Token（约）' : ''}</Field>
      </dl>
      <p className="text-[11px] leading-5 text-muted-foreground">上下文取最近一次主线程模型请求的输入、缓存及输出；累计用量为多次请求之和。</p>
      {usage && usage.models.length > 0 && <details className="mt-3 rounded-lg border border-border/60 px-3 py-2">
        <summary className="cursor-pointer text-xs text-muted-foreground">按模型查看（{usage.models.length}）</summary>
        <div className="mt-2 max-h-40 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-foreground"><tr><th className="py-1 font-normal">模型</th><th className="px-2 text-right font-normal">请求</th><th className="text-right font-normal">Token</th></tr></thead>
            <tbody>{usage.models.map((model) => <tr key={model.model} className="border-t border-border/40">
              <td className="max-w-64 break-all py-2 pr-2">{model.model}</td><td className="px-2 text-right tabular-nums">{number(model.requestCount)}</td><td className="text-right tabular-nums">{number(model.totalTokens)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      </details>}
    </section>

    <section aria-labelledby="session-info-tools">
      <h3 id="session-info-tools" className="mb-2 text-sm font-medium">工具调用</h3>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>成功 <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{number(info.tools.success)}</span></span>
        <span>失败 <span className={info.tools.error ? 'tabular-nums text-destructive' : 'tabular-nums'}>{number(info.tools.error)}</span></span>
        <span className="text-muted-foreground">未完成／未知 {number(info.tools.unknown)}</span>
      </div>
      {info.tools.rows.length > 0 ? <div className="max-h-56 overflow-auto rounded-xl border border-border/60">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-card text-muted-foreground"><tr>
            <th className="px-3 py-2 font-normal">工具</th><th className="px-2 text-right font-normal">次数</th><th className="px-2 text-right font-normal">失败</th><th className="whitespace-nowrap px-3 text-right font-normal">平均耗时</th>
          </tr></thead>
          <tbody>{info.tools.rows.map((tool) => <tr key={tool.name} className="border-t border-border/40">
            <td className="max-w-60 break-all px-3 py-2 font-mono text-[11px]">{tool.name}</td>
            <td className="px-2 text-right tabular-nums">{number(tool.total)}</td>
            <td className="px-2 text-right tabular-nums">{number(tool.error)}</td>
            <td className="whitespace-nowrap px-3 text-right tabular-nums" title={`${tool.timedCount} 次调用有耗时记录`}>{formatSessionDuration(tool.timedCount ? tool.durationMs / tool.timedCount : null)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <p className="rounded-xl bg-muted/20 p-3 text-xs text-muted-foreground">暂无工具调用</p>}
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">统计当前历史中的调用，含记录在其中的子代理调用；独立子会话单独统计。耗时仅计有起止时间的已完成调用。</p>
    </section>

    <section aria-labelledby="session-info-basic">
      <h3 id="session-info-basic" className="mb-2 text-sm font-medium">基本信息</h3>
      <dl>
        <Field label="会话名称">{session.title || '新会话'}</Field>
        <Field label="状态">{status}</Field>
        <Field label="运行位置">{session.agentMode === 'remote-direct' ? '云端' : '本地'}</Field>
        <Field label="当前模型">{info.currentModel || '暂无记录'}</Field>
        <Field label="会话模式">{session.runtimeMode === 'project-coordinator' ? '项目协作' : session.runtimeMode === 'coordinator' || session.composerIntent === 'boss' ? 'Boss 协作' : '普通对话'}</Field>
        <Field label="权限模式">{getPermissionModeLabel(session.permissionMode)}</Field>
        <Field label="工作目录">{session.workspace ? <CopyValue value={session.workspace} /> : '未设置'}</Field>
        {session.projectName && <Field label="所属项目">{session.projectName}</Field>}
        {session.assistantName && <Field label="使用专家">{session.assistantName}</Field>}
        <Field label="创建时间">{date(session.createdAt)}</Field>
        <Field label="最近更新">{date(session.updatedAt)}</Field>
        <Field label="最近一轮耗时">{formatSessionDuration(info.lastTurnDurationMs)}</Field>
        <Field label="会话 ID"><CopyValue value={session.id} /></Field>
        {session.sessionId && session.sessionId !== session.id && <Field label="运行会话 ID"><CopyValue value={session.sessionId} /></Field>}
        {session.sourceSessionId && <Field label="来源会话"><CopyValue value={session.sourceSessionId} /></Field>}
        {session.parentSessionId && <Field label="主会话"><CopyValue value={session.parentSessionId} /></Field>}
        {session.resumeReadOnlyReason && <Field label="只读原因">{session.resumeReadOnlyReason}</Field>}
      </dl>
    </section>

    <section aria-labelledby="session-info-related">
      <h3 id="session-info-related" className="mb-2 text-sm font-medium">任务与资源</h3>
      <dl>
        <Field label="会话来源">{session.sessionKind === 'cron' ? '定时任务' : session.sessionKind === 'agent-mail' ? 'Agent 邮件' : '聊天'}{session.originChannel ? ` · ${session.originChannel}` : ''}</Field>
        <Field label="任务进度">{tasks.filter((task) => task.status === 'completed').length} / {tasks.length} 已完成</Field>
        <Field label="子会话">{childSessions.length} 个 · {childSessions.filter((child) => child.busy).length} 个运行中</Field>
        <Field label="后台任务">{backgroundTasks.length} 个 · {backgroundTasks.filter((task) => task.status === 'running').length} 个运行中</Field>
        <Field label="连接器">{session.connectorIds?.length ?? 0} 个</Field>
        <Field label="上下文压缩">{info.compactionCount} 次（当前历史记录）</Field>
      </dl>
    </section>
  </div>;
}

function LiveSessionInfo(props: SessionInfoProps) {
  const { session } = props;
  const [recordedUsage, setRecordedUsage] = React.useState<SessionRecordedUsage | null>(null);
  const [loading, setLoading] = React.useState(session.agentMode !== 'remote-direct');
  const [error, setError] = React.useState(false);
  const [refresh, setRefresh] = React.useState(0);
  React.useEffect(() => {
    if (session.agentMode === 'remote-direct') return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const load = async () => {
      setLoading(true);
      try {
        const data = await window.agentDesktop.usage.getSession({ sessionId: session.id });
        if (!cancelled) { setRecordedUsage(data); setError(false); }
      } catch {
        if (!cancelled) { setRecordedUsage(null); setError(true); }
      } finally {
        if (!cancelled) { setLoading(false); timeout = setTimeout(load, 5000); }
      }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timeout); };
  }, [session.id, session.agentMode, session.busy, refresh]);

  return <>
    {error && <div className="px-5 pt-3 text-xs text-muted-foreground" role="status">
      账本读取失败，已切换为历史统计。
      <Button variant="ghost" size="sm" className="ml-2 h-6 gap-1 px-2 text-xs" onClick={() => setRefresh((value) => value + 1)}><RefreshCw className="h-3 w-3" />重试</Button>
    </div>}
    <SessionInfoContent {...props} recordedUsage={recordedUsage} usageLoading={loading} usageError={error} />
  </>;
}

export function SessionInfoButton({ session, ...props }: Omit<SessionInfoProps, 'session'> & { session?: SessionDetail | null }) {
  const [open, setOpen] = React.useState(false);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  React.useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return <>
    <Tooltip>
      <TooltipTrigger asChild>
        <Button ref={trigger} variant="ghost" size="icon" className="h-8 w-8 rounded-full" disabled={!session}
          aria-label="查看会话信息" aria-haspopup="dialog" onClick={() => setOpen(true)}><Info className="h-4 w-4" /></Button>
      </TooltipTrigger>
      <TooltipContent>会话信息</TooltipContent>
    </Tooltip>
    <dialog ref={dialog} aria-labelledby={titleId} onClose={() => { setOpen(false); trigger.current?.focus({ preventScroll: true }); }}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="m-auto max-h-[calc(100dvh-64px)] w-[min(640px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl backdrop:bg-black/35 backdrop:backdrop-blur-sm">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-card px-5 py-3">
        <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold"><Info className="h-4 w-4 text-muted-foreground" />会话信息</h2>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" aria-label="关闭会话信息" onClick={() => dialog.current?.close()}><X className="h-4 w-4" /></Button>
      </div>
      {open && session && <LiveSessionInfo key={session.id} {...props} session={session} />}
    </dialog>
  </>;
}
