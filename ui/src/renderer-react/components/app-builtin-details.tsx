import * as React from 'react';
import { ArrowLeft, ChevronRight, LoaderCircle, RotateCcw } from 'lucide-react';
import { AppIcon } from '@/components/app-icon';
import { AppDetailsSection, APP_DETAILS_LIST_CLASS, APP_DETAILS_ROW_CLASS } from '@/components/app-details-section';
import { Button } from '@/components/ui/button';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { supportsHostFeature } from '@/lib/host-environment';
import type { BuiltinApp } from '@/types';

/** Uninstalled bundled Apps use Core details; installed Apps open their usual details. */
export function AppBuiltinDetails({ app, installed, onBack, onOpen, onRestore }: {
  app: BuiltinApp; installed: boolean; onBack(): void; onOpen(): void; onRestore(): Promise<unknown>;
}) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const pending = React.useRef(false);
  const backButton = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => { backButton.current?.focus({ preventScroll: true }); }, []);
  const restore = async () => {
    if (pending.current || installed) return;
    pending.current = true;
    setBusy(true); setError('');
    try { await onRestore(); }
    catch (cause) { setError(cleanIpcErrorMessage(cause)); }
    finally { pending.current = false; setBusy(false); }
  };
  return <div data-app-builtin-details={app.id} className="h-full min-h-0 overflow-y-auto bg-background">
    <div className="@container mx-auto max-w-3xl space-y-8 px-5 pb-12 pt-4 sm:px-9">
      <nav aria-label="内置应用详情导航" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button ref={backButton} variant="ghost" size="sm" className="-ml-2 gap-1.5 px-2" disabled={busy} onClick={onBack}><ArrowLeft className="h-4 w-4" />内置应用</Button>
        <ChevronRight className="h-3.5 w-3.5" /><span className="truncate text-foreground">{app.displayName}</span>
      </nav>
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 @2xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <AppIcon className="h-16 w-16 rounded-2xl" />
        <div className="min-w-0"><h1 className="break-words text-2xl font-semibold tracking-tight">{app.displayName}</h1><p className="mt-1.5 text-sm text-muted-foreground">Moss</p></div>
        <Button className="col-span-2 w-fit rounded-full @2xl:col-span-1" disabled={busy || (!installed && !supportsHostFeature('appInstallation'))} onClick={installed ? onOpen : () => void restore()}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : installed ? <ChevronRight className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
          {busy ? '恢复中…' : installed ? '查看详情' : '恢复应用'}
        </Button>
      </header>
      {(error || app.error) && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error || app.error}</p>}
      <p className="whitespace-pre-wrap break-words text-sm leading-7">{app.description || '暂无描述'}</p>
      <AppDetailsSection title="基本信息"><dl className={APP_DETAILS_LIST_CLASS}>
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">安装状态</dt><dd>{installed ? '已安装' : '未安装'}</dd></div>
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">内置版本</dt><dd>{app.version}</dd></div>
        {installed && app.installedVersion && <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">已安装版本</dt><dd>{app.installedVersion}</dd></div>}
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">来源</dt><dd>随 Moss 提供</dd></div>
      </dl></AppDetailsSection>
    </div>
  </div>;
}
