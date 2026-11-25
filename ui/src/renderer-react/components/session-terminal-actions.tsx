import * as React from 'react';
import { Link2, Plus, Terminal } from 'lucide-react';
import { DropdownMenuItem, DropdownMenuPortal, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from './ui/dropdown-menu';
import type { SessionSummary } from '../types';

const actions = [
  { action: 'terminal', label: '打开终端', icon: Terminal, description: '在当前工作目录打开终端' },
  { action: 'new', label: '新会话', icon: Plus, description: '在终端中启动新的 Moss CLI 会话' },
  { action: 'resume', label: '跟随会话', icon: Link2, description: '在终端中恢复当前 Moss 会话' },
] as const;

export function SessionTerminalActions({ session, onOpened }: { session?: SessionSummary | null; onOpened: () => void }) {
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
      onOpened();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingRef.current = false;
      setOpening(false);
    }
  };

  return <DropdownMenuSub>
    <DropdownMenuSubTrigger disabled={Boolean(disabledReason)} title={disabledReason || undefined}><Terminal />终端</DropdownMenuSubTrigger>
    <DropdownMenuPortal>
      <DropdownMenuSubContent aria-label="终端" collisionPadding={8} className="w-44">
        {actions.map(({ action, label, icon: Icon, description }) => {
          const reason = action === 'resume' ? resumeDisabledReason : disabledReason;
          return <DropdownMenuItem key={action} disabled={opening || Boolean(reason)} title={reason || description}
            onSelect={event => { event.preventDefault(); void open(action); }}>
            <Icon />{label}
          </DropdownMenuItem>;
        })}
        {error && <p role="alert" className="break-words px-2 py-1.5 text-xs text-destructive">{error}</p>}
      </DropdownMenuSubContent>
    </DropdownMenuPortal>
  </DropdownMenuSub>;
}
