/**
 * 视频播放器组件
 */

import * as React from 'react';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  SkipBack,
  SkipForward,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
}

export function VideoPlayer({ src, poster, className }: VideoPlayerProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [isMuted, setIsMuted] = React.useState(false);
  const [videoUrl, setVideoUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // 加载视频
  React.useEffect(() => {
    const loadVideo = async () => {
      setLoading(true);
      setError(null);

      try {
        // 如果已经是 URL 格式，直接使用
        if (src.startsWith('data:') || src.startsWith('http') || src.startsWith('blob:')) {
          setVideoUrl(src);
          setLoading(false);
          return;
        }

        // 对于本地文件，需要创建 blob URL
        // 因为视频文件通常较大，我们使用流式读取
        if (window.agentDesktop?.ipcInvoke) {
          const result = await window.agentDesktop.ipcInvoke('fileManager:readFile', {
            filePath: src,
            asDataUrl: false
          });

          if (result?.data) {
            // 将 base64 转换为 blob
            const binaryString = atob(result.data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }

            // 获取 MIME 类型
            const ext = src.split('.').pop()?.toLowerCase() || 'mp4';
            const mimeTypes: Record<string, string> = {
              mp4: 'video/mp4',
              webm: 'video/webm',
              mov: 'video/quicktime',
              avi: 'video/x-msvideo',
              mkv: 'video/x-matroska',
            };
            const mimeType = mimeTypes[ext] || 'video/mp4';

            const blob = new Blob([bytes], { type: mimeType });
            const url = URL.createObjectURL(blob);
            setVideoUrl(url);
          } else if (result?.error) {
            setError(result.error);
          }
        } else {
          // 降级方案
          setVideoUrl(`file://${src}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载视频失败');
      } finally {
        setLoading(false);
      }
    };

    loadVideo();

    // 清理 blob URL
    return () => {
      if (videoUrl && videoUrl.startsWith('blob:')) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [src]);

  // 播放/暂停
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // 跳转
  const seek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // 快退
  const skipBack = () => {
    seek(Math.max(currentTime - 10, 0));
  };

  // 快进
  const skipForward = () => {
    seek(Math.min(currentTime + 10, duration));
  };

  // 音量控制
  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  // 全屏
  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        videoRef.current.requestFullscreen();
      }
    }
  };

  // 格式化时间
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 进度条点击
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    seek(percentage * duration);
  };

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center bg-black rounded-lg', className)} style={{ minHeight: '200px' }}>
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center bg-black rounded-lg text-white', className)} style={{ minHeight: '200px' }}>
        <p className="text-lg">视频加载失败</p>
        <p className="text-sm text-gray-400">{error}</p>
      </div>
    );
  }

  return (
    <div className={cn('relative bg-black rounded-lg overflow-hidden', className)}>
      {/* 视频元素 */}
      <video
        ref={videoRef}
        src={videoUrl || undefined}
        poster={poster}
        className="w-full h-auto"
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrentTime(videoRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            setDuration(videoRef.current.duration);
          }
        }}
        onEnded={() => setIsPlaying(false)}
        onClick={togglePlay}
      />

      {/* 控制栏 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
        {/* 进度条 */}
        <div
          className="relative h-1 bg-white/30 rounded-full mb-3 cursor-pointer"
          onClick={handleProgressClick}
        >
          <div
            className="absolute h-full bg-primary rounded-full"
            style={{ width: `${(currentTime / duration) * 100}%` }}
          />
        </div>

        {/* 控制按钮 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={skipBack}>
              <SkipBack className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="sm" onClick={togglePlay}>
              {isPlaying ? (
                <Pause className="h-5 w-5" />
              ) : (
                <Play className="h-5 w-5" />
              )}
            </Button>

            <Button variant="ghost" size="sm" onClick={skipForward}>
              <SkipForward className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="sm" onClick={toggleMute}>
              {isMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>

            <span className="text-xs text-white">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <Button variant="ghost" size="sm" onClick={toggleFullscreen}>
            <Maximize className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default VideoPlayer;
