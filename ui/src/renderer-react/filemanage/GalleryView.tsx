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
  Grid3X3,
  List,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FileManagerFile, Category } from '../ipc/types';
import { FilePreviewDialog } from './components/FilePreviewDialog';

type ViewMode = 'grid' | 'list';
type FileTypeFilter = 'all' | 'image' | 'video' | 'document' | 'audio' | 'other';

const fileTypeIcons: Record<string, React.ElementType> = {
  image: Image,
  video: Film,
  document: FileText,
  audio: Music,
  other: File,
};

// 文件类型的中文名称
const fileTypeNames: Record<string, string> = {
  image: '图片',
  video: '视频',
  document: '文档',
  audio: '音频',
  other: '其他',
};

export function GalleryView() {
  const [files, setFiles] = React.useState<FileManagerFile[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid');
  const [fileTypeFilter, setFileTypeFilter] = React.useState<FileTypeFilter>('all');
  const [selectedFile, setSelectedFile] = React.useState<FileManagerFile | null>(null);
  const [previewFile, setPreviewFile] = React.useState<FileManagerFile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [thumbnailCache, setThumbnailCache] = React.useState<Map<number, string>>(new Map());

  // 加载文件和分类
  React.useEffect(() => {
    const loadData = async () => {
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

        if (filesResult) setFiles(filesResult as FileManagerFile[]);
        if (categoriesResult) setCategories(categoriesResult as Category[]);
      } catch (err) {
        console.error('Failed to load data:', err);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // 加载缩略图
  React.useEffect(() => {
    const loadThumbnails = async () => {
      const imageFiles = files.filter(f => f.file_type === 'image' && f.thumbnail_path);
      const newCache = new Map(thumbnailCache);

      for (const file of imageFiles.slice(0, 20)) { // 只加载前20个缩略图
        if (!newCache.has(file.id) && file.thumbnail_path) {
          try {
            const result = await window.fileManager?.readFile(file.thumbnail_path, true);
            if (result?.dataUrl) {
              newCache.set(file.id, result.dataUrl);
            }
          } catch (err) {
            // 忽略错误
          }
        }
      }

      setThumbnailCache(newCache);
    };

    if (files.length > 0) {
      loadThumbnails();
    }
  }, [files]);

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

      {/* 文件数量 */}
      <div className="px-4 py-2 text-sm text-muted-foreground">
        共 {filteredFiles.length} 个文件
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
              const Icon = fileTypeIcons[file.file_type] || File;
              const thumbnailUrl = thumbnailCache.get(file.id);

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
                  {/* 文件预览区域 */}
                  <div className="aspect-square rounded-md bg-muted/30 flex items-center justify-center mb-2 overflow-hidden">
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt={file.filename}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Icon className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>

                  {/* 文件名 */}
                  <p className="text-xs truncate">{file.filename}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>

                  {/* 预览按钮 */}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
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
        ) : (
          <div className="space-y-1">
            {filteredFiles.map((file) => {
              const Icon = fileTypeIcons[file.file_type] || File;
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
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm truncate flex-1">{file.filename}</span>
                  <span className="text-xs text-muted-foreground w-16 text-right">{formatSize(file.size)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
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
