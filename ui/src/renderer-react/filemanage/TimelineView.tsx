/**
 * 时间线视图组件
 */

import * as React from 'react';
import {
  Calendar,
  Image,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mediaUrl } from './lib/mediaUrl';
import type { FileManagerFile } from './ipc/types';

interface GroupedFiles {
  date: string;
  files: FileManagerFile[];
}

export function TimelineView() {
  const [files, setFiles] = React.useState<FileManagerFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);

  // 加载文件
  React.useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      try {
        const result = await window.fileManager?.getFiles({
          fileType: 'image',
          limit: 1000
        });
        if (result) {
          setFiles(result as FileManagerFile[]);
        }
      } catch (err) {
        console.error('Failed to load files:', err);
      } finally {
        setLoading(false);
      }
    };
    loadFiles();
  }, []);

  // 按日期分组
  const groupedFiles = React.useMemo(() => {
    const groups: Map<string, { ts: number; files: FileManagerFile[] }> = new Map();

    files.forEach((file) => {
      const date = file.exif_date || file.modified_at || file.created_at;
      const parsed = new Date(date).getTime();
      const ts = Number.isNaN(parsed) ? 0 : parsed;
      const dateKey = new Date(ts).toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const existing = groups.get(dateKey);
      if (existing) {
        existing.files.push(file);
      } else {
        groups.set(dateKey, { ts, files: [file] });
      }
    });

    return Array.from(groups.entries())
      .map(([date, { ts, files }]) => ({ date, ts, files }))
      .sort((a, b) => b.ts - a.ts);
  }, [files]);

  // 获取所有日期
  const dates = groupedFiles.map(g => g.date);

  return (
    <div className="flex h-full">
      {/* 日期导航 */}
      <div className="w-48 border-r border-border/40 overflow-auto">
        <div className="p-3 border-b border-border/40">
          <h3 className="font-medium flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            时间线
          </h3>
        </div>

        <div className="p-2 space-y-1">
          {dates.map((date) => (
            <button
              key={date}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-sm',
                'hover:bg-muted/50',
                selectedDate === date && 'bg-primary/10 text-primary'
              )}
              onClick={() => setSelectedDate(date)}
            >
              {date}
              <span className="ml-2 text-xs text-muted-foreground">
                {groupedFiles.find(g => g.date === date)?.files.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* 照片墙 */}
      <div className="flex-1 overflow-auto p-4">
        {selectedDate ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-medium">{selectedDate}</h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedDate(null)}
              >
                查看全部
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {groupedFiles
                .find(g => g.date === selectedDate)
                ?.files.map((file) => (
                  <div
                    key={file.id}
                    className="aspect-square rounded-lg bg-muted/30 overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50"
                  >
                    {file.thumbnail_path ? (
                      <img
                        src={mediaUrl(file.thumbnail_path)}
                        alt={file.filename}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Image className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {groupedFiles.map((group) => (
              <div key={group.date}>
                <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  {group.date}
                  <span className="text-sm text-muted-foreground font-normal">
                    ({group.files.length} 张)
                  </span>
                </h2>

                <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                  {group.files.slice(0, 8).map((file) => (
                    <div
                      key={file.id}
                      className="aspect-square rounded bg-muted/30 overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary/50"
                    >
                      {file.thumbnail_path ? (
                        <img
                          src={mediaUrl(file.thumbnail_path)}
                          alt={file.filename}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Image className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {group.files.length > 8 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                    onClick={() => setSelectedDate(group.date)}
                  >
                    查看全部 {group.files.length} 张
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TimelineView;