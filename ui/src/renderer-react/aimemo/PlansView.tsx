/**
 * 规划页 - 聚合待办,支持设提醒 / 交给 AI 执行
 */

import * as React from 'react';
import { Loader2, Bot, CheckCircle2, Circle, Flag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { aiMemoAPI } from './ipc/aiMemo.ipc';
import type { MemoTask } from './ipc/types';

interface PlansViewProps {
  onRunTaskWithAgent?: (prompt: string, title: string) => Promise<string | null>;
}

const priorityColor: Record<string, string> = {
  high: 'text-red-500',
  med: 'text-amber-500',
  low: 'text-slate-400',
};

export function PlansView({ onRunTaskWithAgent }: PlansViewProps) {
  const [tasks, setTasks] = React.useState<MemoTask[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [runningId, setRunningId] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await aiMemoAPI.getTasks();
      setTasks(data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggleDone = async (task: MemoTask) => {
    await aiMemoAPI.updateTask({ id: task.id, status: task.status === 'done' ? 'pending' : 'done' });
    load();
  };

  const runWithAgent = async (task: MemoTask) => {
    if (!onRunTaskWithAgent) return;
    setRunningId(task.id);
    try {
      const { prompt, error } = await aiMemoAPI.buildTaskPrompt(task.id);
      if (error || !prompt) return;
      const sessionId = await onRunTaskWithAgent(prompt, task.title);
      await aiMemoAPI.updateTask({
        id: task.id,
        status: 'running',
        kind: 'agent',
        agentSessionId: sessionId,
      });
      load();
    } finally {
      setRunningId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">还没有待办,AI 会从备忘里自动提取</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-3xl space-y-2">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3">
            <button onClick={() => toggleDone(task)} className="mt-0.5">
              {task.status === 'done' ? (
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground" />
              )}
            </button>

            <div className="min-w-0 flex-1">
              <div className={cn('text-sm font-medium', task.status === 'done' && 'text-muted-foreground line-through')}>
                <Flag className={cn('mr-1 inline h-3 w-3', priorityColor[task.priority])} />
                {task.title}
              </div>
              {task.detail && <div className="text-xs text-muted-foreground">{task.detail}</div>}
              <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground/70">
                {task.due_at && <span>截止 {new Date(task.due_at).toLocaleString()}</span>}
                {task.status === 'running' && <span className="text-blue-500">执行中</span>}
                {task.noteSummary && <span className="truncate">来自:{task.noteSummary}</span>}
              </div>
            </div>

            {onRunTaskWithAgent && task.status !== 'done' && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1"
                disabled={runningId === task.id}
                onClick={() => runWithAgent(task)}
              >
                {runningId === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Bot className="h-3.5 w-3.5" />}
                交给 AI
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default PlansView;
