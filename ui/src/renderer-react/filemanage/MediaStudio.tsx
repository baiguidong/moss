/**
 * 媒体工作室主界面
 * 整合音频播放器和视频剪辑器
 */

import * as React from 'react';
import {
  Music,
  Film,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AudioPlayer } from './components/AudioPlayer';
import { VideoEditor } from './components/VideoEditor';
import type { FileManagerFile } from './ipc/types';

type StudioTab = 'audio' | 'video';

interface MediaStudioProps {
  className?: string;
}

export function MediaStudio({ className }: MediaStudioProps) {
  const [activeTab, setActiveTab] = React.useState<StudioTab>('audio');
  const [audioFiles, setAudioFiles] = React.useState<FileManagerFile[]>([]);
  const [videoFiles, setVideoFiles] = React.useState<FileManagerFile[]>([]);
  const [selectedVideo, setSelectedVideo] = React.useState<string | null>(null);

  // 加载媒体文件
  React.useEffect(() => {
    const loadMediaFiles = async () => {
      try {
        const files = await window.fileManager?.getFiles({ limit: 1000 });
        if (files) {
          setAudioFiles(files.filter((f: FileManagerFile) => f.file_type === 'audio'));
          setVideoFiles(files.filter((f: FileManagerFile) => f.file_type === 'video'));
        }
      } catch (err) {
        console.error('Failed to load media files:', err);
      }
    };
    loadMediaFiles();
  }, []);

  // 转换为音频轨道格式
  const audioTracks = React.useMemo(() => {
    return audioFiles.map((file) => ({
      id: file.id,
      title: file.filename.replace(/\.[^/.]+$/, ''), // 移除扩展名
      artist: '未知艺术家',
      duration: file.duration || 0,
      path: file.path,
    }));
  }, [audioFiles]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 标签页切换 */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'audio' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('audio')}
            className="gap-2"
          >
            <Music className="h-4 w-4" />
            音乐播放器
            <span className="text-xs text-muted-foreground">({audioTracks.length})</span>
          </Button>
          <Button
            variant={activeTab === 'video' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('video')}
            className="gap-2"
          >
            <Film className="h-4 w-4" />
            视频剪辑
            <span className="text-xs text-muted-foreground">({videoFiles.length})</span>
          </Button>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'audio' ? (
          <AudioPlayer tracks={audioTracks} className="h-full" />
        ) : (
          <div className="flex h-full">
            {/* 视频文件列表 */}
            <div className="w-64 border-r border-border/40 overflow-auto">
              <div className="p-3 border-b border-border/40">
                <h3 className="font-medium text-sm">视频文件</h3>
              </div>
              <div className="divide-y divide-border/40">
                {videoFiles.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    暂无视频文件
                  </div>
                ) : (
                  videoFiles.map((file) => (
                    <div
                      key={file.id}
                      className={cn(
                        'flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50',
                        selectedVideo === file.path && 'bg-primary/10'
                      )}
                      onClick={() => setSelectedVideo(file.path)}
                    >
                      <div className="w-12 h-8 bg-muted/50 rounded flex items-center justify-center">
                        <Film className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.filename}</p>
                        <p className="text-xs text-muted-foreground">
                          {file.duration ? `${Math.round(file.duration)}s` : ''}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 视频编辑器 */}
            <div className="flex-1">
              <VideoEditor videoPath={selectedVideo || undefined} className="h-full" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MediaStudio;