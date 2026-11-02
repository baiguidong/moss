import * as React from 'react';
import { Cloud, Laptop, LoaderCircle, Check } from 'lucide-react';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';

export function WorkComputerSelector() {
  const web = Boolean(typeof window !== 'undefined' && window.mossWeb);
  const shell = (typeof window !== 'undefined' ? (window as any).mossDesktopShell : undefined) as { returnToLocal: () => Promise<void> } | undefined;
  const [pending, setPending] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState('');
  if (web && !shell) return null;
  const select = async (cloud: boolean) => {
    setPending(true); setError('');
    try {
      if (cloud && !web) await window.agentDesktop.ipcInvoke('desktop:open-cloud');
      if (!cloud && web) await shell?.returnToLocal();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setOpen(true); }
    finally { setPending(false); }
  };
  return <div className="relative shrink-0">
    <DropdownMenu open={open} onOpenChange={setOpen}><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" disabled={pending} aria-label="选择工作电脑" title={pending ? '正在连接…' : web ? '我的云电脑 · 切换工作电脑' : '此电脑 · 切换工作电脑'} className="h-8 w-8 rounded-xl">
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : web ? <Cloud className="h-4 w-4" /> : <Laptop className="h-4 w-4" />}
    </Button></DropdownMenuTrigger><DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => void select(false)}><Laptop className="h-4 w-4" />此电脑{!web && <Check className="ml-auto h-4 w-4" />}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void select(true)}><Cloud className="h-4 w-4" />我的云电脑{web && <Check className="ml-auto h-4 w-4" />}</DropdownMenuItem>
      {error && <p role="alert" className="max-w-64 px-2 py-1 text-xs text-destructive">{error}</p>}
    </DropdownMenuContent></DropdownMenu>
  </div>;
}
