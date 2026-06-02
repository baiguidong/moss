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
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { FileManagerFile, Category } from '../ipc/types';

type ViewMode = 'grid' | 'list';
type FileTypeFilter = 'all' | 'image' | 'video' | 'document' | 'audio' | 'other';

const fileTypeIcons: Record<string, React.ElementType> = {
  image: Image,
  video: Film,
  document: FileText,
  audio: Music,
  other: File,
};

export function GalleryView() {
  const [files, setFiles] = React.useState<FileManagerFile[]>([]);
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [viewMode, setViewMode] = React.useState<ViewMode>('grid');
  const [fileTypeFilter, setFileTypeFilter] = React.useState<FileTypeFilter>('all');
  const [selectedFile, setSelectedFile] = React.useState<FileManagerFile | null>(null);
  const [loading, setLoading] = React.useState(true);

  // 加载文件和分类
  React.useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
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
                {type === 'image' ? '图片' :
                 type === 'video' ? '视频' :
                 type === 'document' ? '文档' : '音乐'}
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
            <p className="text-muted-foreground">暂无文件</p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {filteredFiles.map((file) => {
              const Icon = fileTypeIcons[file.file_type] || File;
              return (
                <div
                  key={file.id}
                  className={cn(
                    'group relative rounded-lg border border-border/40 p-2 cursor-pointer',
                    'hover:border-primary/50 hover:bg-muted/50',
                    selectedFile?.id === file.id && 'border-primary bg-primary/5'
                  )}
                  onClick={() => setSelectedFile(file)}
                >
                  {/* 文件预览区域 */}
                  <div className="aspect-square rounded-md bg-muted/30 flex items-center justify-center mb-2">
                    {file.thumbnail_path ? (
                      <img
                        src={file.thumbnail_path}
                        alt={file.filename}
                        className="h-full w-full object-cover rounded-md"
                      />
                    ) : (
                      <Icon className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>

                  {/* 文件名 */}
                  <p className="text-xs truncate">{file.filename}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
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
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm truncate flex-1">{file.filename}</span>
                  <span className="text-xs text-muted-foreground">{formatSize(file.size)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default GalleryView;