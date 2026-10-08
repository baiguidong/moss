import * as React from 'react';
import { Monitor, Square, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ComputerUseStatus } from '../types';

const labels: Record<string, string> = { disabled: '已关闭', 'not-checked': '等待权限检查', starting: '正在启动', 'needs-permission': '等待系统授权',
  ready: '已就绪', stopping: '正在停止', error: '需要处理' };

function useComputerUse() {
  const [status, setStatus] = React.useState<ComputerUseStatus | null>(null);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    const api = window.agentDesktop?.computerUse;
    if (!api) return;
    let alive = true;
    void api.status().then(s => { if (alive) setStatus(s); }).catch(e => { if (alive) setError(e.message); });
    const off = api.onChanged(setStatus);
    return () => { alive = false; off(); };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try { await action(); setStatus(await window.agentDesktop.computerUse.status()); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)); }
  };
  return { status, error, run };
}

export function ComputerUseSettings() {
  const { status, error, run } = useComputerUse();
  const [busy, setBusy] = React.useState(false);
  const api = typeof window === 'undefined' ? undefined : window.agentDesktop?.computerUse;
  const perform = async (action: () => Promise<unknown>) => { setBusy(true); try { await run(action); } finally { setBusy(false); } };
  if (!status || !api) return <p className="text-sm text-muted-foreground">{error || '正在读取应用控制状态…'}</p>;
  const sessionApps = status.sessionApps?.filter(a => !status.apps.some(p => p.bundleId === a.bundleId)) || [];
  return <div id="app-control-settings" className="rounded-xl border bg-card p-5">
    <div className="flex items-center justify-between gap-4">
      <div><h3 className="font-medium">允许 Moss 操作电脑上的应用</h3>
        <p className="mt-1 text-sm text-muted-foreground">{status.supported ? labels[status.phase] || status.phase : '目前支持 macOS 14 及以上的 Apple Silicon 设备'}</p></div>
      <button type="button" role="switch" aria-label="开启电脑操控" aria-checked={status.enabled}
        disabled={busy || !status.supported} onClick={() => void perform(() => api.enable(!status.enabled))}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${status.enabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${status.enabled ? 'left-0.5 translate-x-5' : 'left-0.5'}`} />
      </button>
    </div>
    {status.enabled && <div className="mt-5 space-y-4 border-t pt-5">
      <h4 className="text-sm font-medium">系统权限</h4>
      {(['accessibility', 'screen'] as const).map(permission => {
        const granted = permission === 'accessibility' ? status.permissions?.accessibility : status.permissions?.screenRecording;
        return <div className="flex items-center justify-between gap-3" key={permission}>
          <div><span className="text-sm">{permission === 'accessibility' ? '辅助功能' : '屏幕与系统音频录制'}</span>
            <span className={`ml-3 text-xs ${granted ? 'text-emerald-600' : 'text-muted-foreground'}`}>{granted ? '已开启' : '待开启'}</span></div>
          <Button variant="outline" size="sm" onClick={() => void run(() => api.openSettings(permission))}>打开系统设置</Button>
        </div>;
      })}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || Boolean(status.active)} onClick={() => void perform(() => api.requestPermissions())}><ShieldCheck className="mr-2 size-4" />{busy ? '正在处理…' : '发起系统授权'}</Button>
        <Button variant="outline" disabled={busy || Boolean(status.active)} onClick={() => void perform(() => api.check())}><RefreshCw className="mr-2 size-4" />重新检查</Button>
        <Button variant="ghost" size="sm" onClick={() => void run(() => api.revealHostApp())}>在访达中显示应用</Button>
      </div>
      {status.permissionNotice && <p role="status" className="rounded-lg bg-muted p-3 text-sm leading-6">{status.permissionNotice}</p>}
    </div>}
    <div className="mt-5 space-y-3 border-t pt-5">
      <h4 className="text-sm font-medium">已允许的应用</h4>
      {status.apps.length === 0 && sessionApps.length === 0 && <p className="text-sm text-muted-foreground">暂无已允许的应用</p>}
      {status.apps.map(a => <div key={a.bundleId} className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm">{a.name}</p><p className="truncate text-xs text-muted-foreground">{a.bundleId}</p></div><Button variant="ghost" size="sm" onClick={() => void run(() => api.revoke(a.bundleId))}>撤销</Button></div>)}
      {sessionApps.map(a => <div key={`${a.sessionId}:${a.bundleId}`} className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-sm">{a.bundleId} <span className="text-xs text-muted-foreground">本次会话</span></p><Button variant="ghost" size="sm" onClick={() => void run(() => api.revoke(a.bundleId))}>撤销</Button></div>)}
    </div>
    {(error || status.error) && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error || status.error}</p>}
    <div className="mt-4 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>驱动版本：Cua {status.version}</span>
      <Button variant="ghost" size="sm" onClick={() => void run(() => navigator.clipboard.writeText(JSON.stringify({ driverVersion: status.version, supported: status.supported, enabled: status.enabled, phase: status.phase, permissions: status.permissions, captureVerified: status.captureVerified }, null, 2)))}>复制诊断信息</Button>
    </div>
  </div>;
}

export function ComputerUseControl() {
  const { status, error, run } = useComputerUse();
  if (!status?.active && !status?.requests?.length) return null;
  const api = window.agentDesktop.computerUse;
  const request = status.requests?.[0];
  return <aside aria-label="电脑操控" className="fixed bottom-5 right-5 z-[100] w-80 rounded-2xl border bg-background p-4 shadow-xl">
    <div className="flex items-center gap-2 text-sm font-medium"><Monitor className="size-4" />{request ? '应用控制授权' : '正在控制应用'}</div>
    {request ? <>
      <p className="mt-3 text-sm">{request.foreground ? `允许本次任务将 ${request.app.name} 置于前台并操作键盘鼠标？` : `允许 Moss 读取并操作 ${request.app.name}？`}</p>
      <p className="mt-1 break-all text-xs text-muted-foreground">{request.app.bundleId} · {request.sessionTitle || '当前会话'}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{request.foreground ? '操作期间请暂时不要使用键盘和鼠标。' : '应用界面和截图可能发送给当前模型服务。'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void run(() => api.decide(request.id, 'session'))}>{request.foreground ? '允许本次运行' : '本次会话允许'}</Button>
        {!request.foreground && <Button variant="outline" size="sm" onClick={() => void run(() => api.decide(request.id, 'always'))}>始终允许</Button>}
        <Button variant="ghost" size="sm" onClick={() => void run(() => api.decide(request.id, 'deny'))}>拒绝</Button>
      </div>
    </> : <><p className="mt-2 text-sm">{status.active?.app?.name || '正在选择应用'} · {status.active?.foreground ? '允许前台' : '后台'}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">{status.active?.title}</p></>}
    <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => void run(() => api.stop())}><Square className="mr-2 size-3" />停止控制</Button>
    {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
  </aside>;
}
