import * as React from 'react';
import {
  CheckCircle2,
  Circle,
  CircleX,
  Loader2,
  MessageSquare,
  MessageSquareMore,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { filterAndSortProjectTasks } from '../../../shared/project-task-list.mjs';
import type { Project, ProjectTask } from '@/types';

type ProjectTasksTabProps = {
  project: Project;
  tasks: ProjectTask[];
  onOpenSession: (sessionId: string) => void;
  onNewSession: (project: Project) => void;
  onReload: () => Promise<void>;
};

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: '全部状态' },
  { value: 'working', label: '进行中' },
  { value: 'waiting_for_user', label: '等待你处理' },
  { value: 'failed', label: '失败' },
  { value: 'completed', label: '已回复' },
  { value: 'stopped', label: '未运行' },
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
  if (status === 'failed') return <CircleX className="h-4 w-4 text-destructive" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

export function ProjectTasksTab({
  project,
  tasks,
  onOpenSession,
  onNewSession,
  onReload,
}: ProjectTasksTabProps) {
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState('all');
  const [sort, setSort] = React.useState<'newest' | 'oldest' | 'updated' | 'status'>('newest');
  const [deletingTaskId, setDeletingTaskId] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const visibleTasks = React.useMemo(() => filterAndSortProjectTasks(tasks, {
    query,
    status: statusFilter,
    sort,
  }) as ProjectTask[], [query, sort, statusFilter, tasks]);

  React.useEffect(() => {
    setQuery('');
    setStatusFilter('all');
    setSort('newest');
    setError('');
  }, [project.id]);

  const deleteTask = async (task: ProjectTask) => {
    if (!window.confirm(`删除会话“${task.subject}”？该会话及其子会话记录将一并删除。`)) return;
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
      <section aria-label="发起项目会话" className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">会话继承项目默认配置，发送前可调整。</p>
        <Button onClick={() => onNewSession(project)}><MessageSquare className="h-4 w-4" />新会话</Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm font-medium text-foreground">
            会话 <span className="ml-1 font-normal text-muted-foreground">{visibleTasks.length}/{tasks.length}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-52">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="查询会话" className="pl-9" />
            </div>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="按会话状态过滤"
            >
              {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <select
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              aria-label="会话排序"
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
            {visibleTasks.map((task) => (
              <article key={task.id}>
                <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 transition-colors hover:bg-accent/30">
                  <button
                    type="button"
                    onClick={() => onOpenSession(task.sessionId)}
                    className="grid min-h-14 min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-2 text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <TaskStatusIcon status={task.status} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{task.subject}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatTime(task.createdAt)}</span>
                        {task.workerCount > 0 ? <span>{task.activeWorkerCount > 0 ? `${task.activeWorkerCount} 个子 Agent 运行中` : `${task.workerCount} 个子 Agent`}</span> : null}
                        {task.outputAssetIds.length > 0 ? <span>{task.outputAssetIds.length} 个成果</span> : null}
                      </div>
                    </div>
                    <span className={cn(
                      'text-xs',
                      task.status === 'failed' ? 'text-destructive' :
                        task.status === 'waiting_for_user' ? 'text-amber-700' : 'text-muted-foreground',
                    )}>
                      {taskStatusLabel(task.status)}
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <Button
                      variant={task.attentionCount > 0 || task.status === 'failed' ? 'outline' : 'ghost'}
                      size={task.attentionCount > 0 || task.status === 'failed' ? 'sm' : 'icon-sm'}
                      onClick={() => onOpenSession(task.sessionId)}
                      title={task.attentionCount > 0 ? '进入会话处理' : task.status === 'failed' ? '进入会话介入' : '进入会话'}
                    >
                      <MessageSquare className="h-4 w-4" />
                      {task.attentionCount > 0 ? '去处理' : task.status === 'failed' ? '介入' : null}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => void deleteTask(task)}
                      disabled={deletingTaskId !== null}
                      title="删除会话"
                      aria-label={`删除会话：${task.subject}`}
                    >
                      {deletingTaskId === task.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="flex min-h-28 items-center justify-center text-sm text-muted-foreground">
            {tasks.length > 0 ? '没有匹配的会话' : '暂无会话'}
          </div>
        )}
      </section>
    </div>
  );
}
