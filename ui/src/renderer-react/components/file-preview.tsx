import * as React from 'react';
import { X, FileText, FileSpreadsheet, FileArchive, FileCode2, Image as ImageIcon, Presentation, Film, Music, MoreHorizontal, Eye, Copy, FolderOpen, ExternalLink } from 'lucide-react';
import { PdfFileIcon } from '@/components/pdf-file-icon';
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
  const extension = fileName.match(/\.([^.]+)$/)?.[1]?.toUpperCase() || '';
  const typeLabel = extension.length > 8 ? '文件' : extension || '文件';
  const fileIcon = /^(PNG|JPE?G|GIF|BMP|WEBP|SVG|AVIF|ICO|TIFF?)$/.test(extension)
    ? { Icon: ImageIcon, color: 'bg-violet-500/10 text-violet-500' }
    : extension === 'PDF' ? { Icon: PdfFileIcon, color: 'bg-red-500/10 text-red-500' }
    : /^(XLSX?|CSV|TSV|ODS|NUMBERS)$/.test(extension) ? { Icon: FileSpreadsheet, color: 'bg-green-500/10 text-green-600' }
    : /^(PPTX?|PPSX?|ODP|KEY)$/.test(extension) ? { Icon: Presentation, color: 'bg-orange-500/10 text-orange-500' }
    : /^(ZIP|RAR|7Z|TAR|GZ|BZ2)$/.test(extension) ? { Icon: FileArchive, color: 'bg-purple-500/10 text-purple-500' }
    : /^(MP3|WAV|M4A|FLAC|AAC|OGG)$/.test(extension) ? { Icon: Music, color: 'bg-emerald-500/10 text-emerald-500' }
    : /^(MP4|MOV|AVI|MKV|WEBM)$/.test(extension) ? { Icon: Film, color: 'bg-rose-500/10 text-rose-500' }
    : /^(JS|JSX|TS|TSX|PY|GO|RS|JAVA|HTML|CSS|SCSS|JSON|XML|YAML|YML|SQL|SH)$/.test(extension)
      ? { Icon: FileCode2, color: 'bg-sky-500/10 text-sky-500' }
      : { Icon: FileText, color: 'bg-muted text-muted-foreground' };
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
    <div className="w-[230px] max-w-full" data-file-attachment={path}>
      <div className="flex min-w-0 items-center overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm transition-colors hover:border-primary/30 hover:bg-muted/20">
        <button type="button" disabled={busy} onClick={() => void act('preview')} title={path} aria-label={`预览 ${fileName}`}
          className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60">
          <span className={`flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md ${fileIcon.color}`}>
            {imageUrl ? <img src={imageUrl} alt="" className="h-full w-full object-cover" onError={() => setImageUrl('')} />
              : <fileIcon.Icon className={extension === 'PDF' ? 'h-6 w-6' : 'h-4 w-4'} aria-hidden="true" />}
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="truncate text-xs font-semibold" title={fileName}>{fileName}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground" title={sizeLabel || '点击预览'}>{typeLabel}</span>
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" disabled={busy} aria-label={`${fileName} 操作`} className="mr-1.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"><MoreHorizontal className="h-3.5 w-3.5" /></button></DropdownMenuTrigger>
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
