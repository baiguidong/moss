/**
 * 画廊视图组件
 */

import * as React from 'react';
import {
  Image,
  FileText,
  Film,
  Music,
  File,
  FileSpreadsheet,
  FileJson,
  FileCode,
  FileArchive,
  Presentation,
  Grid3X3,
  List,
  RefreshCw,
  Eye,
  Play,
  FolderOpen,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FileManagerFile, Category } from './ipc/types';
import { FilePreviewDialog } from './components/FilePreviewDialog';
import { mediaUrl } from './lib/mediaUrl';

type ViewMode = 'grid' | 'list';
type FileTypeFilter = 'all' | 'image' | 'video' | 'document' | 'audio' | 'other';

const fileTypeIcons: Record<string, React.ElementType> = {
  image: Image,
  video: Film,
  document: FileText,
  audio: Music,
  other: File,
};

// 按扩展名细分图标 + 配色, 让文档/文本/代码/压缩包等一眼可辨
type IconStyle = { Icon: React.ElementType; color: string };
const EXT_ICONS: Record<string, IconStyle> = {
  // 文档
  pdf: { Icon: FileText, color: 'text-red-500' },
  doc: { Icon: FileText, color: 'text-blue-500' },
  docx: { Icon: FileText, color: 'text-blue-500' },
  rtf: { Icon: FileText, color: 'text-blue-500' },
  odt: { Icon: FileText, color: 'text-blue-500' },
  // 表格
  xls: { Icon: FileSpreadsheet, color: 'text-green-600' },
  xlsx: { Icon: FileSpreadsheet, color: 'text-green-600' },
  csv: { Icon: FileSpreadsheet, color: 'text-green-600' },
  ods: { Icon: FileSpreadsheet, color: 'text-green-600' },
  // 演示
  ppt: { Icon: Presentation, color: 'text-orange-500' },
  pptx: { Icon: Presentation, color: 'text-orange-500' },
  odp: { Icon: Presentation, color: 'text-orange-500' },
  // 文本 / Markdown
  txt: { Icon: FileText, color: 'text-muted-foreground' },
  md: { Icon: FileText, color: 'text-sky-500' },
  markdown: { Icon: FileText, color: 'text-sky-500' },
  rst: { Icon: FileText, color: 'text-sky-500' },
  log: { Icon: FileText, color: 'text-muted-foreground' },
  // 数据 / 配置
  json: { Icon: FileJson, color: 'text-amber-500' },
  yaml: { Icon: FileCode, color: 'text-amber-500' },
  yml: { Icon: FileCode, color: 'text-amber-500' },
  xml: { Icon: FileCode, color: 'text-amber-500' },
  toml: { Icon: FileCode, color: 'text-amber-500' },
  ini: { Icon: FileCode, color: 'text-amber-500' },
  // 代码
  js: { Icon: FileCode, color: 'text-yellow-500' },
  jsx: { Icon: FileCode, color: 'text-yellow-500' },
  ts: { Icon: FileCode, color: 'text-blue-400' },
  tsx: { Icon: FileCode, color: 'text-blue-400' },
  py: { Icon: FileCode, color: 'text-green-500' },
  java: { Icon: FileCode, color: 'text-red-400' },
  c: { Icon: FileCode, color: 'text-blue-300' },
  cpp: { Icon: FileCode, color: 'text-blue-300' },
  h: { Icon: FileCode, color: 'text-blue-300' },
  go: { Icon: FileCode, color: 'text-cyan-500' },
  rs: { Icon: FileCode, color: 'text-orange-400' },
  rb: { Icon: FileCode, color: 'text-red-500' },
  php: { Icon: FileCode, color: 'text-indigo-400' },
  html: { Icon: FileCode, color: 'text-orange-500' },
  css: { Icon: FileCode, color: 'text-blue-500' },
  scss: { Icon: FileCode, color: 'text-pink-500' },
  sh: { Icon: FileCode, color: 'text-green-400' },
  // 压缩包
  zip: { Icon: FileArchive, color: 'text-purple-500' },
  rar: { Icon: FileArchive, color: 'text-purple-500' },
  '7z': { Icon: FileArchive, color: 'text-purple-500' },
  tar: { Icon: FileArchive, color: 'text-purple-500' },
  gz: { Icon: FileArchive, color: 'text-purple-500' },
};

// 取文件应展示的图标与配色: 优先扩展名细分, 回退到大类
function iconForFile(file: FileManagerFile): IconStyle {
  const ext = (file.extension || '').replace(/^\./, '').toLowerCase();
  if (EXT_ICONS[ext]) return EXT_ICONS[ext];
  const base = fileTypeIcons[file.file_type] || File;
  const color =
    file.file_type === 'image' ? 'text-violet-400'
    : file.file_type === 'video' ? 'text-rose-400'
    : file.file_type === 'audio' ? 'text-emerald-400'
    : 'text-muted-foreground';
  return { Icon: base, color };
}

// 文件类型的中文名称
const fileTypeNames: Record<string, string> = {
  image: '图片',
  video: '视频',
  document: '文档',
  audio: '音频',
  other: '其他',
};

// 格式化时长 (秒 → mm:ss)
function formatDuration(sec?: number): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// 懒加载缩略图: 进入视口才设置 src, 经 moss-media:// 协议直接流式加载
function LazyThumbnail({
  file,
  Icon,
  iconColor = 'text-muted-foreground',
}: {
  file: FileManagerFile;
  Icon: React.ElementType;
  iconColor?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [visible, setVisible] = React.useState(false);
  const [errored, setErrored] = React.useState(false);
  const thumbUrl = file.thumbnail_path ? mediaUrl(file.thumbnail_path) : undefined;
  const duration = formatDuration(file.duration);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const showImage = visible && thumbUrl && !errored;
  // 应有缩略图却缺失(未生成)或加载失败 -> 标记, 便于排查
  const thumbExpected = file.file_type === 'image' || file.file_type === 'video' || file.file_type === 'audio';
  const thumbMissing = thumbExpected && (!thumbUrl || errored);

  return (
    <div
      ref={ref}
      className="relative aspect-square rounded-md bg-muted/30 flex items-center justify-center mb-2 overflow-hidden"
    >
      {showImage ? (
        <img
          src={thumbUrl}
          alt={file.filename}
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <Icon className={cn('h-8 w-8', iconColor)} />
      )}

      {/* 缺缩略图标记: !thumbnail_path 表示未生成, errored 表示文件损坏/格式不支持 */}
      {thumbMissing && (
        <span
          className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-amber-500/90 px-1 py-0.5 text-[10px] font-medium text-white"
          title={!thumbUrl ? '未生成缩略图(可能格式不支持或生成失败)' : '缩略图加载失败(文件可能已损坏或丢失)'}
        >
          <AlertCircle className="h-2.5 w-2.5" />
          无缩略图
        </span>
      )}

      {/* 视频: 播放图标叠加 + 时长角标 */}
      {file.file_type === 'video' && (
        <>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="rounded-full bg-black/40 p-2">
              <Play className="h-5 w-5 text-white fill-white" />
            </div>
          </div>
          {duration && (
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
              {duration}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function GalleryView() {
  const [files, setFiles] = React.useState<FileManagerFile[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid');
  const [fileTypeFilter, setFileTypeFilter] = React.useState<FileTypeFilter>('all');
  const [selectedFile, setSelectedFile] = React.useState<FileManagerFile | null>(null);
  const [previewFile, setPreviewFile] = React.useState<FileManagerFile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [thumbProgress, setThumbProgress] = React.useState<{ processed: number; total: number } | null>(null);

  // 组件挂载态 + 请求序号: 避免卸载后 setState 及旧请求覆盖新结果
  const mountedRef = React.useRef(true);
  const loadReqRef = React.useRef(0);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const loadData = React.useCallback(async () => {
    const reqId = ++loadReqRef.current;
    setLoading(true);
    try {
      // 确保 fileManager 已初始化
      if (!window.fileManager) {
        await import('./ipc/fileManager.ipc');
      }

      const [filesResult, categoriesResult] = await Promise.all([
        window.fileManager?.getFiles({ limit: 1000 }),
        window.fileManager?.getCategories(),
      ]);

      // 仅当仍挂载且这是最新一次请求时才应用结果
      if (!mountedRef.current || reqId !== loadReqRef.current) return;
      if (filesResult) setFiles(filesResult as FileManagerFile[]);
      if (categoriesResult) setCategories(categoriesResult as Category[]);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      if (mountedRef.current && reqId === loadReqRef.current) setLoading(false);
    }
  }, []);

  // 加载文件和分类
  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // 监听缩略图生成进度(扫描后自动后台生成 + 手动触发都会推送)
  // 生成过程中分批刷新, 让缩略图边生成边出现; 完成后再全量刷新一次
  const lastRefreshAtRef = React.useRef(0);
  React.useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    const setup = async () => {
      if (!window.fileManager) {
        await import('./ipc/fileManager.ipc');
      }
      unsubscribe = window.fileManager?.onThumbnailProgress((p) => {
        const finished = p.status === 'completed' || p.status === 'done' || p.status === 'error';
        if (finished) {
          setThumbProgress(null);
          if (p.status !== 'error') loadData();
        } else {
          setThumbProgress({ processed: p.processed, total: p.total });
          // 进行中: 最多每 1.5s 刷新一次, 让已生成的缩略图渐次显示
          const now = Date.now();
          if (now - lastRefreshAtRef.current > 1500) {
            lastRefreshAtRef.current = now;
            loadData();
          }
        }
      });
    };
    setup();
    return () => unsubscribe?.();
  }, [loadData]);

  // 手动触发缩略图 / 媒体增强
  const handleGenerateThumbnails = async () => {
    try {
      if (!window.fileManager) {
        await import('./ipc/fileManager.ipc');
      }
      setThumbProgress({ processed: 0, total: 0 });
      await window.fileManager?.generateThumbnails();
    } catch (err) {
      console.error('Failed to generate thumbnails:', err);
      setThumbProgress(null);
    }
  };

  // 筛选文件
  const filteredFiles = files.filter((file) => {
    if (fileTypeFilter === 'all') return true;
    return file.file_type === fileTypeFilter;
  });

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  // 打开预览
  const handleOpenPreview = (file: FileManagerFile) => {
    setPreviewFile(file);
  };

  // 关闭预览
  const handleClosePreview = () => {
    setPreviewFile(null);
  };

  // 导航到其他文件
  const handleNavigatePreview = (file: FileManagerFile) => {
    setPreviewFile(file);
  };

  // 在系统文件管理器中定位文件(用于排查缩略图等问题)
  const handleReveal = async (file: FileManagerFile) => {
    try {
      if (!window.fileManager) await import('./ipc/fileManager.ipc');
      const res = await window.fileManager?.revealInFolder(file.path);
      if (res && !res.success) {
        console.warn('[Gallery] reveal failed:', res.error);
        alert(res.error || '无法定位文件');
      }
    } catch (err) {
      console.error('Failed to reveal file:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
        {/* 文件类型筛选 */}
        <div className="flex items-center gap-2">
          <Button
            variant={fileTypeFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setFileTypeFilter('all')}
          >
            全部
          </Button>
          {(['image', 'video', 'document', 'audio'] as FileTypeFilter[]).map((type) => {
            const Icon = fileTypeIcons[type];
            return (
              <Button
                key={type}
                variant={fileTypeFilter === type ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setFileTypeFilter(type)}
                className="gap-2"
              >
                <Icon className="h-4 w-4" />
                {fileTypeNames[type]}
              </Button>
            );
          })}
        </div>

        {/* 视图模式切换 */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleGenerateThumbnails}
            disabled={thumbProgress !== null}
            className="gap-2"
            title="为缺失缩略图的图片/视频/音频生成缩略图与时长"
          >
            <RefreshCw className={cn('h-4 w-4', thumbProgress !== null && 'animate-spin')} />
            生成缩略图
          </Button>
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 文件数量 / 缩略图进度 */}
      <div className="flex items-center justify-between px-4 py-2 text-sm text-muted-foreground">
        <span>共 {filteredFiles.length} 个文件</span>
        {thumbProgress !== null && (
          <span className="text-xs">
            生成缩略图中… {thumbProgress.processed}
            {thumbProgress.total > 0 ? ` / ${thumbProgress.total}` : ''}
          </span>
        )}
      </div>

      {/* 文件展示 */}
      <div className="flex-1 overflow-auto px-4 pb-4">
        {filteredFiles.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-muted-foreground">暂无文件，请先扫描目录</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {filteredFiles.map((file) => {
              const { Icon, color } = iconForFile(file);

              return (
                <div
                  key={file.id}
                  className={cn(
                    'group relative rounded-lg border border-border/40 p-2 cursor-pointer',
                    'hover:border-primary/50 hover:bg-muted/50',
                    selectedFile?.id === file.id && 'border-primary bg-primary/5'
                  )}
                  onClick={() => setSelectedFile(file)}
                  onDoubleClick={() => handleOpenPreview(file)}
                >
                  {/* 文件预览区域 (懒加载缩略图) */}
                  <LazyThumbnail file={file} Icon={Icon} iconColor={color} />

                  {/* 文件名 */}
                  <p className="text-xs truncate">{file.filename}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>

                  {/* 操作按钮: 预览 + 在文件夹中定位 */}
                  <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 w-6 p-0"
                      title="在文件夹中显示"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReveal(file);
                      }}
                    >
                      <FolderOpen className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-6 w-6 p-0"
                      title="预览"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenPreview(file);
                      }}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1">
            {filteredFiles.map((file) => {
              const { Icon, color } = iconForFile(file);
              return (
                <div
                  key={file.id}
                  className={cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 cursor-pointer',
                    'hover:bg-muted/50',
                    selectedFile?.id === file.id && 'bg-primary/5'
                  )}
                  onClick={() => setSelectedFile(file)}
                  onDoubleClick={() => handleOpenPreview(file)}
                >
                  <Icon className={cn('h-4 w-4', color)} />
                  <span className="text-sm truncate flex-1">{file.filename}</span>
                  {!file.thumbnail_path && (file.file_type === 'image' || file.file_type === 'video' || file.file_type === 'audio') && (
                    <span className="flex items-center gap-0.5 text-[10px] text-amber-600" title="未生成缩略图">
                      <AlertCircle className="h-3 w-3" />
                      无缩略图
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground w-16 text-right">{formatSize(file.size)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    title="在文件夹中显示"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReveal(file);
                    }}
                  >
                    <FolderOpen className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    title="预览"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenPreview(file);
                    }}
                  >
                    <Eye className="h-3 w-3" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 文件预览对话框 */}
      {previewFile && (
        <FilePreviewDialog
          file={previewFile}
          files={filteredFiles}
          onClose={handleClosePreview}
          onNavigate={handleNavigatePreview}
        />
      )}
    </div>
  );
}

export default GalleryView;
