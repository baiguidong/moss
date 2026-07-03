/**
 * 视频剪辑器组件
 * 支持裁剪、分割、转场、字幕、AI 辅助
 */

import * as React from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Scissors,
  Trash2,
  Copy,
  Type,
  Sparkles,
  Download,
  Undo,
  Redo,
  ZoomIn,
  ZoomOut,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { mediaUrl } from '../lib/mediaUrl';
import { TranscriptPanel } from './TranscriptPanel';

// 时间线轨道类型
interface TimelineTrack {
  id: string;
  type: 'video' | 'audio' | 'subtitle';
  clips: TimelineClip[];
}

interface TimelineClip {
  id: string;
  trackId: string;
  startTime: number; // 在时间线上的开始时间
  duration: number;
  sourceStart: number; // 源文件的开始时间
  sourceEnd: number; // 源文件的结束时间
  name: string;
  color?: string;
}

interface VideoEditorProps {
  videoPath?: string;
  fileId?: number;
  className?: string;
}

// 格式化时间
function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

// 生成唯一 ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function VideoEditor({ videoPath, fileId, className }: VideoEditorProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const timelineRef = React.useRef<HTMLDivElement>(null);

  // 视频状态
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [isMuted, setIsMuted] = React.useState(false);

  // 时间线状态
  const [tracks, setTracks] = React.useState<TimelineTrack[]>([
    { id: 'video-1', type: 'video', clips: [] },
    { id: 'audio-1', type: 'audio', clips: [] },
    { id: 'subtitle-1', type: 'subtitle', clips: [] },
  ]);
  const [selectedClip, setSelectedClip] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1); // 时间线缩放
  const [pixelsPerSecond, setPixelsPerSecond] = React.useState(50);

  // AI 指令
  const [aiPrompt, setAiPrompt] = React.useState('');
  const [aiProcessing, setAiProcessing] = React.useState(false);

  // 历史记录 (index 指向 history 中的当前状态; refs 避免闭包过期)
  const [history, setHistory] = React.useState<TimelineTrack[][]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const historyRef = React.useRef<TimelineTrack[][]>([]);
  const historyIndexRef = React.useRef(-1);

  const clone = (t: TimelineTrack[]): TimelineTrack[] => JSON.parse(JSON.stringify(t));

  // 用某个状态重置历史基线 (加载/切换视频时)
  const resetHistory = React.useCallback((baseline: TimelineTrack[]) => {
    const snap = [clone(baseline)];
    historyRef.current = snap;
    historyIndexRef.current = 0;
    setHistory(snap);
    setHistoryIndex(0);
  }, []);

  // 提交一次编辑: 落地新状态并压入历史 (截断 redo 尾部, 保留最近 50 条)
  const commit = React.useCallback((next: TimelineTrack[]) => {
    setTracks(next);
    const trimmed = [...historyRef.current.slice(0, historyIndexRef.current + 1), clone(next)].slice(-50);
    historyRef.current = trimmed;
    historyIndexRef.current = trimmed.length - 1;
    setHistory(trimmed);
    setHistoryIndex(trimmed.length - 1);
  }, []);

  // 初始化视频
  React.useEffect(() => {
    if (videoPath && videoRef.current) {
      videoRef.current.src = mediaUrl(videoPath) ?? '';
      // 切换视频源: 重置时间线与选中态, 避免上一段视频残留
      const baseline: TimelineTrack[] = [
        {
          id: 'video-1',
          type: 'video',
          clips: [{
            id: generateId(),
            trackId: 'video-1',
            startTime: 0,
            duration: 0,
            sourceStart: 0,
            sourceEnd: 0,
            name: 'Main Video',
            color: '#4f46e5',
          }],
        },
        { id: 'audio-1', type: 'audio', clips: [] },
        { id: 'subtitle-1', type: 'subtitle', clips: [] },
      ];
      setTracks(baseline);
      setSelectedClip(null);
      setCurrentTime(0);
      setDuration(0);
      resetHistory(baseline);
    }
  }, [videoPath, resetHistory]);

  // 撤销
  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      const idx = historyIndexRef.current - 1;
      historyIndexRef.current = idx;
      setHistoryIndex(idx);
      setTracks(clone(historyRef.current[idx]));
    }
  };

  // 重做
  const handleRedo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      const idx = historyIndexRef.current + 1;
      historyIndexRef.current = idx;
      setHistoryIndex(idx);
      setTracks(clone(historyRef.current[idx]));
    }
  };

  // 播放控制
  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
        setIsPlaying(false);
      } else {
        videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      }
    }
  };

  // 跳转
  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // 时间线点击
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = x / pixelsPerSecond / zoom;
      handleSeek(Math.max(0, Math.min(time, duration)));
    }
  };

  // 裁剪
  const handleCut = () => {
    if (!selectedClip) return;

    const next = tracks.map((track) => ({
      ...track,
      clips: track.clips.flatMap((clip) => {
        if (clip.id === selectedClip) {
          // 在当前时间点分割
          if (currentTime > clip.startTime && currentTime < clip.startTime + clip.duration) {
            const firstPart: TimelineClip = {
              ...clip,
              duration: currentTime - clip.startTime,
              sourceEnd: clip.sourceStart + (currentTime - clip.startTime),
            };
            const secondPart: TimelineClip = {
              ...clip,
              id: generateId(),
              startTime: currentTime,
              duration: clip.duration - (currentTime - clip.startTime),
              sourceStart: clip.sourceStart + (currentTime - clip.startTime),
            };
            return [firstPart, secondPart];
          }
        }
        return clip;
      }),
    }));
    commit(next);
  };

  // 删除片段
  const handleDelete = () => {
    if (!selectedClip) return;

    const next = tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== selectedClip),
    }));
    commit(next);
    setSelectedClip(null);
  };

  // 添加字幕
  const handleAddSubtitle = () => {
    const subtitleText = prompt('输入字幕文本：');
    if (!subtitleText) return;

    const newClip: TimelineClip = {
      id: generateId(),
      trackId: 'subtitle-1',
      startTime: currentTime,
      duration: 3,
      sourceStart: 0,
      sourceEnd: 3,
      name: subtitleText,
      color: '#f59e0b',
    };

    const next = tracks.map((track) =>
      track.type === 'subtitle'
        ? { ...track, clips: [...track.clips, newClip] }
        : track
    );
    commit(next);
  };

  // AI 处理
  const handleAiProcess = async () => {
    if (!aiPrompt.trim()) return;

    setAiProcessing(true);
    try {
      // 模拟 AI 处理
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 解析指令并执行操作
      const prompt = aiPrompt.toLowerCase();

      if (prompt.includes('删除开头') || prompt.includes('删掉开头')) {
        const match = prompt.match(/(\d+)/);
        const seconds = match ? parseInt(match[1], 10) : 5;
        handleSeek(seconds);
        // 模拟裁剪操作
      }

      if (prompt.includes('淡入')) {
        // 添加淡入效果
      }

      if (prompt.includes('字幕')) {
        const match = aiPrompt.match(/字幕[：:]\s*(.+)/);
        if (match) {
          handleAddSubtitle();
        }
      }

      // 实际项目中应该调用 AI API
      alert(`AI 指令处理完成: ${aiPrompt}`);
    } finally {
      setAiProcessing(false);
    }
  };

  // 导出
  const handleExport = async () => {
    // TODO: 使用 FFmpeg 导出
    alert('导出功能开发中，将使用 FFmpeg 进行视频渲染');
  };

  // 缩放
  const handleZoomIn = () => setZoom(Math.min(zoom * 1.2, 5));
  const handleZoomOut = () => setZoom(Math.max(zoom / 1.2, 0.2));

  // 计算时间线总长度
  const totalDuration = Math.max(
    duration,
    ...tracks.flatMap((t) => t.clips.map((c) => c.startTime + c.duration))
  );

  // 时间刻度
  const timeMarkers = React.useMemo(() => {
    const markers: number[] = [];
    const interval = 5 / zoom; // 根据缩放调整间隔
    for (let i = 0; i <= totalDuration; i += interval) {
      markers.push(i);
    }
    return markers;
  }, [totalDuration, zoom]);

  if (!videoPath) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-full', className)}>
        <div className="text-6xl mb-4">🎬</div>
        <p className="text-muted-foreground">请选择视频文件</p>
        <p className="text-sm text-muted-foreground">支持 MP4, MOV, AVI 等格式</p>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/40">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleUndo} disabled={historyIndex <= 0}>
            <Undo className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleRedo} disabled={historyIndex >= history.length - 1}>
            <Redo className="h-4 w-4" />
          </Button>
          <div className="w-px h-6 bg-border mx-2" />
          <Button variant="outline" size="sm" onClick={handleCut} disabled={!selectedClip}>
            <Scissors className="h-4 w-4 mr-1" /> 裁剪
          </Button>
          <Button variant="outline" size="sm" onClick={handleDelete} disabled={!selectedClip}>
            <Trash2 className="h-4 w-4 mr-1" /> 删除
          </Button>
          <Button variant="outline" size="sm" onClick={handleAddSubtitle}>
            <Type className="h-4 w-4 mr-1" /> 字幕
          </Button>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" /> 导出
          </Button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 flex">
        {/* 视频预览 */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 bg-black flex items-center justify-center p-4">
            <video
              ref={videoRef}
              className="max-w-full max-h-full"
              onTimeUpdate={() => videoRef.current && setCurrentTime(videoRef.current.currentTime)}
              onLoadedMetadata={() => videoRef.current && setDuration(videoRef.current.duration)}
              onEnded={() => setIsPlaying(false)}
            />
          </div>

          {/* 播放控制 */}
          <div className="p-4 border-t border-border/40">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => handleSeek(0)}>
                <SkipBack className="h-4 w-4" />
              </Button>
              <Button size="lg" onClick={togglePlay} className="w-10 h-10 rounded-full">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleSeek(duration)}>
                <SkipForward className="h-4 w-4" />
              </Button>
              <span className="text-sm">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setIsMuted(!isMuted)}>
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>

        {/* AI 指令面板 */}
        <div className="w-80 border-l border-border/40 flex flex-col">
          <div className="p-3 border-b border-border/40">
            <h3 className="font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              AI 辅助剪辑
            </h3>
          </div>
          <div className="flex-1 p-4 space-y-4">
            <div>
              <p className="text-sm text-muted-foreground mb-2">输入自然语言指令：</p>
              <Input
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="例如：把开头5秒删掉"
                className="mb-2"
              />
              <Button
                className="w-full"
                onClick={handleAiProcess}
                disabled={aiProcessing || !aiPrompt.trim()}
              >
                {aiProcessing ? '处理中...' : '执行指令'}
              </Button>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">快捷指令：</p>
              <div className="space-y-2">
                {[
                  '删除开头5秒',
                  '添加淡入效果',
                  '在10秒处添加字幕',
                  '提取音频',
                ].map((cmd) => (
                  <button
                    key={cmd}
                    className="w-full text-left text-sm p-2 rounded bg-muted/50 hover:bg-muted"
                    onClick={() => setAiPrompt(cmd)}
                  >
                    {cmd}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 语音转写面板 */}
          <TranscriptPanel fileId={fileId} />
        </div>
      </div>

      {/* 时间线 */}
      <div className="border-t border-border/40 bg-muted/10">
        {/* 时间刻度 */}
        <div className="h-6 border-b border-border/40 overflow-hidden">
          <div
            className="relative h-full"
            style={{ width: totalDuration * pixelsPerSecond * zoom }}
          >
            {timeMarkers.map((time) => (
              <div
                key={time}
                className="absolute top-0 h-full text-xs text-muted-foreground border-l border-border/40 pl-1"
                style={{ left: time * pixelsPerSecond * zoom }}
              >
                {formatTime(time)}
              </div>
            ))}
          </div>
        </div>

        {/* 轨道 */}
        <div ref={timelineRef} className="relative overflow-x-auto" onClick={handleTimelineClick}>
          <div style={{ width: totalDuration * pixelsPerSecond * zoom, minHeight: 120 }}>
            {tracks.map((track, trackIndex) => (
              <div
                key={track.id}
                className="h-10 border-b border-border/40 relative"
                style={{ top: trackIndex * 40 }}
              >
                {/* 轨道标签 */}
                <div className="absolute left-0 top-0 w-20 h-full bg-muted/50 border-r border-border/40 flex items-center px-2 text-xs z-10">
                  {track.type === 'video' && '视频'}
                  {track.type === 'audio' && '音频'}
                  {track.type === 'subtitle' && '字幕'}
                </div>

                {/* 片段 */}
                <div className="ml-20 relative h-full">
                  {track.clips.map((clip) => (
                    <div
                      key={clip.id}
                      className={cn(
                        'absolute top-1 bottom-1 rounded cursor-pointer transition-shadow',
                        selectedClip === clip.id && 'ring-2 ring-primary'
                      )}
                      style={{
                        left: clip.startTime * pixelsPerSecond * zoom,
                        width: clip.duration * pixelsPerSecond * zoom,
                        backgroundColor: clip.color || '#4f46e5',
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedClip(clip.id);
                      }}
                    >
                      <span className="text-xs text-white truncate px-1">{clip.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* 播放头 */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20"
              style={{ left: currentTime * pixelsPerSecond * zoom + 80 }}
            >
              <div className="w-3 h-3 bg-red-500 rounded-full -ml-1 -mt-1" />
            </div>
          </div>
        </div>

        {/* 缩放控制 */}
        <div className="flex items-center justify-end gap-2 p-2 border-t border-border/40">
          <Button variant="ghost" size="sm" onClick={handleZoomOut}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" onClick={handleZoomIn}>
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default VideoEditor;