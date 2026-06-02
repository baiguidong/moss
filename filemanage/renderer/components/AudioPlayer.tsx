/**
 * 音频播放器组件
 * 基于 wavesurfer.js 实现，支持波形可视化、播放列表、歌词显示
 */

import * as React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Repeat,
  Shuffle,
  List,
  Heart,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { FileManagerFile } from '../ipc/types';

// 播放模式
type PlayMode = 'order' | 'shuffle' | 'single';

interface AudioTrack {
  id: number;
  title: string;
  artist?: string;
  album?: string;
  duration: number;
  path: string;
  coverPath?: string;
  lyrics?: string;
}

interface AudioPlayerProps {
  tracks?: AudioTrack[];
  className?: string;
}

// 格式化时间
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// 解析 LRC 歌词
function parseLrc(lrcContent: string): Array<{ time: number; text: string }> {
  const lines = lrcContent.split('\n');
  const lyrics: Array<{ time: number; text: string }> = [];

  for (const line of lines) {
    const match = line.match(/\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3], 10);
      const time = minutes * 60 + seconds + milliseconds / 1000;
      const text = match[4].trim();
      if (text) {
        lyrics.push({ time, text });
      }
    }
  }

  return lyrics.sort((a, b) => a.time - b.time);
}

export function AudioPlayer({ tracks = [], className }: AudioPlayerProps) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const waveformRef = React.useRef<HTMLDivElement>(null);
  const wavesurferRef = React.useRef<any>(null);

  const [currentTrackIndex, setCurrentTrackIndex] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(0.8);
  const [isMuted, setIsMuted] = React.useState(false);
  const [playMode, setPlayMode] = React.useState<PlayMode>('order');
  const [showPlaylist, setShowPlaylist] = React.useState(true);
  const [showLyrics, setShowLyrics] = React.useState(false);
  const [currentLyricIndex, setCurrentLyricIndex] = React.useState(-1);
  const [lyrics, setLyrics] = React.useState<Array<{ time: number; text: string }>>([]);

  const currentTrack = tracks[currentTrackIndex];

  // 初始化 wavesurfer
  React.useEffect(() => {
    let mounted = true;

    const initWavesurfer = async () => {
      try {
        // 动态导入 wavesurfer.js
        const WaveSurfer = (await import('wavesurfer.js')).default;

        if (waveformRef.current && mounted) {
          wavesurferRef.current = WaveSurfer.create({
            container: waveformRef.current,
            waveColor: '#4f46e5',
            progressColor: '#818cf8',
            cursorColor: '#c7d2fe',
            barWidth: 2,
            barRadius: 2,
            height: 60,
            normalize: true,
          });

          // 事件监听
          wavesurferRef.current.on('audioprocess', () => {
            setCurrentTime(wavesurferRef.current.getCurrentTime());
          });

          wavesurferRef.current.on('ready', () => {
            setDuration(wavesurferRef.current.getDuration());
          });

          wavesurferRef.current.on('finish', () => {
            handleNext();
          });
        }
      } catch (err) {
        console.warn('WaveSurfer not available, using fallback audio player');
      }
    };

    initWavesurfer();

    return () => {
      mounted = false;
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
      }
    };
  }, []);

  // 加载音频
  React.useEffect(() => {
    if (currentTrack && wavesurferRef.current) {
      wavesurferRef.current.load(currentTrack.path);
      setLyrics(currentTrack.lyrics ? parseLrc(currentTrack.lyrics) : []);
      setCurrentLyricIndex(-1);
    }
  }, [currentTrack]);

  // 更新歌词
  React.useEffect(() => {
    if (lyrics.length === 0) return;

    const currentIndex = lyrics.findIndex((l, i) => {
      const next = lyrics[i + 1];
      return currentTime >= l.time && (!next || currentTime < next.time);
    });

    if (currentIndex !== currentLyricIndex) {
      setCurrentLyricIndex(currentIndex);
    }
  }, [currentTime, lyrics]);

  // 播放/暂停
  const togglePlay = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
      setIsPlaying(wavesurferRef.current.isPlaying());
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // 上一首
  const handlePrev = () => {
    if (playMode === 'shuffle') {
      const randomIndex = Math.floor(Math.random() * tracks.length);
      setCurrentTrackIndex(randomIndex);
    } else {
      setCurrentTrackIndex((prev) => (prev > 0 ? prev - 1 : tracks.length - 1));
    }
  };

  // 下一首
  const handleNext = () => {
    if (playMode === 'single') {
      // 单曲循环，重新播放
      if (wavesurferRef.current) {
        wavesurferRef.current.seekTo(0);
        wavesurferRef.current.play();
      }
    } else if (playMode === 'shuffle') {
      const randomIndex = Math.floor(Math.random() * tracks.length);
      setCurrentTrackIndex(randomIndex);
    } else {
      setCurrentTrackIndex((prev) => (prev < tracks.length - 1 ? prev + 1 : 0));
    }
  };

  // 跳转
  const handleSeek = (value: number[]) => {
    const time = value[0];
    if (wavesurferRef.current) {
      wavesurferRef.current.seekTo(time / duration);
    }
    setCurrentTime(time);
  };

  // 音量
  const handleVolumeChange = (value: number[]) => {
    const vol = value[0];
    setVolume(vol);
    if (wavesurferRef.current) {
      wavesurferRef.current.setVolume(vol);
    }
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  };

  // 静音
  const toggleMute = () => {
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    if (wavesurferRef.current) {
      wavesurferRef.current.setMuted(newMuted);
    }
    if (audioRef.current) {
      audioRef.current.muted = newMuted;
    }
  };

  // 切换播放模式
  const cyclePlayMode = () => {
    const modes: PlayMode[] = ['order', 'shuffle', 'single'];
    const currentIndex = modes.indexOf(playMode);
    setPlayMode(modes[(currentIndex + 1) % modes.length]);
  };

  // 播放列表项点击
  const handleTrackClick = (index: number) => {
    setCurrentTrackIndex(index);
    setIsPlaying(true);
  };

  if (tracks.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full', className)}>
        <div className="text-6xl mb-4">🎵</div>
        <p className="text-muted-foreground">暂无音乐文件</p>
        <p className="text-sm text-muted-foreground">扫描目录后，音乐文件将显示在这里</p>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full', className)}>
      {/* 主播放区域 */}
      <div className="flex-1 flex flex-col">
        {/* 当前播放信息 */}
        <div className="p-6 border-b border-border/40">
          <div className="flex items-center gap-6">
            {/* 封面 */}
            <div className="w-32 h-32 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden">
              {currentTrack?.coverPath ? (
                <img src={currentTrack.coverPath} alt={currentTrack.title} className="w-full h-full object-cover" />
              ) : (
                <div className="text-4xl">🎵</div>
              )}
            </div>

            {/* 信息 */}
            <div className="flex-1">
              <h2 className="text-xl font-semibold">{currentTrack?.title || '未知歌曲'}</h2>
              <p className="text-muted-foreground">
                {currentTrack?.artist || '未知艺术家'}
                {currentTrack?.album && ` · ${currentTrack.album}`}
              </p>

              {/* 波形可视化区域 */}
              <div ref={waveformRef} className="mt-4 h-16 w-full" />
            </div>
          </div>
        </div>

        {/* 歌词区域 */}
        {showLyrics && lyrics.length > 0 && (
          <div className="flex-1 overflow-auto p-6 bg-muted/20">
            <div className="text-center space-y-4">
              {lyrics.map((line, index) => (
                <p
                  key={index}
                  className={cn(
                    'text-lg transition-colors duration-300',
                    index === currentLyricIndex ? 'text-primary font-semibold' : 'text-muted-foreground'
                  )}
                >
                  {line.text}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* 播放控制 */}
        <div className="p-4 border-t border-border/40 bg-muted/10">
          {/* 进度条 */}
          <div className="flex items-center gap-3 mb-4">
            <span className="text-xs text-muted-foreground w-12">{formatTime(currentTime)}</span>
            <Slider
              value={[currentTime]}
              max={duration || 100}
              step={0.1}
              onValueChange={handleSeek}
              className="flex-1"
            />
            <span className="text-xs text-muted-foreground w-12">{formatTime(duration)}</span>
          </div>

          {/* 控制按钮 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={cyclePlayMode}>
                {playMode === 'order' && <List className="h-4 w-4" />}
                {playMode === 'shuffle' && <Shuffle className="h-4 w-4" />}
                {playMode === 'single' && <Repeat className="h-4 w-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowLyrics(!showLyrics)}>
                词
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handlePrev}>
                <SkipBack className="h-5 w-5" />
              </Button>
              <Button size="lg" onClick={togglePlay} className="w-12 h-12 rounded-full">
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={handleNext}>
                <SkipForward className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={toggleMute}>
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
              <Slider
                value={[isMuted ? 0 : volume]}
                max={1}
                step={0.01}
                onValueChange={handleVolumeChange}
                className="w-24"
              />
              <Button variant="ghost" size="sm" onClick={() => setShowPlaylist(!showPlaylist)}>
                <List className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 播放列表 */}
      {showPlaylist && (
        <div className="w-72 border-l border-border/40 overflow-auto">
          <div className="p-3 border-b border-border/40">
            <h3 className="font-medium">播放列表 ({tracks.length})</h3>
          </div>
          <div className="divide-y divide-border/40">
            {tracks.map((track, index) => (
              <div
                key={track.id}
                className={cn(
                  'flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50',
                  index === currentTrackIndex && 'bg-primary/10'
                )}
                onClick={() => handleTrackClick(index)}
              >
                <div className="w-8 h-8 rounded bg-muted/50 flex items-center justify-center text-sm">
                  {index === currentTrackIndex && isPlaying ? '▶' : index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{track.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{track.artist}</p>
                </div>
                <span className="text-xs text-muted-foreground">{formatTime(track.duration)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fallback audio element */}
      <audio
        ref={audioRef}
        src={currentTrack?.path}
        onTimeUpdate={() => audioRef.current && setCurrentTime(audioRef.current.currentTime)}
        onLoadedMetadata={() => audioRef.current && setDuration(audioRef.current.duration)}
        onEnded={handleNext}
      />
    </div>
  );
}

export default AudioPlayer;