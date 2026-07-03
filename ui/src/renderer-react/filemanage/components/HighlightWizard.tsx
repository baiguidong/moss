/**
 * 一键生成孩子成长集锦短视频 — 向导
 *
 * 流程: 选事件相册(自动按质量选优) → 选背景音乐 → 选模板(节奏/分辨率)
 *      → 渲染(ffmpeg Ken Burns + 转场 + 音乐) → 预览导出的 mp4
 */

import * as React from 'react';
import { Sparkles, Music, Film, Loader2, CheckCircle2, FolderOpen, Wand2, Clock, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { VideoPlayer } from './VideoPlayer';
import type { FileEvent, AudioTrackMeta, SlideshowProgress, SlideshowFile } from '../ipc/types';

interface Template {
  id: string;
  label: string;
  perImage: number;   // 每张展示秒数(含转场)
  transition: number; // 转场秒数
}

const TEMPLATES: Template[] = [
  { id: 'gentle', label: '舒缓', perImage: 4.5, transition: 1.2 },
  { id: 'standard', label: '标准', perImage: 3.5, transition: 1 },
  { id: 'lively', label: '欢快', perImage: 2.5, transition: 0.6 },
];

const RESOLUTIONS = [
  { id: '720', label: '720p', width: 1280, height: 720 },
  { id: '1080', label: '1080p', width: 1920, height: 1080 },
];

export function HighlightWizard({ className }: { className?: string }) {
  const [events, setEvents] = React.useState<FileEvent[]>([]);
  const [audioMeta, setAudioMeta] = React.useState<AudioTrackMeta[]>([]);
  const [eventId, setEventId] = React.useState<number | null>(null);
  const [audioId, setAudioId] = React.useState<number | null>(null);
  const [template, setTemplate] = React.useState<Template>(TEMPLATES[1]);
  const [resolution, setResolution] = React.useState(RESOLUTIONS[0]);
  const [maxPhotos, setMaxPhotos] = React.useState(30);

  const [rendering, setRendering] = React.useState(false);
  const [percent, setPercent] = React.useState(0);
  const [output, setOutput] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [history, setHistory] = React.useState<SlideshowFile[]>([]);

  const loadHistory = React.useCallback(async () => {
    if (!window.fileManager) await import('../ipc/fileManager.ipc');
    const list = await window.fileManager?.listSlideshows();
    if (list) setHistory(list as SlideshowFile[]);
  }, []);

  // 加载事件相册 + 音频 + 已生成集锦
  React.useEffect(() => {
    const load = async () => {
      if (!window.fileManager) await import('../ipc/fileManager.ipc');
      const [evs, tracks] = await Promise.all([
        window.fileManager?.getEvents(),
        window.fileManager?.getAudioTracks(),
      ]);
      if (evs) {
        setEvents(evs as FileEvent[]);
        if (evs.length > 0) setEventId((evs[0] as FileEvent).id);
      }
      if (tracks) setAudioMeta(tracks as AudioTrackMeta[]);
      loadHistory();
    };
    load();
  }, [loadHistory]);

  // 渲染进度
  React.useEffect(() => {
    let unsub: (() => void) | undefined;
    const setup = async () => {
      if (!window.fileManager) await import('../ipc/fileManager.ipc');
      unsub = window.fileManager?.onSlideshowProgress((p: SlideshowProgress) => {
        if (p.status === 'completed') {
          setPercent(100);
        } else if (p.status === 'error') {
          setError(p.error || '渲染失败');
          setRendering(false);
        } else if (typeof p.percent === 'number') {
          setPercent(p.percent);
        }
      });
    };
    setup();
    return () => unsub?.();
  }, []);

  const selectedEvent = events.find((e) => e.id === eventId) || null;

  const handleRender = async () => {
    if (eventId == null) return;
    if (!window.fileManager) await import('../ipc/fileManager.ipc');
    setRendering(true);
    setPercent(0);
    setOutput(null);
    setError(null);
    try {
      const result = await window.fileManager?.renderSlideshow({
        eventId,
        maxPhotos,
        audioId: audioId ?? undefined,
        perImage: template.perImage,
        transition: template.transition,
        width: resolution.width,
        height: resolution.height,
      });
      if (result?.error) {
        setError(result.error);
      } else if (result?.output) {
        setOutput(result.output);
        loadHistory();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className={cn('flex h-full', className)}>
      {/* 左侧: 配置 */}
      <div className="w-80 border-r border-border/40 overflow-auto p-4 space-y-5">
        {/* 事件相册 */}
        <section>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Sparkles className="h-4 w-4" /> 选择相册
          </h4>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              暂无事件相册，请先到「智能相册」点击智能分析。
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-auto">
              {events.map((ev) => (
                <button
                  key={ev.id}
                  onClick={() => setEventId(ev.id)}
                  className={cn(
                    'w-full text-left rounded-md px-2.5 py-1.5 text-sm hover:bg-muted/50',
                    eventId === ev.id && 'bg-primary/10 ring-1 ring-primary/40'
                  )}
                >
                  <span className="truncate block">{ev.name}</span>
                  <span className="text-xs text-muted-foreground">{ev.photo_count} 张</span>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* 背景音乐 */}
        <section>
          <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
            <Music className="h-4 w-4" /> 背景音乐
          </h4>
          <select
            value={audioId ?? ''}
            onChange={(e) => setAudioId(e.target.value ? Number(e.target.value) : null)}
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-sm"
          >
            <option value="">无音乐</option>
            {audioMeta.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title || a.filename}
              </option>
            ))}
          </select>
        </section>

        {/* 模板节奏 */}
        <section>
          <h4 className="text-sm font-medium mb-2">节奏模板</h4>
          <div className="flex gap-1">
            {TEMPLATES.map((t) => (
              <Button
                key={t.id}
                size="sm"
                variant={template.id === t.id ? 'secondary' : 'ghost'}
                onClick={() => setTemplate(t)}
                className="flex-1"
              >
                {t.label}
              </Button>
            ))}
          </div>
        </section>

        {/* 分辨率 */}
        <section>
          <h4 className="text-sm font-medium mb-2">分辨率</h4>
          <div className="flex gap-1">
            {RESOLUTIONS.map((r) => (
              <Button
                key={r.id}
                size="sm"
                variant={resolution.id === r.id ? 'secondary' : 'ghost'}
                onClick={() => setResolution(r)}
                className="flex-1"
              >
                {r.label}
              </Button>
            ))}
          </div>
        </section>

        {/* 最多照片数 */}
        <section>
          <h4 className="text-sm font-medium mb-2">最多照片数: {maxPhotos}</h4>
          <input
            type="range"
            min={5}
            max={60}
            step={5}
            value={maxPhotos}
            onChange={(e) => setMaxPhotos(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground mt-1">按画质自动选优排序</p>
        </section>

        <Button
          onClick={handleRender}
          disabled={rendering || eventId == null}
          className="w-full gap-2"
        >
          {rendering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {rendering ? '渲染中…' : '一键生成集锦'}
        </Button>
      </div>

      {/* 右侧: 预览 / 进度 / 已生成集锦 */}
      {rendering ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-md text-center space-y-3">
            <Film className="h-10 w-10 mx-auto text-primary animate-pulse" />
            <p className="text-sm text-muted-foreground">
              正在渲染 {selectedEvent?.name} 的成长集锦…
            </p>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">{percent}%</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-center space-y-1">
              <p className="text-sm text-destructive">{error}</p>
              <p className="text-xs text-muted-foreground">请检查照片与 ffmpeg 后重试</p>
            </div>
          )}

          {output && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle2 className="h-5 w-5" /> 集锦预览
                </div>
                <Button variant="ghost" size="sm" onClick={() => setOutput(null)} className="gap-1.5">
                  <ChevronLeft className="h-4 w-4" /> 返回列表
                </Button>
              </div>
              <VideoPlayer src={output} className="w-full rounded-lg overflow-hidden" />
              <button
                onClick={() => window.fileManager?.revealInFolder(output)}
                className="text-xs text-muted-foreground flex items-center gap-1.5 hover:text-foreground"
              >
                <FolderOpen className="h-3.5 w-3.5" /> {output}
              </button>
            </div>
          )}

          {/* 已生成集锦列表 */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles className="h-4 w-4" /> 已生成集锦
              <span className="text-xs text-muted-foreground">({history.length})</span>
            </h4>
            {history.length === 0 ? (
              !output && !error && (
                <div className="py-10 text-center text-muted-foreground space-y-2">
                  <Sparkles className="h-10 w-10 mx-auto opacity-40" />
                  <p className="text-sm">选择一个相册和背景音乐，一键生成孩子成长集锦短视频</p>
                </div>
              )
            ) : (
              <div className="space-y-1.5">
                {history.map((h) => (
                  <div
                    key={h.path}
                    onClick={() => { setOutput(h.path); setError(null); }}
                    className={cn(
                      'flex items-center gap-3 rounded-md border border-border/40 p-2.5 cursor-pointer hover:bg-muted/50',
                      output === h.path && 'bg-primary/10 ring-1 ring-primary/40'
                    )}
                  >
                    <div className="w-10 h-10 rounded bg-muted/60 flex items-center justify-center shrink-0">
                      <Film className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{h.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {new Date(h.mtime).toLocaleString()}
                        <span>· {(h.size / 1024 / 1024).toFixed(1)} MB</span>
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); window.fileManager?.revealInFolder(h.path); }}
                      title="在文件夹中显示"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default HighlightWizard;
