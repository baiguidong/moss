import * as React from 'react';
import { X, FileText, Image as ImageIcon, MoreHorizontal, Eye, Copy, FolderOpen, ExternalLink } from 'lucide-react';
import { isAppResourceUri } from '../../shared/app-resource-uri.mjs';
import { fileActionCapabilities, performFileAction } from '@/lib/file-actions';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function FilePreview({ path, name, onRemove, readonly = false, sessionId }: {
  path: string; name?: string; onRemove?: () => void; readonly?: boolean; sessionId?: string;
}) {
  const remote = path.startsWith('moss-remote-workspace://');
  const resource = isAppResourceUri(path);
  let resourceName = '';
  if (resource) { try { resourceName = new URL(path).searchParams.get('name') || ''; } catch {} }
  const fileName = name || resourceName || path.split(/[\\/]/).pop() || '文件';
  const isImage = /\.(jpe?g|png|gif|bmp|webp|svg|avif|ico)$/i.test(fileName);
  const [imageUrl, setImageUrl] = React.useState('');
  const [size, setSize] = React.useState<number>();
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const capabilities = fileActionCapabilities(path);
  React.useEffect(() => {
    let cancelled = false;
    setImageUrl(remote && isImage ? path : ''); setSize(undefined); setError('');
    if (!remote && !resource) {
      void window.agentDesktop.fs.getFileMetadata(path).then(metadata => {
        if (!cancelled) setSize(metadata?.size);
      }).catch(() => {});
      if (isImage) void window.agentDesktop.fs.getImageBase64(path).then(url => {
        if (!cancelled) setImageUrl(url || '');
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [path, remote, resource, isImage]);
  async function act(action: Parameters<typeof performFileAction>[1]) {
    setBusy(true); setError('');
    try { await performFileAction(path, action, window.agentDesktop, sessionId); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  const sizeLabel = size === undefined ? '' : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${Math.round(size / 1024)} KB` : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <div className="max-w-full" data-file-attachment={path}>
      <div className="flex max-w-full items-center rounded-lg border border-border/70 bg-card">
        <button type="button" disabled={busy} onClick={() => void act('preview')} title={path} aria-label={`预览 ${fileName}`}
          className="flex min-w-0 items-center gap-2 rounded-lg p-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" onError={() => setImageUrl('')} />
              : isImage ? <ImageIcon className="h-5 w-5 text-muted-foreground" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="max-w-[180px] truncate text-xs font-medium">{fileName}</span>
            <span className="text-[10px] text-muted-foreground">{sizeLabel || '文件'} · 点击预览</span>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" disabled={busy} aria-label={`${fileName} 操作`} className="p-1.5 text-muted-foreground hover:text-foreground"><MoreHorizontal className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void act('preview')}><Eye />预览</DropdownMenuItem>
            {capabilities.system && <DropdownMenuItem onSelect={() => void act('system')}><ExternalLink />{typeof window !== 'undefined' && window.mossWeb ? '打开或下载文件' : '用系统应用打开'}</DropdownMenuItem>}
            {capabilities.reveal && <DropdownMenuItem onSelect={() => void act('reveal')}><FolderOpen />在文件夹中显示</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => void act('copy')}><Copy />复制路径</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {!readonly && onRemove && <button type="button" onClick={onRemove} aria-label={`移除 ${fileName}`} className="p-1.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
      </div>
      {error && <p role="alert" className="mt-1 max-w-[260px] text-xs text-destructive">{error}</p>}
    </div>
  );
}
