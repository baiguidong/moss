"use client";

import * as React from 'react';
import { AlertCircle, CheckCircle2, CircleDot, Inbox, MessageCircleQuestion, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PendingWorkItem, PendingWorkState } from '@/lib/pending-work-items';

const stateMeta: Record<PendingWorkState, { label: string; iconClassName: string }> = {
  attention: { label: '需要处理', iconClassName: 'bg-amber-500 dark:bg-amber-400' },
  review: { label: '新结果', iconClassName: 'bg-primary' },
  progress: { label: '进行中', iconClassName: 'bg-primary' },
  done: { label: '已完成', iconClassName: 'bg-emerald-600 dark:bg-emerald-400' },
};

const sourceMeta = {
  question: { label: '需要回答', icon: MessageCircleQuestion },
  approval: { label: '需要确认', icon: ShieldCheck },
  result: { label: '新结果', icon: Inbox },
  failure: { label: '运行异常', icon: AlertCircle },
} as const;

type GroupMode = 'status' | 'project';

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Date.now() - timestamp);
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

function WorkItemRow({ item, onOpen, hideContext }: { item: PendingWorkItem; onOpen: (item: PendingWorkItem) => void; hideContext?: boolean }) {
  const meta = stateMeta[item.state];
  const SourceIcon = sourceMeta[item.source].icon;
  const descriptor = item.state === 'progress' || item.state === 'done'
    ? meta.label
    : item.source === 'failure' ? '运行异常' : sourceMeta[item.source].label;
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group flex w-full min-w-0 items-center gap-2 border-b border-border/55 px-2.5 py-2.5 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-pending-work-item={item.id}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', item.source === 'failure' ? 'bg-destructive' : meta.iconClassName)} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{item.title}</span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{formatRelativeTime(item.createdAt)}</span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <SourceIcon className={cn('h-3 w-3 shrink-0', item.source === 'failure' ? 'text-destructive' : 'text-muted-foreground')} />
          <span className="truncate">{item.summary}</span>
          <span className="shrink-0 text-muted-foreground/50">·</span>
          <span className={cn('shrink-0', item.source === 'failure' ? 'text-destructive' : 'text-muted-foreground')}>{descriptor}</span>
          {!hideContext && item.context ? <><span className="shrink-0 text-muted-foreground/50">·</span><span className="truncate text-muted-foreground/75">{item.context}</span></> : null}
        </span>
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">打开</span>
    </button>
  );
}

export function PendingWorkPanel({ items, onOpen }: { items: PendingWorkItem[]; onOpen: (item: PendingWorkItem) => void }) {
  const [groupMode, setGroupMode] = React.useState<GroupMode>('status');
  const [doneOpen, setDoneOpen] = React.useState(false);
  const actionableCount = items.filter((item) => item.state === 'attention' || item.state === 'review').length;
  const statusGroups = [
    { key: 'actionable', title: '需要你处理', items: items.filter((item) => item.state === 'attention' || item.state === 'review') },
    { key: 'progress', title: '进行中', items: items.filter((item) => item.state === 'progress') },
    { key: 'done', title: '最近完成', items: items.filter((item) => item.state === 'done') },
  ].filter((group) => group.items.length > 0);
  const projectGroups = Array.from(new Set(items.map((item) => item.context || '未归类')))
    .map((context) => ({ key: context, title: context, items: items.filter((item) => (item.context || '未归类') === context) }));
  const groups = groupMode === 'status' ? statusGroups : projectGroups;
  const visibleGroups = groupMode === 'status' ? groups.filter((group) => group.key !== 'done' || doneOpen) : groups;
  const doneCount = statusGroups.find((group) => group.key === 'done')?.items.length || 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background" data-pending-work-panel>
      <header className="shrink-0 border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-primary" />
          <h1 className="text-sm font-semibold text-foreground">待处理</h1>
          {actionableCount > 0 ? <span className="text-[11px] font-medium text-primary">{actionableCount} 项需要你处理</span> : <span className="text-[11px] text-muted-foreground">任务进展</span>}
          <div className="ml-auto flex items-center rounded-md border border-border/70 bg-muted/25 p-0.5" role="group" aria-label="任务分组方式">
            {(['status', 'project'] as const).map((mode) => (
              <button key={mode} type="button" onClick={() => setGroupMode(mode)} className={cn('rounded px-1.5 py-1 text-[10px] transition-colors', groupMode === mode ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {mode === 'status' ? '按状态' : '按项目'}
              </button>
            ))}
          </div>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {visibleGroups.length > 0 ? visibleGroups.map((group) => (
          <section key={group.key} className="mb-3 last:mb-0" aria-label={group.title}>
            <div className="mb-0.5 flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-medium text-muted-foreground">
              <span>{group.title}</span><span className="text-muted-foreground/60">{group.items.length}</span>
            </div>
            {group.items.map((item) => <WorkItemRow key={item.id} item={item} onOpen={onOpen} hideContext={groupMode === 'project'} />)}
          </section>
        )) : (
          <div className="flex h-56 flex-col items-center justify-center gap-2 text-muted-foreground">
            <CheckCircle2 className="h-6 w-6 text-emerald-600/70 dark:text-emerald-400/70" />
            <span className="text-xs">现在没有待处理事项</span>
            <span className="text-[10px]">需要介入的任务会显示在这里</span>
          </div>
        )}
        {groupMode === 'status' && doneCount > 0 ? (
          <button type="button" className="mt-2 w-full px-2.5 py-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground" onClick={() => setDoneOpen((open) => !open)}>
            {doneOpen ? '收起最近完成' : `显示最近完成（${doneCount}）`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

