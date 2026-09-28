import * as React from 'react';
import { Link2, Plus, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { SessionSummary } from '../types';

const actions = [
  { action: 'terminal', label: '终端', icon: Terminal, description: '在当前工作目录打开终端' },
  { action: 'new', label: '新会话', icon: Plus, description: '在终端中启动新的 Moss CLI 会话' },
  { action: 'resume', label: '跟随会话', icon: Link2, description: '在终端中恢复当前 Moss 会话' },
] as const;

export function SessionTerminalActions({ session }: { session?: SessionSummary | null }) {
  const [opening, setOpening] = React.useState(false);
  const [error, setError] = React.useState('');
  const pendingRef = React.useRef(false);
  const disabledReason = !session ? '会话尚未加载完成'
    : session.agentMode === 'remote-direct' ? '内置终端仅支持本地会话' : '';
  const resumeDisabledReason = disabledReason || session?.resumeReadOnlyReason
    || (session?.busy ? '请等待当前回复完成后再跟随会话' : '')
    || (!session?.sessionId || !session?.messageCount ? '当前会话尚无可恢复的记录' : '');

  React.useEffect(() => { setError(''); }, [session?.id]);

  const open = async (action: typeof actions[number]['action']) => {
    if (!session || pendingRef.current) return;
    pendingRef.current = true;
    setOpening(true);
    setError('');
    try {
      await window.agentDesktop.openTerminal({ sessionId: session.id, action });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingRef.current = false;
      setOpening(false);
    }
  };

  return (
    <div className="relative inline-flex shrink-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full"
                  disabled={opening || Boolean(disabledReason)} aria-label="终端菜单">
                  <Terminal className={`h-4 w-4${opening ? ' animate-pulse' : ''}`} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                {actions.map(({ action, label, icon: Icon, description }) => {
                  const reason = action === 'resume' ? resumeDisabledReason : disabledReason;
                  return (
                    <DropdownMenuItem key={action} disabled={opening || Boolean(reason)}
                      title={reason || description} onSelect={() => void open(action)}>
                      <Icon className="h-4 w-4" />
                      {label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason || (opening ? '正在打开终端' : '终端')}</TooltipContent>
      </Tooltip>
      {error && (
        <div role="alert" className="absolute right-0 top-full z-50 mt-2 w-72 rounded-lg border border-destructive/30 bg-background p-3 text-xs text-destructive shadow-lg">
          {error}
          <button className="ml-2 underline" onClick={() => setError('')}>关闭</button>
        </div>
      )}
    </div>
  );
}
