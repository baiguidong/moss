/**
 * 媒体工作室主界面
 * 整合音频播放器和视频剪辑器
 */

import * as React from 'react';
import {
  Music,
  Film,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AudioPlayer } from './components/AudioPlayer';
import { VideoEditor } from './components/VideoEditor';
import { HighlightWizard } from './components/HighlightWizard';
import type { FileManagerFile, AudioTrackMeta } from './ipc/types';

type StudioTab = 'highlight' | 'audio' | 'video';

interface MediaStudioProps {
  className?: string;
}

export function MediaStudio({ className }: MediaStudioProps) {
  const [activeTab, setActiveTab] = React.useState<StudioTab>('highlight');
  const [audioMeta, setAudioMeta] = React.useState<AudioTrackMeta[]>([]);
  const [videoFiles, setVideoFiles] = React.useState<FileManagerFile[]>([]);
  const [selectedVideo, setSelectedVideo] = React.useState<string | null>(null);

  // 加载媒体文件
  React.useEffect(() => {
    const loadMediaFiles = async () => {
      try {
        if (!window.fileManager) {
          await import('./ipc/fileManager.ipc');
        }
        const [files, tracks] = await Promise.all([
          window.fileManager?.getFiles({ fileType: 'video', limit: 1000 }),
          window.fileManager?.getAudioTracks(),
        ]);
        if (files) setVideoFiles(files as FileManagerFile[]);
        if (tracks) setAudioMeta(tracks as AudioTrackMeta[]);
      } catch (err) {
        console.error('Failed to load media files:', err);
      }
    };
    loadMediaFiles();
  }, []);

  // 转换为音频轨道格式 (优先使用 ID3 元数据, 缺失时回退文件名)
  const audioTracks = React.useMemo(() => {
    return audioMeta.map((m) => ({
      id: m.id,
      title: m.title || m.filename.replace(/\.[^/.]+$/, ''),
      artist: m.artist || '未知艺术家',
      album: m.album,
      duration: m.duration || 0,
      path: m.path,
      coverPath: m.cover_path || m.thumbnail_path,
    }));
  }, [audioMeta]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 标签页切换 */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'highlight' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('highlight')}
            className="gap-2"
          >
            <Sparkles className="h-4 w-4" />
            成长集锦
          </Button>
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
        {activeTab === 'highlight' ? (
          <HighlightWizard className="h-full" />
        ) : activeTab === 'audio' ? (
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
              <VideoEditor
                videoPath={selectedVideo || undefined}
                fileId={videoFiles.find((f) => f.path === selectedVideo)?.id}
                className="h-full"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MediaStudio;