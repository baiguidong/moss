'use client';

import * as React from 'react';
import { Download, ExternalLink, FolderOpen, Loader2, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UpdateResponse, UpdateState } from '@/types';

const busyPhases = new Set(['checking', 'downloading', 'verifying', 'preparingInstall', 'installing']);
const titles: Record<UpdateState['phase'], string> = {
  idle: '检查更新', checking: '正在检查更新…', upToDate: '已是最新版本', available: '发现新版本',
  downloading: '正在下载安装包…', verifying: '正在校验安装包…', downloaded: '下载完成',
  preparingInstall: '正在保存数据并准备退出…', installing: '正在启动安装程序…', error: '更新未完成', unsupported: '暂不能更新',
};
const size = (bytes = 0) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type UpdateActions = {
  check: () => void; download: () => void; cancel: () => void; install: () => void;
  open: () => void; reveal: () => void; release: () => void; autoDownload: (enabled: boolean) => void;
};

export function UpdateContent({ state, actions, operationError }: { state: UpdateState; actions: UpdateActions; operationError?: string }) {
  const native = state.capabilities.mode === 'nativeUpdater';
  const mac = state.capabilities.platform === 'darwin';
  const busy = busyPhases.has(state.phase);
  const hasDownload = Boolean(state.downloadId);
  const retry = state.retry === 'install' ? actions.install : state.retry === 'download' ? actions.download : actions.check;
  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        <p className="text-sm font-medium" role="status">{titles[state.phase]}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        当前版本 {state.currentVersion}{state.version ? ` → ${state.version}` : ''}
      </p>
      {state.reason && <p className="text-sm text-muted-foreground">{state.reason}</p>}
      {(operationError || state.error) && <p role="alert" className="break-words text-sm text-destructive">{operationError || state.error}</p>}
      {state.notes && <div className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-accent/50 p-3 text-xs text-muted-foreground">{state.notes}</div>}
      {state.phase === 'downloading' && (
        <div className="space-y-2">
          <progress className="h-2 w-full accent-primary" max={100} value={state.progress?.percent || 0} aria-label="下载进度" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{size(state.progress?.transferred)} / {size(state.progress?.total)}</span>
            <span>{size(state.progress?.bytesPerSecond)}/s</span>
          </div>
          <p className="text-xs text-muted-foreground">关闭此弹窗后仍会继续下载。</p>
        </div>
      )}
      {(state.phase === 'available' || hasDownload) && (
        <p className="text-xs leading-5 text-muted-foreground">
          {native ? '下载后，点击“安装并重启”完成升级。普通退出不会自动安装。'
            : mac ? '打开 DMG 后，请完全退出 Moss，将新版拖到“应用程序”并替换旧版，再打开 Moss。无签名应用仍可能需要在系统设置中确认打开。'
              : '这是 Windows 便携版。下载后请退出 Moss，手动替换旧的 EXE，再打开新版。'}
        </p>
      )}
      {state.retry === 'install' && <p className="text-xs text-muted-foreground">退出准备后部分功能可能已停止。请重试安装；也可退出 Moss 后重新打开。</p>}
      {hasDownload && <p className="break-all text-xs text-muted-foreground">{state.fileName}</p>}
      <div className="flex flex-wrap gap-2">
        {state.phase === 'available' && <Button size="sm" onClick={actions.download}><Download className="mr-1 h-3.5 w-3.5" />下载安装包</Button>}
        {state.phase === 'downloading' && <Button size="sm" variant="outline" onClick={actions.cancel}>取消下载</Button>}
        {hasDownload && !busy && (
          <>
            {native ? <Button size="sm" onClick={actions.install}>安装并重启</Button>
              : mac && <Button size="sm" onClick={actions.open}>打开安装包</Button>}
            <Button size="sm" variant="outline" onClick={actions.reveal}><FolderOpen className="mr-1 h-3.5 w-3.5" />{mac ? '在 Finder 中显示' : '在文件夹中显示'}</Button>
          </>
        )}
        {state.phase === 'error' && !hasDownload && <Button size="sm" onClick={retry}><RefreshCw className="mr-1 h-3.5 w-3.5" />重试</Button>}
        {!busy && !hasDownload && state.phase !== 'error' && state.capabilities.mode !== 'development' && <Button size="sm" variant="outline" onClick={actions.check}>重新检查</Button>}
        {!busy && <Button size="sm" variant="ghost" onClick={actions.release}><ExternalLink className="mr-1 h-3.5 w-3.5" />发布页</Button>}
      </div>
      {native && <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={state.autoDownload} onChange={event => actions.autoDownload(event.target.checked)} />发现新版本时自动下载
      </label>}
    </div>
  );
}

export function UpdateModal() {
  const [visible, setVisible] = React.useState(false);
  const [state, setState] = React.useState<UpdateState | null>(null);
  const [operationError, setOperationError] = React.useState('');
  const lastPrompt = React.useRef('');
  const accept = React.useCallback((next: UpdateState) => {
    setState(current => !current || next.revision >= current.revision ? next : current);
  }, []);
  const run = React.useCallback(async (operation: () => Promise<UpdateResponse>) => {
    setOperationError('');
    try {
      const response = await operation();
      if (!response.success || !response.data) throw new Error(response.msg || '更新操作失败，请重试。');
      accept(response.data);
      return response.data;
    } catch (error) { setOperationError(error instanceof Error ? error.message : String(error)); }
  }, [accept]);

  React.useEffect(() => {
    const api = window.agentDesktop.update;
    const offState = api.onState(accept);
    const offOpen = api.onOpenModal(() => {
      setVisible(true);
      void run(api.getState).then(snapshot => {
        if (snapshot && ['idle', 'upToDate'].includes(snapshot.phase)) void run(api.check);
      });
    });
    void run(api.getState);
    return () => { offState(); offOpen(); };
  }, [accept, run]);
  React.useEffect(() => {
    if (!state?.prompt) return;
    const key = `${state.version}:${state.phase}`;
    if (lastPrompt.current !== key) { lastPrompt.current = key; setVisible(true); }
  }, [state]);

  const close = () => {
    setVisible(false);
    void run(() => window.agentDesktop.update.dismiss({ version: state?.version }));
  };
  React.useEffect(() => {
    if (!visible) return;
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });
  if (!visible) return null;
  const api = window.agentDesktop.update;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-labelledby="update-modal-title" className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border/80 bg-card shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <h2 id="update-modal-title" className="text-base font-semibold">Moss 版本更新</h2>
          <button aria-label="稍后提醒" onClick={close} className="rounded-md p-1 hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        {state ? <UpdateContent state={state} operationError={operationError} actions={{
          check: () => void run(api.check),
          download: () => void run(() => api.download({ candidateId: state.candidateId! })),
          cancel: () => void run(api.cancel),
          install: () => void run(() => api.install({ candidateId: state.candidateId! })),
          open: () => void run(() => api.openDownloaded({ downloadId: state.downloadId! })),
          reveal: () => void run(() => api.showDownloaded({ downloadId: state.downloadId! })),
          release: () => void run(api.openReleasePage),
          autoDownload: enabled => void run(() => api.setAutoDownload({ enabled })),
        }} /> : <div className="p-5 text-sm">{operationError || '正在读取更新状态…'}</div>}
      </div>
    </div>
  );
}
