import * as React from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleX,
  Loader2,
  MessageSquare,
  MessageSquareMore,
  Search,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { filterAndSortProjectTasks } from '../../../shared/project-task-list.mjs';
import type { Project, ProjectTask } from '@/types';

type ProjectTasksTabProps = {
  project: Project;
  tasks: ProjectTask[];
  onOpenSession: (sessionId: string) => void;
  onShowDecisions: () => void;
  onReload: () => Promise<void>;
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'working', label: '进行中' },
  { value: 'waiting_for_user', label: '等待判断' },
  { value: 'failed', label: '失败' },
  { value: 'completed', label: '已完成' },
  { value: 'stopped', label: '已停止' },
];

function formatTime(timestamp?: number | null) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function taskStatusLabel(status: ProjectTask['status']) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label || '进行中';
}

function TaskStatusIcon({ status }: { status: ProjectTask['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === 'working') return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === 'waiting_for_user') return <MessageSquareMore className="h-4 w-4 text-amber-600" />;
  if (status === 'failed' || status === 'stopped') return <CircleX className="h-4 w-4 text-destructive" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export function ProjectTasksTab({
  project,
  tasks,
  onOpenSession,
  onShowDecisions,
  onReload,
}: ProjectTasksTabProps) {
  const [prompt, setPrompt] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [sort, setSort] = React.useState<'newest' | 'oldest' | 'updated' | 'status'>('newest');
  const [expandedTaskIds, setExpandedTaskIds] = React.useState<Set<string>>(() => new Set());
  const [stoppingTaskId, setStoppingTaskId] = React.useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const visibleTasks = React.useMemo(() => filterAndSortProjectTasks(tasks, {
    query,
    status: statusFilter,
    sort,
  }) as ProjectTask[], [query, sort, statusFilter, tasks]);

  React.useEffect(() => {
    setPrompt('');
    setQuery('');
    setStatusFilter('all');
    setSort('newest');
    setExpandedTaskIds(new Set());
    setError('');
  }, [project.id]);

  const createTask = async () => {
    const taskPrompt = prompt.trim();
    if (!taskPrompt || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await window.agentDesktop.createProjectTask({
        projectId: project.id,
        task: { prompt: taskPrompt },
      });
      setPrompt('');
      await onReload();
      if (result.session?.id) onOpenSession(result.session.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDetails = (taskId: string) => {
    setExpandedTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const stopTask = async (task: ProjectTask) => {
    setStoppingTaskId(task.id);
    setError('');
    try {
      await window.agentDesktop.abort({ sessionId: task.sessionId });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStoppingTaskId(null);
    }
  };

  const deleteTask = async (task: ProjectTask) => {
    if (!window.confirm(`删除任务记录“${task.subject}”？关联会话和子会话记录将一并删除。`)) return;
    setDeletingTaskId(task.id);
    setError('');
    try {
      await window.agentDesktop.deleteSession({ sessionId: task.sessionId });
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingTaskId(null);
    }
  };

  return (
    <div className="grid min-h-0 gap-5">
      <section aria-label="创建项目任务">
        <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
          <Textarea
            value={prompt}
            rows={2}
            maxLength={20000}
            autoFocus
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void createTask();
              }
            }}
            placeholder="描述希望项目完成的事情..."
            disabled={submitting}
            className="min-h-[76px] max-h-[160px] resize-none border-0 bg-transparent px-4 pb-2 pt-3 text-sm leading-6 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-end justify-end border-t border-border/60 px-3 py-2.5">
            <Button size="sm" onClick={() => void createTask()} disabled={!prompt.trim() || submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? '创建中' : '发送'}
            </Button>
          </div>
        </div>
        {error ? <div className="mt-2 text-xs text-destructive">{error}</div> : null}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">
            任务 <span className="ml-1 font-normal text-muted-foreground">{visibleTasks.length}/{tasks.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-52">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查询任务" className="pl-9" />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="按任务状态过滤"
            >
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="任务排序"
            >
              <option value="newest">最新创建</option>
              <option value="updated">最近更新</option>
              <option value="oldest">最早创建</option>
              <option value="status">按状态</option>
            </select>
          </div>
        </div>

        {visibleTasks.length > 0 ? (
          <div className="divide-y divide-border/70 border-y border-border">
            {visibleTasks.map((task) => {
              const expanded = expandedTaskIds.has(task.id);
              return (
                <article key={task.id}>
                  <div className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-2 py-2 transition-colors hover:bg-accent/30">
                    <TaskStatusIcon status={task.status} />
                    <button
                      type="button"
                      onClick={() => toggleDetails(task.id)}
                      className="min-w-0 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="truncate text-sm font-medium text-foreground">{task.subject}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatTime(task.createdAt)}</span>
                        {task.workerCount > 0 ? <span>{task.activeWorkerCount > 0 ? `${task.activeWorkerCount} 个子 Agent 运行中` : `${task.workerCount} 个子 Agent`}</span> : null}
                        {task.outputAssetIds.length > 0 ? <span>{task.outputAssetIds.length} 个资产</span> : null}
                      </div>
                    </button>
                    <span className={cn(
                      'text-xs',
                      task.status === 'failed' || task.status === 'stopped' ? 'text-destructive' :
                        task.status === 'waiting_for_user' ? 'text-amber-700' : 'text-muted-foreground',
                    )}>
                      {taskStatusLabel(task.status)}
                    </span>
                    <div className="flex items-center gap-1">
                      {task.attentionCount > 0 ? (
                        <Button variant="outline" size="sm" onClick={onShowDecisions}>处理判断</Button>
                      ) : null}
                      {['working', 'waiting_for_user'].includes(task.status) ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void stopTask(task)}
                          disabled={stoppingTaskId !== null}
                          title="停止任务"
                          aria-label={`停止任务：${task.subject}`}
                        >
                          {stoppingTaskId === task.id
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Square className="h-4 w-4" />}
                        </Button>
                      ) : null}
                      <Button
                        variant={task.status === 'failed' ? 'outline' : 'ghost'}
                        size={task.status === 'failed' ? 'sm' : 'icon-sm'}
                        onClick={() => onOpenSession(task.sessionId)}
                        title={task.status === 'failed' ? '进入会话介入' : '进入任务会话'}
                      >
                        <MessageSquare className="h-4 w-4" />
                        {task.status === 'failed' ? '介入' : null}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => void deleteTask(task)}
                        disabled={deletingTaskId !== null}
                        title="删除任务记录"
                        aria-label={`删除任务记录：${task.subject}`}
                      >
                        {deletingTaskId === task.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => toggleDetails(task.id)}
                        title={expanded ? '收起详情' : '查看详情'}
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} />
                      </Button>
                    </div>
                  </div>
                  {expanded ? (
                    <div className="grid gap-3 bg-muted/20 px-9 py-4 text-sm">
                      <div>
                        <div className="mb-1 text-xs font-medium text-foreground">任务要求</div>
                        <div className="whitespace-pre-wrap leading-6 text-muted-foreground">{task.description || '暂无任务描述'}</div>
                      </div>
                      {task.conclusion ? (
                        <div>
                          <div className="mb-1 text-xs font-medium text-foreground">任务结论</div>
                          <div className="whitespace-pre-wrap leading-6 text-foreground">{task.conclusion}</div>
                        </div>
                      ) : null}
                      {task.error ? <div className="leading-6 text-destructive">{task.error}</div> : null}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>根会话 {task.sessionId.slice(0, 8)}</span>
                        {task.workerCount > 0 ? <span>{task.workerCount} 个子 Agent</span> : null}
                        {task.completedAt ? <span>完成于 {formatTime(task.completedAt)}</span> : null}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
            {tasks.length > 0 ? '没有匹配的任务' : '暂无任务'}
          </div>
        )}
      </section>
    </div>
  );
}
