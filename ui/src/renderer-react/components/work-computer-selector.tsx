import * as React from 'react';
import { Cloud, Laptop, ChevronDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

export function WorkComputerSelector({ collapsed = false }: { collapsed?: boolean }) {
  const web = Boolean(typeof window !== 'undefined' && window.mossWeb);
  const shell = (typeof window !== 'undefined' ? (window as any).mossDesktopShell : undefined) as { returnToLocal: () => Promise<void> } | undefined;
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  if (web && !shell) return null;
  const select = async (cloud: boolean) => {
    setPending(true); setError('');
    try {
      if (cloud && !web) await window.agentDesktop.ipcInvoke('desktop:open-cloud');
      if (!cloud && web) await shell?.returnToLocal();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setPending(false); }
  };
  return <div className="mt-3">
    <DropdownMenu><DropdownMenuTrigger asChild><button disabled={pending} aria-label="选择工作电脑" className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border px-2 py-2 text-xs hover:bg-sidebar-accent disabled:opacity-50">
      {web ? <Cloud className="h-4 w-4 shrink-0" /> : <Laptop className="h-4 w-4 shrink-0" />}
      {!collapsed && <><span className="flex-1 text-left">{pending ? '正在连接…' : web ? '我的云电脑' : '此电脑'}</span><ChevronDown className="h-3 w-3" /></>}
    </button></DropdownMenuTrigger><DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => void select(false)}><Laptop className="mr-2 h-4 w-4" />此电脑</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void select(true)}><Cloud className="mr-2 h-4 w-4" />我的云电脑</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </div>;
}
