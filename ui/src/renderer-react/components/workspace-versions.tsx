import * as React from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleCheck, CircleAlert, Info, History, Save, RotateCcw, X, RefreshCw, Loader2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PreviewViewer } from '@/components/preview-drawer';
import { WorkspaceToolbarButton } from '@/components/workspace-toolbar-button';
import { cn } from '@/lib/utils';
import type { WorkspacePreviewData, WorkspaceRestorePlan, WorkspaceVersion, WorkspaceVersionChange, WorkspaceVersionFile, WorkspaceVersionStatus } from '@/types';

const changeLabels = { added: '新增', modified: '修改', deleted: '删除' };
const kindLabels = { manual: '手动保存', backup: '自动备份', restore: '恢复记录' };
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']+': Error: /, '');
const versionTitle = (version: WorkspaceVersion) => version.alias && version.alias !== version.tag ? `${version.tag} · ${version.alias}` : version.tag;
const iconButtonClass = 'flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40';
type SaveNotice = { message: string; tone: 'success' | 'info' | 'error' };

function VersionSaveNotice({ notice, id, onClose }: {
  notice: SaveNotice;
  id: string;
  onClose: () => void;
}) {
  const Icon = notice.tone === 'success' ? CircleCheck : notice.tone === 'error' ? CircleAlert : Info;
  return <div id={id} role={notice.tone === 'error' ? 'alert' : 'status'} className={cn(
    'flex h-8 min-w-0 items-center gap-1.5 px-3 text-xs',
    notice.tone === 'info' && 'bg-amber-500/10 text-amber-800 dark:text-amber-200',
    notice.tone === 'success' && 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
    notice.tone === 'error' && 'bg-red-500/10 text-red-800 dark:text-red-200',
  )} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <Icon className="h-3.5 w-3.5 shrink-0" />
    <span className="min-w-0 flex-1 truncate" title={notice.message}>{notice.message}</span>
    <button type="button" aria-label="关闭版本提示" onClick={onClose} className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-70 hover:bg-black/10 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"><X className="h-3.5 w-3.5" /></button>
  </div>;
}

function Changes({ changes }: { changes: WorkspaceVersionChange[] }) {
  return <ul className="max-h-36 overflow-auto text-xs">
    {changes.map(change => <li key={change.path} className="flex gap-3 py-1">
      <span className={cn('shrink-0', change.status === 'deleted' ? 'text-red-600 dark:text-red-400' : change.status === 'added' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>{changeLabels[change.status]}</span>
      <span className="min-w-0 break-all">{change.path}</span>
    </li>)}
  </ul>;
}

export function WorkspaceVersions({ sessionId, workspace, remote, busy, hasUnsavedEdits, onRestored, onRefreshFiles, toolbarActions }: {
  sessionId: string;
  workspace: string;
  remote: boolean;
  busy: boolean;
  hasUnsavedEdits: boolean;
  onRestored: () => void | Promise<void>;
  onRefreshFiles?: () => void | Promise<void>;
  toolbarActions?: React.ReactNode;
}) {
  const [status, setStatus] = React.useState<WorkspaceVersionStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [operation, setOperation] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState<SaveNotice | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [label, setLabel] = React.useState('');
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState('');
  const [files, setFiles] = React.useState<WorkspaceVersionFile[]>([]);
  const [filePath, setFilePath] = React.useState('');
  const [query, setQuery] = React.useState('');
  const [preview, setPreview] = React.useState<WorkspacePreviewData | null>(null);
  const [previewBusy, setPreviewBusy] = React.useState(false);
  const [filesBusy, setFilesBusy] = React.useState(false);
  const [plan, setPlan] = React.useState<WorkspaceRestorePlan | null>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const versionPanel = React.useRef<HTMLDivElement>(null);
  const noticeId = React.useId();
  const versionInputId = React.useId();
  const suggestedTag = React.useRef('1.0');
  const refreshSequence = React.useRef(0);
  const mounted = React.useRef(true);
  const api = window.agentDesktop.workspaceVersions;
  const versions = status?.versions || [];
  const selected = versions.find(version => version.id === selectedId);
  const nextTag = status?.nextTag || '1.0';
  const blocked = hasUnsavedEdits ? '请先保存或撤销预览编辑器中尚未保存的内容。'
    : busy ? '任务正在运行，结束后可以保存或恢复版本。' : status?.busyReason || '';
  const disabled = Boolean(operation || blocked || remote || !status?.supported);
  const saveDisabledReason = remote ? '工作区版本暂支持本地工作区' : blocked || operation || (!status?.supported ? error || '正在读取版本信息…' : '');

  React.useEffect(() => {
    if (!saving) return;
    const previous = suggestedTag.current;
    setLabel(current => current === previous ? nextTag : current);
    suggestedTag.current = nextTag;
  }, [nextTag, saving]);

  React.useEffect(() => {
    if (notice?.tone !== 'success') return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const refresh = React.useCallback(async (includeFiles = false) => {
    if (remote && !includeFiles) return;
    const sequence = ++refreshSequence.current;
    setLoading(true);
    try {
      const [versionResult, fileResult] = await Promise.allSettled([
        remote ? Promise.resolve(null) : api.status({ sessionId }),
        includeFiles ? Promise.resolve().then(() => onRefreshFiles?.()) : Promise.resolve(),
      ]);
      if (mounted.current && sequence === refreshSequence.current) {
        if (versionResult.status === 'fulfilled' && versionResult.value) {
          const result = versionResult.value;
          setStatus(result);
          setSelectedId(current => result.versions?.some(version => version.id === current) ? current : result.versions?.[0]?.id || '');
        }
        const failures = [versionResult, fileResult].filter(result => result.status === 'rejected');
        if (failures.length) {
          const message = failures.map(result => errorText(result.reason)).join('；');
          setError(message);
          if (includeFiles) setNotice({ message, tone: 'error' });
        }
      }
    } catch (reason) {
      if (mounted.current && sequence === refreshSequence.current) {
        const message = errorText(reason);
        setError(message);
        if (includeFiles) setNotice({ message, tone: 'error' });
      }
    } finally { if (mounted.current && sequence === refreshSequence.current) setLoading(false); }
  }, [api, remote, sessionId, onRefreshFiles]);

  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; refreshSequence.current++; }; }, []);
  React.useEffect(() => {
    if (!busy) void refresh();
    let timer: ReturnType<typeof setTimeout>;
    const off = window.agentDesktop.onWorkspaceChanged(event => {
      if (event.sessionId !== sessionId || busy) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 700);
    });
    return () => { off(); clearTimeout(timer); };
  }, [refresh, sessionId, busy]);

  React.useEffect(() => {
    if (!historyOpen || !selectedId) return;
    let cancelled = false;
    setFilesBusy(true);
    setFiles([]);
    setFilePath('');
    setPreview(null);
    setPlan(null);
    setQuery('');
    void api.files({ sessionId, versionId: selectedId }).then(result => {
      if (!cancelled) { setFiles(result); setFilePath(result[0]?.path || ''); }
    }).catch(reason => { if (!cancelled) setError(errorText(reason)); })
      .finally(() => { if (!cancelled) setFilesBusy(false); });
    return () => { cancelled = true; };
  }, [api, historyOpen, selectedId, sessionId]);

  React.useEffect(() => {
    setPreview(null);
    setPreviewBusy(false);
    if (!historyOpen || !selectedId || !filePath) return;
    let cancelled = false;
    setPreviewBusy(true);
    void api.previewFile({ sessionId, versionId: selectedId, filePath }).then(result => {
      if (!cancelled) setPreview(result);
    }).catch(reason => { if (!cancelled) setError(errorText(reason)); })
      .finally(() => { if (!cancelled) setPreviewBusy(false); });
    return () => { cancelled = true; };
  }, [api, historyOpen, selectedId, filePath, sessionId]);

  React.useEffect(() => {
    if (!historyOpen) return;
    const previous = document.activeElement as HTMLElement;
    dialog.current?.focus();
    return () => previous?.focus();
  }, [historyOpen]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled) return;
    setOperation('正在保存版本…'); setError('');
    try {
      const value = label.trim();
      const result = await api.save({ sessionId, label: value === suggestedTag.current ? '' : value });
      if (result.created === false) {
        setNotice({ message: result.message, tone: 'info' });
        return;
      }
      setSelectedId(result.version.id);
      setSaving(false); setLabel('');
      setNotice({ message: `已保存版本 ${result.version.tag}。`, tone: 'success' });
      await refresh();
    } catch (reason) {
      const message = errorText(reason);
      setError(message);
      setNotice({ message, tone: 'error' });
    }
    finally { setOperation(''); }
  };

  const prepareRestore = async () => {
    if (disabled || !selectedId) return;
    setOperation('正在检查恢复范围…'); setError('');
    try { setPlan(await api.previewRestore({ sessionId, versionId: selectedId })); }
    catch (reason) { setError(errorText(reason)); }
    finally { setOperation(''); }
  };

  const restore = async () => {
    if (!plan || disabled) return;
    setOperation('正在备份当前文件并恢复版本…'); setError('');
    try {
      const result = await api.restore({ sessionId, versionId: plan.version.id, token: plan.token });
      setPlan(null);
      setSelectedId(result.version.id);
      await onRestored();
      await refresh();
    } catch (reason) { setError(errorText(reason)); setPlan(null); await refresh(); }
    finally { setOperation(''); }
  };

  const messages = <>
    {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
    {operation && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />{operation}</p>}
  </>;

  return <>
    <div ref={versionPanel} className="min-w-0 shrink-0 border-b border-border/70">
      <div className="flex h-9 items-center justify-between gap-2 px-3">
        <span className="shrink-0 text-xs font-medium">工作区版本</span>
        <div className="flex shrink-0 items-center gap-1" onClick={() => setNotice(null)}>
          {toolbarActions}
          <WorkspaceToolbarButton aria-label="保存版本" tooltip={saveDisabledReason ? `保存版本：${saveDisabledReason}` : '保存版本'} aria-expanded={saving} disabled={disabled} onClick={() => { setSaving(value => !value); setError(''); setNotice(null); suggestedTag.current = nextTag; setLabel(nextTag); }}><Save className="h-3.5 w-3.5" /></WorkspaceToolbarButton>
          <WorkspaceToolbarButton aria-label="历史版本" tooltip={status?.interruptedRestore ? '历史版本：上次恢复未完成，请恢复备份' : remote ? '历史版本：暂支持本地工作区' : operation ? `历史版本：${operation}` : versions.length ? '历史版本' : '历史版本：暂无保存的版本'} disabled={!versions.length || Boolean(operation) || remote} onClick={() => { setHistoryOpen(true); setSaving(false); setError(''); setNotice(null); setPlan(null); }} className={cn(status?.interruptedRestore && 'text-amber-600')}><History className="h-3.5 w-3.5" /></WorkspaceToolbarButton>
          <WorkspaceToolbarButton aria-label="刷新工作区" tooltip={loading ? '正在刷新工作区…' : operation || error ? `刷新工作区：${operation || error}` : (remote ? '刷新工作区文件' : '刷新工作区文件和版本状态')} disabled={(remote && !onRefreshFiles) || loading || Boolean(operation)} onClick={() => { setError(''); void refresh(true); }} className={cn(error && 'text-destructive')}><RefreshCw className={cn('h-3.5 w-3.5', (loading || operation) && 'animate-spin')} /></WorkspaceToolbarButton>
        </div>
      </div>
      {saving && <form aria-label="保存工作区版本" onSubmit={save} className="flex h-9 items-center gap-1.5 px-3" onKeyDown={event => { if (event.key === 'Escape' && !operation) { event.stopPropagation(); if (notice) setNotice(null); else setSaving(false); } }}>
        <label htmlFor={versionInputId} className="shrink-0 text-xs text-muted-foreground">版本:</label>
        <Input id={versionInputId} autoFocus aria-label="版本" aria-describedby={notice ? noticeId : undefined} title={error || undefined} aria-invalid={Boolean(error)} value={label} maxLength={100} onChange={event => { setLabel(event.target.value); setNotice(null); }} className="h-6 min-w-0 flex-1 rounded px-1.5 text-xs" disabled={Boolean(operation)} />
        <button type="submit" aria-label="确认保存版本" title={saveDisabledReason || '保存'} disabled={disabled} className={iconButtonClass}>{operation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</button>
        <button type="button" aria-label="取消保存版本" title="取消" disabled={Boolean(operation)} onClick={() => { setSaving(false); setNotice(null); }} className={iconButtonClass}><X className="h-3.5 w-3.5" /></button>
      </form>}
      {notice && <VersionSaveNotice notice={notice} id={noticeId} onClose={() => {
        setNotice(null);
        (versionPanel.current?.querySelector<HTMLInputElement>('input') || versionPanel.current?.querySelector<HTMLButtonElement>('button[aria-label="保存版本"]'))?.focus();
      }} />}
      {!historyOpen && <span className="sr-only" role={error ? 'alert' : 'status'}>{error || operation}</span>}
    </div>
    {historyOpen && createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-5 backdrop-blur-sm">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="workspace-version-title" className="flex h-[85vh] max-h-[850px] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl outline-none" onKeyDown={event => {
        if (event.key === 'Escape' && !operation) { event.stopPropagation(); setHistoryOpen(false); }
        if (event.key === 'Tab') {
          const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]') || []);
          const first = elements[0]; const last = elements.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <div className="min-w-0"><h2 id="workspace-version-title" className="text-sm font-semibold">历史版本</h2><p className="truncate text-xs text-muted-foreground" title={workspace}>{workspace}</p></div>
          <Button size="icon-sm" variant="ghost" aria-label="返回当前工作区" disabled={Boolean(operation)} onClick={() => setHistoryOpen(false)}><X className="h-4 w-4" /></Button>
        </div>
        <div className="flex min-h-0 flex-1">
          <div className="w-48 shrink-0 overflow-auto border-r border-border p-2">
            {versions.map(version => <button key={version.id} type="button" disabled={Boolean(operation)} aria-pressed={version.id === selectedId} onClick={() => { setSelectedId(version.id); setError(''); }} className={cn('mb-1 w-full rounded-lg px-3 py-2.5 text-left disabled:opacity-50', version.id === selectedId ? 'bg-primary/10 text-foreground' : 'hover:bg-muted')}>
              <div className="break-words text-xs font-medium">{versionTitle(version)}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{new Date(version.createdAt).toLocaleString('zh-CN')}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">{kindLabels[version.kind]} · {version.changedFiles} 个文件改动{version.id === versions[0]?.id ? ' · 当前基准' : ''}</div>
            </button>)}
          </div>
          <div className="flex w-48 shrink-0 flex-col border-r border-border xl:w-56">
            <div className="border-b border-border p-2"><Input aria-label="搜索版本文件" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索版本文件…" className="h-8 text-xs" /></div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {filesBusy ? <p className="p-2 text-xs text-muted-foreground">正在加载文件…</p> : files.filter(file => file.path.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(file => <button key={file.path} type="button" onClick={() => setFilePath(file.path)} aria-pressed={file.path === filePath} className={cn('flex w-full gap-1.5 rounded-md p-2 text-left text-xs', file.path === filePath ? 'bg-primary/10' : 'hover:bg-muted')}><FileText className="mt-0.5 h-3 w-3 shrink-0" /><span className="break-all">{file.path}</span></button>)}
              {!filesBusy && !files.length && <p className="p-2 text-xs text-muted-foreground">此版本没有文件。</p>}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">正在查看 {selected?.tag} · 只读预览，当前工作区不会改变</div>
            <div className="min-h-0 flex-1">{previewBusy ? <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取历史文件…</div> : preview ? <PreviewViewer key={`${selectedId}:${filePath}`} file={preview} /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">选择文件查看内容</div>}</div>
          </div>
        </div>
        <div className="shrink-0 space-y-2 border-t border-border px-4 py-3">
          {messages}
          {status?.interruptedRestore && <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">上次恢复未完成，请选择恢复前的备份恢复文件。</p>}
          {blocked && <p className="text-xs text-muted-foreground">{blocked}</p>}
          {plan ? <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="mb-2 text-sm font-medium">恢复到 {versionTitle(plan.version)}？</p>
            <p className="mb-2 text-xs text-muted-foreground">{plan.changes.length ? '以下文件将被更改。操作前会自动保留当前状态，对话记录继续保留。未纳入版本管理的内容不会被删除。' : '当前文件与此版本一致，无需恢复。'}</p>
            <Changes changes={plan.changes} />
            <div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={Boolean(operation)} onClick={() => setPlan(null)}>取消</Button><Button size="sm" disabled={disabled || (!plan.changes.length && !status?.interruptedRestore)} onClick={() => void restore()}>{plan.changes.length ? '备份并恢复' : '确认恢复完成'}</Button></div>
          </div> : <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{selected?.fileCount || 0} 个文件 · 选择版本后可查看当时的完整文件内容</span><Button size="sm" variant="outline" disabled={disabled || !selectedId || filesBusy} onClick={() => void prepareRestore()}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />恢复到此版本</Button></div>}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
