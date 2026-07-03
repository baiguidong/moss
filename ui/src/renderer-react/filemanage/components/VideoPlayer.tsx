/**
 * 视频播放器组件
 *
 * 直接走 moss-media:// 流媒体协议(支持 HTTP Range), 边下边播、可秒开 seek,
 * 不再整文件 base64 → blob。
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
  Gauge,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mediaUrl } from '../lib/mediaUrl';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  className?: string;
}

const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
const POS_KEY_PREFIX = 'fm:videoPos:';

export function VideoPlayer({ src, poster, className }: VideoPlayerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [buffered, setBuffered] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [isMuted, setIsMuted] = React.useState(false);
  const [waiting, setWaiting] = React.useState(false);
  const [speed, setSpeed] = React.useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const videoUrl = mediaUrl(src);
  const posterUrl = poster ? mediaUrl(poster) : undefined;
  const posKey = POS_KEY_PREFIX + src;

  // 切换视频源时重置播放状态, 避免上一段视频的错误/进度残留
  React.useEffect(() => {
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setBuffered(0);
    setIsPlaying(false);
    setWaiting(false);
  }, [src]);

  // 播放/暂停
  const togglePlay = React.useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seek = React.useCallback((time: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(time, v.duration || 0));
    v.currentTime = clamped;
    setCurrentTime(clamped);
  }, []);

  const skipBack = React.useCallback(() => seek((videoRef.current?.currentTime ?? 0) - 10), [seek]);
  const skipForward = React.useCallback(() => seek((videoRef.current?.currentTime ?? 0) + 10), [seek]);

  const toggleMute = React.useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  }, []);

  const changeVolume = React.useCallback((val: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(1, val));
    v.volume = clamped;
    v.muted = clamped === 0;
    setVolume(clamped);
    setIsMuted(clamped === 0);
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => {});
  }, []);

  const applySpeed = React.useCallback((s: number) => {
    const v = videoRef.current;
    if (v) v.playbackRate = s;
    setSpeed(s);
    setShowSpeedMenu(false);
  }, []);

  // 键盘快捷键 (容器聚焦时)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        skipBack();
        break;
      case 'ArrowRight':
        e.preventDefault();
        skipForward();
        break;
      case 'ArrowUp':
        e.preventDefault();
        changeVolume(volume + 0.1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        changeVolume(volume - 0.1);
        break;
      case 'm':
        toggleMute();
        break;
      case 'f':
        toggleFullscreen();
        break;
    }
  };

  // 恢复上次播放位置
  const handleLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration || 0);
    const saved = Number(localStorage.getItem(posKey) || '0');
    if (saved > 0 && saved < (v.duration || 0) - 3) {
      v.currentTime = saved;
    }
  };

  // 记忆播放位置 (节流: 每秒一次由 timeupdate 自然触发)
  const handleTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    if (v.duration && v.currentTime > 0) {
      if (v.currentTime >= v.duration - 1) localStorage.removeItem(posKey);
      else localStorage.setItem(posKey, String(Math.floor(v.currentTime)));
    }
  };

  const handleProgress = () => {
    const v = videoRef.current;
    if (!v || v.buffered.length === 0) return;
    setBuffered(v.buffered.end(v.buffered.length - 1));
  };

  const formatTime = (seconds: number) => {
    if (!isFinite(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const percentage = (e.clientX - rect.left) / rect.width;
    seek(percentage * duration);
  };

  if (error) {
    return (
      <div
        className={cn('flex flex-col items-center justify-center bg-black rounded-lg text-white', className)}
        style={{ minHeight: '200px' }}
      >
        <p className="text-lg">视频加载失败</p>
        <p className="text-sm text-gray-400">{error}</p>
      </div>
    );
  }

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={cn('relative bg-black rounded-lg overflow-hidden group outline-none', className)}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <video
        ref={videoRef}
        src={videoUrl}
        poster={posterUrl}
        className="w-full h-auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onProgress={handleProgress}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onEnded={() => setIsPlaying(false)}
        onError={() => setError('无法播放该视频(编码或路径不支持)')}
        onClick={togglePlay}
      />

      {/* 缓冲指示 */}
      {waiting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Loader2 className="h-10 w-10 animate-spin text-white/90" />
        </div>
      )}

      {/* 控制栏 */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {/* 进度条 (含缓冲) */}
        <div
          className="relative h-1.5 bg-white/20 rounded-full mb-3 cursor-pointer"
          onClick={handleProgressClick}
        >
          <div className="absolute h-full bg-white/30 rounded-full" style={{ width: `${bufferedPct}%` }} />
          <div className="absolute h-full bg-primary rounded-full" style={{ width: `${progressPct}%` }} />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={skipBack} title="后退 10s (←)">
              <SkipBack className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={togglePlay} title="播放/暂停 (空格)">
              {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={skipForward} title="前进 10s (→)">
              <SkipForward className="h-4 w-4" />
            </Button>

            {/* 音量 */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={toggleMute} title="静音 (M)">
                {isMuted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-16 accent-primary cursor-pointer"
                title="音量 (↑/↓)"
              />
            </div>

            <span className="text-xs text-white tabular-nums">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* 倍速 */}
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSpeedMenu((s) => !s)}
                title="播放速度"
                className="gap-1"
              >
                <Gauge className="h-4 w-4" />
                <span className="text-xs">{speed}x</span>
              </Button>
              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-1 rounded-md bg-black/90 p-1">
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => applySpeed(s)}
                      className={cn(
                        'block w-full rounded px-3 py-1 text-left text-xs text-white hover:bg-white/20',
                        s === speed && 'text-primary'
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              )}
            </div>

            <Button variant="ghost" size="sm" onClick={toggleFullscreen} title="全屏 (F)">
              <Maximize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VideoPlayer;
