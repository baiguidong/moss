import * as React from 'react';
import { History, Loader2, MoreHorizontal, RefreshCw, RotateCcw, SquareTerminal, Trash2, WandSparkles } from 'lucide-react';
import type { AppVersion, StoredApp } from '@/types';
import { AppDetailsSection } from '@/components/app-details-section';
import { AppRuntimeControls } from '@/components/apps-panel';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAppAuthoring } from '@/lib/app-authoring';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { describeBackendAction } from '../../shared/app-capability-descriptions.mjs';

export type AppManagementPage = 'runtime' | 'versions' | 'uninstall';
export const APP_MANAGEMENT_TITLES = { runtime: '后台服务', versions: '版本历史', uninstall: '卸载应用' };
export type AppManagementActions = {
  onLoadVersions?: (name: string) => Promise<AppVersion[]>;
  onRollback?: (name: string, versionId: string) => Promise<unknown>;
  onDelete?: (name: string, options: { deleteData: boolean; deleteCredentials: boolean }) => Promise<unknown>;
  onIterate?: (name: string) => Promise<unknown>;
};

export function AppDetailsManagement({ app, busy, onOpen, onUpdate, onIterate }: {
  app: StoredApp; busy: boolean; onOpen: (page: AppManagementPage) => void;
  onUpdate(): void; onIterate?: AppManagementActions['onIterate'];
}) {
  const authoring = useAppAuthoring();
  const unavailable = app.packageStatus === 'invalid' || app.packageStatus === 'incompatible';
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="rounded-full" data-app-management-menu aria-label="应用管理" disabled={busy}><MoreHorizontal className="h-4 w-4" />管理</Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-44" aria-label="应用管理操作">
      {app.hasBackend && <DropdownMenuItem disabled={busy || unavailable} onSelect={() => onOpen('runtime')}><SquareTerminal />后台服务</DropdownMenuItem>}
      <DropdownMenuItem disabled={busy} onSelect={() => onOpen('versions')}><History />版本历史</DropdownMenuItem>
      <DropdownMenuItem disabled={busy} onSelect={onUpdate}><RefreshCw />更新应用</DropdownMenuItem>
      {!app.connectorApp && onIterate && (authoring.available || authoring.reason === 'backend-failed') && <DropdownMenuItem disabled={busy || !authoring.available} title={!authoring.available ? '创作 App 启动失败，请重试。' : undefined} onSelect={() => void onIterate(app.name)}><WandSparkles />迭代此 App</DropdownMenuItem>}
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onOpen('uninstall')}><Trash2 />卸载应用</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function AppManagementPanel({ app, page, onLoadVersions, onRollback, onDelete, onRefresh, onBusyChange, onOpenSettings }: AppManagementActions & {
  app: StoredApp; page: AppManagementPage; onRefresh(): Promise<unknown>;
  onBusyChange(busy: boolean): void; onOpenSettings(): void;
}) {
  const [versions, setVersions] = React.useState<AppVersion[] | null>(null);
  const [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [deleteData, setDeleteData] = React.useState(false), [deleteCredentials, setDeleteCredentials] = React.useState(false);
  const working = React.useRef(false);
  React.useEffect(() => {
    if (page !== 'versions') return;
    let active = true;
    const load = onLoadVersions ? onLoadVersions(app.name) : window.agentDesktop.listAppVersions({ name: app.name });
    void load.then(result => { if (active) setVersions(result); }).catch(cause => { if (active) setError(cleanIpcErrorMessage(cause)); });
    return () => { active = false; };
  }, [app.name, page, onLoadVersions]);
  React.useEffect(() => () => onBusyChange(false), [onBusyChange]);
  const run = async (operation: () => Promise<unknown>) => {
    if (working.current) return;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try { await operation(); }
    catch (cause) { setError(cleanIpcErrorMessage(cause)); }
    finally { working.current = false; setBusy(false); onBusyChange(false); }
  };
  if (page === 'runtime') return <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
    {app.instances?.[0] ? <AppRuntimeControls app={app} instance={app.instances[0]} onChanged={onRefresh} onOpenSettings={onOpenSettings} onBusyChange={onBusyChange} /> : <p className="text-sm text-muted-foreground">后台服务尚未就绪</p>}
    {app.backend?.actions?.length ? <AppDetailsSection title="应用能力"><div className="divide-y">{app.backend.actions.map(action => {
      const detail = describeBackendAction(action.name);
      return <div key={action.name} className="space-y-1 py-4 text-sm"><p className="font-medium">{detail.label}</p><p className="text-xs leading-6 text-muted-foreground">{detail.description}</p><code className="block break-all text-xs text-muted-foreground">{action.name}</code></div>;
    })}</div></AppDetailsSection> : null}
  </div>;
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {page === 'versions' ? versions === null ? <p role="status" className="text-sm text-muted-foreground">{error ? '版本列表暂不可用，请重新打开。' : '正在读取版本…'}</p>
        : versions.length ? <div className="divide-y">{versions.map(version => <div key={version.id} className="flex items-start justify-between gap-4 py-4 first:pt-0">
          <div className="min-w-0 space-y-1"><p className="text-sm font-medium">{version.version}{version.isCurrent && <span className="ml-2 text-xs text-muted-foreground">当前版本</span>}</p><p className="text-xs leading-5 text-muted-foreground">{new Date(version.createdAt).toLocaleString('zh-CN')}</p>{(version.note || version.reason) && <p className="break-words text-xs leading-5 text-muted-foreground">{version.note || version.reason}</p>}</div>
          <Button size="sm" variant="outline" className="shrink-0 rounded-full" disabled={version.isCurrent || busy || !onRollback} onClick={() => {
            if (!window.confirm(`将“${app.displayName || app.name}”切换到 ${version.version}？`)) return;
            void run(async () => { await onRollback!(app.name, version.id); setVersions(await (onLoadVersions ? onLoadVersions(app.name) : window.agentDesktop.listAppVersions({ name: app.name }))); });
          }}><RotateCcw className="h-3.5 w-3.5" />回滚</Button>
        </div>)}</div> : <p className="text-sm text-muted-foreground">暂无版本记录。</p>
        : <><p className="text-sm leading-7">卸载“{app.displayName || app.title || app.name}”后，将无法继续使用此应用。</p>
          <fieldset disabled={busy} className="space-y-4 text-sm"><legend className="mb-4 font-medium">同时删除</legend>
            <label className="flex items-center gap-3"><input type="checkbox" checked={deleteData} onChange={event => setDeleteData(event.target.checked)} className="h-4 w-4 accent-primary" />应用数据</label>
            <label className="flex items-center gap-3"><input type="checkbox" checked={deleteCredentials} onChange={event => setDeleteCredentials(event.target.checked)} className="h-4 w-4 accent-primary" />保存的凭据与密钥</label>
          </fieldset><p className="text-xs leading-6 text-muted-foreground">未勾选的内容会保留，重新安装后可继续使用。{app.builtin ? '此内置应用可从应用列表的“内置应用”恢复。' : ''}</p></>}
    </div>
    {page === 'uninstall' && <footer className="flex shrink-0 justify-end border-t px-5 py-4"><Button variant="destructive" className="rounded-full" disabled={busy || !onDelete} onClick={() => {
      const removal = [deleteData && '应用数据', deleteCredentials && '凭据与密钥'].filter(Boolean).join('、');
      if (window.confirm(`确定卸载“${app.displayName || app.name}”${removal ? `并删除${removal}` : ''}？`)) void run(() => onDelete!(app.name, { deleteData, deleteCredentials }));
    }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}卸载应用</Button></footer>}
  </div>;
}
