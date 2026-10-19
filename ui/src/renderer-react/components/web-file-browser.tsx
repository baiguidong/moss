import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowUp, Check, ChevronRight, Download, File, Folder, Home, LoaderCircle, RefreshCw, Upload, X } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { cn } from '../lib/utils';

type Entry = { path: string; name: string; isDirectory: boolean; size?: number };
type Listing = { path: string; parentPath: string | null; homePath: string; highlightedPath: string | null; entries: Entry[]; offset: number; total: number; hasMore: boolean };
type Options = {
  kind: 'directory' | 'file' | 'any' | 'browse';
  title?: string;
  initialPath?: string;
  revealPath?: string;
  multiple?: boolean;
  extensions?: string[];
  uploadFile?: (file: File) => Promise<{ path: string; name: string }>;
  onSelect?: (entries: Entry[]) => Promise<void>;
};

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { ...init?.headers, ...(window.mossWeb?.generation !== undefined ? { 'X-Moss-Generation': String(window.mossWeb.generation) } : {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '无法读取云电脑文件，请重试。');
  return body;
}

function WebFileBrowser({ options, finish }: { options: Options; finish: (entries: Entry[] | null) => void }) {
  const dialog = React.useRef<HTMLDialogElement>(null);
  const localInput = React.useRef<HTMLInputElement>(null);
  const generation = React.useRef(0);
  const pathEditVersion = React.useRef(0);
  const [location, setLocation] = React.useState({ path: options.initialPath || '', reveal: options.revealPath || '', offset: 0 });
  const [listing, setListing] = React.useState<Listing | null>(null);
  const [pathInput, setPathInput] = React.useState(options.initialPath || '');
  const [query, setQuery] = React.useState('');
  const [hidden, setHidden] = React.useState(false);
  const [revision, setRevision] = React.useState(0);
  const [selected, setSelected] = React.useState<Entry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState('');
  const browsing = options.kind === 'browse';
  const title = options.title || (browsing ? '云电脑文件' : options.kind === 'directory' ? '选择云电脑文件夹' : '选择文件');

  React.useEffect(() => {
    dialog.current?.showModal();
    return () => { generation.current++; };
  }, []);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Menus behind the native modal can consume Escape or restore focus while
      // closing. Capture it before their document handlers, even if focus moved.
      if (event.key !== 'Escape' || !dialog.current?.open
        || Array.from(document.querySelectorAll('dialog:modal')).at(-1) !== dialog.current) return;
      event.preventDefault(); event.stopPropagation();
      if (!pending) finish(null);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pending, finish]);

  React.useEffect(() => {
    const version = ++generation.current;
    const startedPathEdit = pathEditVersion.current;
    const controller = new AbortController();
    setLoading(true); setError(''); setListing(null);
    const params = new URLSearchParams({ kind: options.kind, hidden: String(hidden), query, offset: String(location.offset) });
    if (location.path) params.set('path', location.path);
    if (location.reveal) params.set('reveal', location.reveal);
    for (const extension of options.extensions || []) params.append('extension', extension);
    void request(`/api/file-browser?${params}`, { signal: controller.signal }).then((result: Listing) => {
      if (version !== generation.current) return;
      setListing(result);
      if (startedPathEdit === pathEditVersion.current) setPathInput(result.path);
    }).catch(reason => {
      if (version === generation.current && !controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { if (version === generation.current) setLoading(false); });
    return () => { controller.abort(); generation.current++; };
  }, [location, hidden, query, revision, options]);

  const navigate = (path: string) => {
    generation.current++;
    setPathInput(path); setSelected([]); setQuery('');
    setLocation({ path, reveal: '', offset: 0 });
  };
  const choose = async (entries: Array<{ path: string }>) => {
    if (pending || !entries.length) return;
    setPending(true); setError('');
    try {
      const checked: Entry[] = await request('/api/file-browser/selection', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: entries.map(entry => entry.path), kind: options.kind, extensions: options.extensions || [] }),
      });
      await options.onSelect?.(checked);
      finish(checked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason)); setPending(false);
    }
  };
  const upload = async (files: File[]) => {
    if (pending || !files.length || !options.uploadFile) return;
    setPending(true); setError('');
    try {
      const entries: Entry[] = [];
      for (const file of files) {
        if (options.extensions?.length && !options.extensions.includes(file.name.split('.').pop()!.toLowerCase())) throw new Error(`请选择 ${options.extensions.join('、')} 文件。`);
        entries.push({ ...await options.uploadFile(file), isDirectory: false });
      }
      await options.onSelect?.(entries);
      finish(entries);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason)); setPending(false);
    }
  };
  const selectEntry = (entry: Entry) => {
    if (entry.isDirectory) { navigate(entry.path); return; }
    setSelected(previous => options.multiple
      ? previous.some(item => item.path === entry.path) ? previous.filter(item => item.path !== entry.path) : [...previous, entry]
      : [entry]);
  };
  const currentSelection = selected.length ? selected : listing && ['directory', 'any'].includes(options.kind)
    ? [{ path: listing.path, name: listing.path, isDirectory: true }] : [];

  return <dialog ref={dialog} aria-labelledby="moss-file-browser-title" aria-describedby="moss-file-browser-description"
    className="m-auto w-[min(760px,calc(100vw-24px))] max-w-none rounded-2xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); if (!pending) finish(null); }}>
    <div className="flex max-h-[min(720px,90dvh)] flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div><h2 id="moss-file-browser-title" className="text-lg font-semibold">{title}</h2>
          <p id="moss-file-browser-description" className="mt-1 text-xs text-muted-foreground">{options.uploadFile ? '选择云电脑中的文件，或从本机上传。' : '浏览云电脑中的文件夹和文件。'}</p></div>
        <Button variant="ghost" size="icon-sm" aria-label="关闭文件浏览器" disabled={pending} onClick={() => finish(null)}><X className="h-4 w-4" /></Button>
      </header>
      <div className="space-y-3 border-b border-border px-4 py-3">
        <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); navigate(pathInput.trim()); }}>
          <Button type="button" variant="outline" size="icon-sm" aria-label="返回上级目录" disabled={pending || loading || !listing?.parentPath} onClick={() => navigate(listing!.parentPath!)}><ArrowUp className="h-4 w-4" /></Button>
          <Button type="button" variant="outline" size="icon-sm" aria-label="主目录" disabled={pending} onClick={() => navigate(listing?.homePath || '~')}><Home className="h-4 w-4" /></Button>
          <Input aria-label="云电脑目录路径" value={pathInput} onChange={event => { pathEditVersion.current++; setPathInput(event.target.value); }} placeholder="输入目录路径，或点击文件夹浏览" disabled={pending} className="min-w-0 flex-1 font-mono text-xs" />
          <Button type="submit" variant="outline" size="sm" disabled={pending || !pathInput.trim()}>前往</Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="刷新目录" disabled={pending || loading} onClick={() => setRevision(value => value + 1)}><RefreshCw className="h-4 w-4" /></Button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <Input aria-label="搜索当前目录" placeholder="搜索当前目录" value={query} disabled={pending} onChange={event => { setQuery(event.target.value); setLocation(value => ({ path: listing?.path || value.path, reveal: '', offset: 0 })); }} className="h-8 min-w-0 flex-1" />
          <label className="flex shrink-0 items-center gap-2 text-xs"><input type="checkbox" checked={hidden} disabled={pending} onChange={event => { setHidden(event.target.checked); setLocation(value => ({ ...value, offset: 0 })); }} />显示隐藏项</label>
        </div>
      </div>
      {error && <p role="alert" className="px-5 py-3 text-sm text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="云电脑文件列表" aria-busy={loading || pending}>
        {loading ? <div role="status" className="flex justify-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取目录…</div>
          : listing?.entries.length ? listing.entries.map(entry => {
            const checked = selected.some(item => item.path === entry.path);
            return <div key={entry.path} className={cn('flex items-center rounded-lg', (checked || listing.highlightedPath === entry.path) && 'bg-primary/10')}>
              <button type="button" disabled={pending || (browsing && !entry.isDirectory)}
                aria-label={`${entry.isDirectory ? '打开文件夹' : '选择文件'} ${entry.name}`} aria-pressed={entry.isDirectory || browsing ? undefined : checked}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                onClick={() => selectEntry(entry)}>
                {entry.isDirectory ? <Folder className="h-5 w-5 shrink-0 text-amber-500" /> : <File className="h-5 w-5 shrink-0 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate" title={entry.path}>{entry.name}</span>
                {entry.isDirectory ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : checked ? <Check className="h-4 w-4 shrink-0" /> : null}
              </button>
              {browsing && !entry.isDirectory && <a href={`${window.mossWeb!.fileUrl(entry.path)}&download=1`} download={entry.name} aria-label={`下载 ${entry.name}`} className="mr-2 rounded p-2 hover:bg-muted"><Download className="h-4 w-4" /></a>}
            </div>;
          }) : listing && <p className="py-12 text-center text-sm text-muted-foreground">{query ? '没有匹配的文件或文件夹' : options.kind === 'directory' ? '此目录下没有子文件夹，可选择当前文件夹。' : '此目录为空'}</p>}
      </div>
      {listing && (listing.offset > 0 || listing.hasMore) && <div className="flex items-center justify-center gap-3 border-t border-border p-2 text-xs">
        <Button variant="ghost" size="sm" disabled={pending || listing.offset === 0} onClick={() => setLocation({ path: listing.path, reveal: '', offset: Math.max(0, listing.offset - 200) })}><ArrowLeft className="h-3 w-3" />上一页</Button>
        {listing.offset + 1}–{listing.offset + listing.entries.length} / {listing.total}
        <Button variant="ghost" size="sm" disabled={pending || !listing.hasMore} onClick={() => setLocation({ path: listing.path, reveal: '', offset: listing.offset + 200 })}>下一页<ChevronRight className="h-3 w-3" /></Button>
      </div>}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4">
        {options.uploadFile ? <>
          <input ref={localInput} type="file" hidden multiple={options.multiple} accept={options.extensions?.map(ext => `.${ext}`).join(',')} onChange={event => { void upload(Array.from(event.target.files || [])); event.target.value = ''; }} />
          <Button variant="outline" size="sm" disabled={pending} onClick={() => localInput.current?.click()}><Upload className="h-4 w-4" />从本机上传</Button>
        </> : <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={listing?.path}>{listing?.path}</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => finish(null)}>{browsing ? '关闭' : '取消'}</Button>
          {!browsing && <Button size="sm" disabled={pending || loading || !listing || pathInput !== listing.path || !currentSelection.length} onClick={() => void choose(currentSelection)}>
            {pending && <LoaderCircle className="h-4 w-4 animate-spin" />}{selected.length ? `选择文件${options.multiple ? `（${selected.length}）` : ''}` : options.kind === 'file' ? '选择文件' : '选择此文件夹'}
          </Button>}
        </div>
      </footer>
    </div>
  </dialog>;
}

export function showWebFileBrowser(options: Options): Promise<Entry[] | null> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const previousFocus = document.activeElement;
  return new Promise(resolve => {
    let finished = false;
    const finish = (entries: Entry[] | null) => {
      if (finished) return;
      finished = true;
      queueMicrotask(() => {
        root.unmount(); container.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        resolve(entries);
      });
    };
    root.render(<WebFileBrowser options={options} finish={finish} />);
  });
}
