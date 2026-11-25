import * as React from 'react';
import { ChevronRight, FolderOpen, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { isWebUI } from '@/lib/host-environment';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import type { ArchivedChat, StorageAppMode, StorageEntry, StorageCacheCleanupResult, StorageCleanupResult, StorageOverview, StorageReview } from '../types';

const colors: Record<string, string> = { sessions: 'bg-blue-400', subagents: 'bg-cyan-400', archived: 'bg-sky-600', projects: 'bg-indigo-400', apps: 'bg-violet-400', 'app-data': 'bg-fuchsia-400', 'app-state': 'bg-purple-400', runtimes: 'bg-teal-400', resources: 'bg-emerald-400', cache: 'bg-amber-400', history: 'bg-orange-400', logs: 'bg-slate-400', other: 'bg-zinc-300 dark:bg-zinc-600' };
const selectClass = 'h-9 rounded-lg border border-border bg-background px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring';
function bytes(value: number) {
  if (!value) return '0 B';
  const unit = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit ? 1 : 0 })} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
}
function message(error: unknown) {
  return cleanIpcErrorMessage(error instanceof Error ? error.message : String(error));
}

function AppStorageDialog({ entry, close, onChanged }: {
  entry: StorageEntry; close(): void; onChanged(result: string): void;
}) {
  const [mode, setMode] = React.useState<StorageAppMode | null>(entry.installed ? 'history' : null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const ref = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => { ref.current?.showModal(); }, []);
  const choices: { value: StorageAppMode; title: string; detail: string }[] = [
    { value: 'history', title: '仅清理历史安装包', detail: '保留当前版本、使用中的版本和应用数据。清理的版本将无法直接回退。' },
    { value: 'uninstall', title: '卸载并保留数据', detail: '移除全部安装包，重新安装后可继续使用已有数据。' },
    { value: 'purge', title: entry.installed ? '卸载并删除数据' : '删除保留的数据', detail: '永久删除此应用的本地数据和保存的凭据。' },
  ];
  const selected = choices.find(choice => choice.value === mode);
  async function apply() {
    if (!mode || !entry.appId || busy) return;
    setBusy(true); setError('');
    try {
      const result = await window.agentDesktop.storage.cleanApp({ appId: entry.appId, mode, expectedVersion: entry.version ?? null });
      const status = mode === 'history' ? result.removed ? `已清理 ${result.removed} 个历史安装包` : '没有可清理的历史安装包'
        : mode === 'uninstall' ? '已卸载，应用数据已保留' : '已清理安装包和应用数据';
      onChanged(`「${entry.label}」${status}。`);
    } catch (cause) { setError(message(cause)); setBusy(false); }
  }
  return <dialog ref={ref} aria-labelledby="app-storage-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}
    className="m-auto w-[min(440px,calc(100vw-32px))] rounded-xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/35">
    <h2 id="app-storage-title" className="break-words text-base font-semibold">管理「{entry.label}」</h2>
    <p className="mt-1 text-xs text-muted-foreground">安装包 {bytes(entry.packageBytes ?? 0)} · 应用数据 {bytes(entry.dataBytes ?? 0)}</p>
    <fieldset disabled={busy} className="my-5 space-y-4"><legend className="sr-only">清理方式</legend>
      {choices.filter(choice => entry.installed || choice.value === 'purge').map(choice => <label key={choice.value} className="flex cursor-pointer items-start gap-3">
        <input className="mt-1 accent-primary" type="radio" name="app-storage-mode" value={choice.value} checked={mode === choice.value} onChange={() => setMode(choice.value)} />
        <span><span className="block text-sm">{choice.title}</span><span className="mt-1 block text-xs text-muted-foreground">{choice.detail}</span></span>
      </label>)}
    </fieldset>
    {error && <p role="alert" className="mb-3 text-xs text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <Button size="sm" variant="outline" disabled={busy} onClick={close}>取消</Button>
      <Button size="sm" variant={mode === 'history' ? 'default' : 'destructive'} disabled={!mode || busy} onClick={() => void apply()}>
        {busy ? '正在处理…' : selected?.title ?? '确认删除'}
      </Button>
    </div>
  </dialog>;
}

export function StorageSettings() {
  const [managedApp, setManagedApp] = React.useState<StorageEntry | null>(null);
  const [appResult, setAppResult] = React.useState('');
  const [overview, setOverview] = React.useState<StorageOverview | null>(null);
  const [scanning, setScanning] = React.useState(true);
  const [reviewing, setReviewing] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [archivedOnly, setArchivedOnly] = React.useState(true);
  const [archives, setArchives] = React.useState<ArchivedChat[] | null>(null);
  const [archiveBusy, setArchiveBusy] = React.useState(false);
  const [archiveQuery, setArchiveQuery] = React.useState('');
  const archiveDialog = React.useRef<HTMLDialogElement>(null);
  const [days, setDays] = React.useState(90);
  const [review, setReview] = React.useState<StorageReview | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<StorageCleanupResult | null>(null);
  const [cacheCleaning, setCacheCleaning] = React.useState(false);
  const [cacheResult, setCacheResult] = React.useState<StorageCacheCleanupResult | null>(null);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const live = React.useRef(false);
  const generation = React.useRef(0);
  const refresh = React.useCallback(async (force = false) => {
    const request = ++generation.current;
    setScanning(true); setError('');
    try {
      const next = await window.agentDesktop.storage.getOverview({ refresh: force });
      if (live.current && request === generation.current) setOverview(next);
    } catch (error) {
      if (live.current && request === generation.current) setError(message(error));
    } finally {
      if (live.current && request === generation.current) setScanning(false);
    }
  }, []);
  React.useEffect(() => {
    live.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      live.current = false;
      generation.current++;
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);
  React.useEffect(() => {
    if (review) dialog.current?.showModal();
    else dialog.current?.close();
  }, [review]);

  React.useEffect(() => {
    if (archives) archiveDialog.current?.showModal(); else archiveDialog.current?.close();
  }, [archives]);
  async function openArchives() {
    setArchiveBusy(true); setError('');
    try { const next = await window.agentDesktop.storage.listArchives(); if (live.current) { setArchives(next); setArchiveQuery(''); } }
    catch (error) { if (live.current) setError(message(error)); }
    finally { if (live.current) setArchiveBusy(false); }
  }
  async function restoreArchive(id: string) {
    setArchiveBusy(true);
    try {
      await window.agentDesktop.storage.setArchived({ sessionId: id, archived: false });
      if (live.current) { setArchives(previous => previous?.filter(item => item.id !== id) ?? null); void refresh(); }
    } catch (error) { if (live.current) { setArchives(null); setError(message(error)); } }
    finally { if (live.current) setArchiveBusy(false); }
  }
  const closeReview = () => { if (!deleting) { setReview(null); setConfirming(false); } };
  async function reviewChats(archivedId?: string) {
    setReviewing(true); setError(''); setResult(null);
    try {
      const next = await window.agentDesktop.storage.reviewChats(archivedId ? { archivedIds: [archivedId] } : { days, archivedOnly });
      if (live.current) { setArchives(null); setReview(next); setSelected(new Set()); setConfirming(false); }
    } catch (error) { if (live.current) setError(message(error)); }
    finally { if (live.current) setReviewing(false); }
  }
  async function deleteChats() {
    if (!review || !selected.size || deleting) return;
    setDeleting(true);
    try {
      const next = await window.agentDesktop.storage.deleteChats({ token: review.token, ids: [...selected] });
      if (live.current) { setResult(next); setReview(null); setConfirming(false); void refresh(); }
    } catch (error) {
      // A delete token is single-use. Require a fresh preview after any failure.
      if (live.current) { setReview(null); setError(`${message(error)} 请重新查看待清理会话。`); }
    } finally { if (live.current) setDeleting(false); }
  }
  async function clearCaches() {
    if (cacheCleaning || scanning) return;
    setCacheCleaning(true); setError(''); setCacheResult(null);
    try {
      const next = await window.agentDesktop.storage.clearCaches();
      if (live.current) { setCacheResult(next); void refresh(); }
    } catch (error) { if (live.current) setError(message(error)); }
    finally { if (live.current) setCacheCleaning(false); }
  }
  const selectedBytes = review?.items.reduce((sum, item) => sum + (selected.has(item.id) ? item.bytes : 0), 0) ?? 0;
  return <div className="space-y-7" data-storage-settings>
    <div className="space-y-5" aria-busy={scanning}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium">{isWebUI() ? '此云电脑' : '此设备'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">管理 Moss 的本地数据与缓存</p>
          <p className="mt-5 text-xl font-semibold tracking-tight tabular-nums">{overview ? `${overview.complete ? '' : '已统计 '}${bytes(overview.totalBytes)}` : '—'}<span className="ml-2 text-xs font-normal text-muted-foreground">由 Moss 使用</span></p>
          <p className="mt-1 text-xs text-muted-foreground" role="status">{scanning ? '正在计算存储占用，大目录可能需要一些时间…' : overview && !overview.complete ? `${overview.errorCount} 处无法读取，受影响的分类已标记。` : ''}</p>
        </div>
        <Button variant="outline" size="sm" className="rounded-lg" disabled={scanning || deleting} onClick={() => void refresh(true)}>
          <RefreshCw className={cn('mr-2 h-3.5 w-3.5', scanning && 'animate-spin')} />刷新
        </Button>
      </div>
      {overview && <>
        <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`存储占用 ${bytes(overview.totalBytes)}${overview.complete ? '' : '，统计不完整'}`}>
          {overview.categories.map(category => category.bytes > 0 && <div key={category.id}
            title={`${category.label} ${bytes(category.bytes)}`} className={colors[category.id]}
            style={{ width: `${category.bytes / overview.totalBytes * 100}%` }} />)}
        </div>
        {(() => {
          const cache = overview.categories.find(category => category.id === 'cache');
          return cache ? <div className="mb-2 border-b border-border py-4" data-storage-cache>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-[13px] font-medium">缓存</h3>
                <p className="mt-1 text-xl font-semibold tabular-nums">{bytes(cache.bytes)}</p>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">清理临时文件和可重新下载的资源，保留已安装应用的所有版本及应用数据。</p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 rounded-lg" disabled={cacheCleaning || scanning || isWebUI()} onClick={() => void clearCaches()}>
                {cacheCleaning ? '正在清理…' : '清理'}
              </Button>
            </div>
            {cacheResult && <p role="status" className="mt-3 text-xs text-muted-foreground">已清理 {bytes(cacheResult.deletedBytes)}{cacheResult.failed ? `，${cacheResult.failed} 项未能清理` : ''}。</p>}
          </div> : null;
        })()}
        <div className="divide-y divide-border">
          {overview.categories.filter(category => category.entries.length || !category.complete).map(category => <details key={category.id} open={category.id === 'apps' || category.id === 'runtimes'} className="group" data-storage-category={category.id}>
            <summary className="flex cursor-pointer list-none items-center gap-2.5 py-3 text-[13px] [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className={cn('h-2 w-2 rounded-full', colors[category.id])} />
              <span className="flex-1">{category.label}</span><span className="tabular-nums text-muted-foreground">{category.complete ? bytes(category.bytes) : category.bytes ? `已统计 ${bytes(category.bytes)}` : '未能读取'}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform group-open:rotate-90" />
            </summary>
            <div className="mb-3 max-h-72 space-y-2 overflow-auto pl-4.5 pr-2">
              {category.entries.map(entry => entry.appId ? <div key={entry.appId} className="flex items-center gap-3 py-1 text-xs" data-storage-app={entry.appId}>
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium" title={entry.appId}>{entry.label}</span>
                  <span className="text-muted-foreground">安装包 {bytes(entry.packageBytes ?? 0)} · 数据 {bytes(entry.dataBytes ?? 0)}</span></span>
                <span className="tabular-nums text-muted-foreground">{entry.complete ? bytes(entry.bytes) : '未完整读取'}</span>
                {!isWebUI() && <Button size="sm" variant="outline" className="h-7 px-2" aria-label={`管理「${entry.label}」的存储`} onClick={() => { setManagedApp(entry); setAppResult(''); }}>管理</Button>}
              </div> : <div key={entry.path} className="flex items-start justify-between gap-4 text-xs text-muted-foreground"><span className="min-w-0 break-all font-mono">{entry.path}</span><span className="shrink-0 tabular-nums">{entry.complete ? bytes(entry.bytes) : '未完整读取'}</span></div>)}
            </div>
          </details>)}
          {appResult && <p role="status" className="py-2 text-xs text-muted-foreground">{appResult}</p>}
        </div>
      </>}
    </div>

    <div>
      <h2 className="text-sm font-semibold">清理旧会话</h2>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">检查旧会话及其子会话，选择后永久删除。正在使用的会话会自动保留。</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-3 text-[13px]">未更新超过
          <select aria-label="旧会话保留天数" className={selectClass} value={days} disabled={reviewing || deleting} onChange={event => setDays(Number(event.target.value))}>
            {[30, 90, 180, 365].map(value => <option key={value} value={value}>{value} 天</option>)}
          </select>
        </label>
        <Button variant="outline" className="h-9 rounded-lg text-[13px]" disabled={reviewing || deleting} onClick={() => void reviewChats()}>
          {reviewing ? '正在检查…' : '查看待清理会话'}
        </Button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={archivedOnly} onChange={event => setArchivedOnly(event.target.checked)} />仅查看已归档会话</label>
      {result && <p role="status" className="mt-4 text-xs leading-5 text-muted-foreground">已删除 {result.deleted} 个会话，跳过 {result.skipped} 个，失败 {result.failed} 个。{result.skipped > 0 && '有更新或正在使用的会话已保留。'}{result.failed > 0 && '部分数据未能移除，请刷新后检查。'}</p>}
    </div>

    <div className="flex items-center justify-between gap-4 border-t border-border pt-5">
      <div><h2 className="text-[13px] font-medium">已归档会话</h2><p className="mt-1 text-xs text-muted-foreground">恢复会话，或查看后永久删除。</p></div>
      <Button variant="outline" size="sm" disabled={archiveBusy || reviewing || deleting} onClick={() => void openArchives()}>管理归档</Button>
    </div>
    <div className="border-t border-border pt-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-medium">数据位置</h2>
          {overview && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{overview.root}</p>}
        </div>
        {!isWebUI() && overview && <Button variant="ghost" size="icon" aria-label="打开数据文件夹" onClick={async () => {
          try { const error = await window.agentDesktop.shell.openFile(overview.root); if (error && live.current) setError(error); }
          catch (error) { if (live.current) setError(message(error)); }
        }}><FolderOpen className="h-4 w-4" /></Button>}
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">统计此目录下的全部数据，包含隐藏目录和缓存；展开分类可查看来源。{overview?.sizeKind === 'allocated' ? '按磁盘分配空间计算。' : '按文件大小计算。'}外部工作区与远端数据不计入。</p>
    </div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {managedApp && <AppStorageDialog entry={managedApp} close={() => setManagedApp(null)} onChanged={status => {
      setAppResult(status); setManagedApp(null); void refresh(true);
    }} />}

    <dialog ref={archiveDialog} aria-labelledby="archive-title" onCancel={event => { event.preventDefault(); if (!archiveBusy && !reviewing) setArchives(null); }}
      onClose={() => { if (!archiveBusy && !reviewing) setArchives(null); }}
      className="m-auto max-h-[85vh] w-[min(600px,calc(100vw-32px))] overflow-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/35">
      <div className="flex items-center justify-between"><h2 id="archive-title" className="text-base font-semibold">已归档会话</h2><Button variant="ghost" size="icon" aria-label="关闭归档管理" disabled={archiveBusy || reviewing} onClick={() => setArchives(null)}><X className="h-4 w-4" /></Button></div>
      <p className="mt-1 text-xs text-muted-foreground">归档保留全部内容，可随时恢复到会话列表。</p>
      <input aria-label="搜索归档会话" placeholder="搜索归档会话" value={archiveQuery} onChange={event => setArchiveQuery(event.target.value)} className="my-4 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" />
      <div className="max-h-[50vh] overflow-auto divide-y divide-border">
        {archives?.filter(item => item.title.toLowerCase().includes(archiveQuery.toLowerCase())).map(item => <div key={item.id} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1"><p className="truncate text-sm">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(item.archivedAt).toLocaleDateString('zh-CN')} 归档{item.subagents ? ` · ${item.subagents} 个子会话` : ''}</p></div>
          <Button variant="outline" size="sm" disabled={archiveBusy || reviewing} onClick={() => void restoreArchive(item.id)}>恢复</Button>
          <Button variant="ghost" size="sm" className="text-destructive" disabled={archiveBusy || reviewing} onClick={() => void reviewChats(item.id)}>删除…</Button>
        </div>)}
        {!archives?.some(item => item.title.toLowerCase().includes(archiveQuery.toLowerCase())) && <p className="py-10 text-center text-sm text-muted-foreground">{archiveQuery ? '没有匹配的会话。' : '暂无归档会话。'}</p>}
      </div>
    </dialog>
    <dialog ref={dialog} aria-labelledby="storage-review-title" aria-describedby="storage-review-description"
      onCancel={event => { event.preventDefault(); closeReview(); }} onClose={() => { if (!deleting) setReview(null); }}
      className="m-auto max-h-[85vh] w-[min(600px,calc(100vw-32px))] overflow-auto rounded-xl border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/35">
      {review && <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="storage-review-title" className="text-lg font-semibold">{confirming ? '删除所选会话？' : '查看旧会话'}</h2>
          <Button variant="ghost" size="icon" aria-label="关闭清理预览" disabled={deleting} onClick={closeReview}><X className="h-4 w-4" /></Button>
        </div>
        <p id="storage-review-description" className="mt-2 text-xs leading-5 text-muted-foreground">
          {confirming ? `将永久删除 ${selected.size} 个会话及其子会话、Moss 管理的会话文件和关联定时任务，约 ${bytes(selectedBytes)}。此操作无法撤销。外部工作区文件会保留。`
            : `${review.days ? `以下会话超过 ${review.days} 天未更新。` : '查看所选归档会话。'}删除会一并移除子会话、Moss 管理的会话文件和关联定时任务。请先确认需要保留的文件。`}
        </p>
        {!confirming && <>
          {review.items.length ? <div className="my-4 max-h-[40vh] overflow-auto divide-y divide-border rounded-lg border border-border px-3">
            {review.items.map(item => <label key={item.id} className="flex cursor-pointer items-center gap-3 py-3">
              <input type="checkbox" className="h-4 w-4 shrink-0 accent-foreground" aria-label={`选择 ${item.title}`} checked={selected.has(item.id)}
                onChange={event => setSelected(previous => { const next = new Set(previous); if (event.target.checked) next.add(item.id); else next.delete(item.id); return next; })} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm">{item.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{new Date(item.updatedAt).toLocaleDateString('zh-CN')}{item.subagents ? ` · ${item.subagents} 个子会话` : ''}</span>
              </span><span className="shrink-0 text-xs tabular-nums text-muted-foreground">{bytes(item.bytes)}</span>
            </label>)}
          </div> : <p className="py-8 text-center text-sm text-muted-foreground">没有符合条件的会话。</p>}
          {(review.skipped > 0 || review.hasMore) && <p className="mb-3 text-xs leading-5 text-muted-foreground">{review.skipped > 0 && `${review.skipped} 个会话未能完整读取或已发生变化，已跳过。`}{review.hasMore && '本次仅显示部分会话，处理后可再次查看。'}</p>}
          <p className="text-xs text-muted-foreground">已选择 {selected.size} 个 · 约 {bytes(selectedBytes)}</p>
        </>}
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => confirming ? setConfirming(false) : closeReview()}>{confirming ? '返回' : '取消'}</Button>
          <Button variant={confirming ? 'destructive' : 'default'} disabled={!selected.size || deleting}
            onClick={() => confirming ? void deleteChats() : setConfirming(true)}>
            {deleting ? '正在删除…' : confirming ? '永久删除' : '继续'}
          </Button>
        </div>
      </div>}
    </dialog>
  </div>;
}
