/**
 * 智能相册视图
 *
 * 本地分析产物的呈现:
 *   - 事件/相册: 按拍摄时间自动聚类的分组(可作为「集锦」选材)
 *   - 重复照片: 精确 + 近似去重结果, 一键查看
 *   - 触发分析 + 进度
 */

import * as React from 'react';
import { Sparkles, RefreshCw, Images, Copy, ChevronLeft, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mediaUrl } from './lib/mediaUrl';
import type { FileEvent, FileManagerFile, DuplicateFile, AnalyzeProgress } from './ipc/types';

type Mode = 'events' | 'duplicates' | 'event-detail';

function thumbFor(file: { thumbnail_path?: string; cover_thumbnail?: string; cover_path?: string; path?: string }) {
  const t = (file as any).thumbnail_path || (file as any).cover_thumbnail;
  if (t) return mediaUrl(t);
  const p = (file as any).cover_path || (file as any).path;
  return p ? mediaUrl(p) : undefined;
}

export function SmartAlbumView() {
  const [mode, setMode] = React.useState<Mode>('events');
  const [events, setEvents] = React.useState<FileEvent[]>([]);
  const [duplicates, setDuplicates] = React.useState<DuplicateFile[]>([]);
  const [eventFiles, setEventFiles] = React.useState<FileManagerFile[]>([]);
  const [activeEvent, setActiveEvent] = React.useState<FileEvent | null>(null);
  const [analyzing, setAnalyzing] = React.useState(false);
  const [progress, setProgress] = React.useState<AnalyzeProgress | null>(null);

  const load = React.useCallback(async () => {
    if (!window.fileManager) await import('./ipc/fileManager.ipc');
    const [evs, dups] = await Promise.all([
      window.fileManager?.getEvents(),
      window.fileManager?.getDuplicates(),
    ]);
    if (evs) setEvents(evs as FileEvent[]);
    if (dups) setDuplicates(dups as DuplicateFile[]);
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // 分析进度
  React.useEffect(() => {
    let unsub: (() => void) | undefined;
    const setup = async () => {
      if (!window.fileManager) await import('./ipc/fileManager.ipc');
      unsub = window.fileManager?.onAnalyzeProgress((p) => {
        if (p.status === 'completed' || p.status === 'error') {
          setAnalyzing(false);
          setProgress(null);
          if (p.status === 'completed') load();
        } else {
          setAnalyzing(true);
          setProgress(p);
        }
      });
    };
    setup();
    return () => unsub?.();
  }, [load]);

  const handleAnalyze = async () => {
    if (!window.fileManager) await import('./ipc/fileManager.ipc');
    setAnalyzing(true);
    setProgress({ phase: 'analyze' });
    await window.fileManager?.analyzePhotos();
  };

  const openEvent = async (ev: FileEvent) => {
    setActiveEvent(ev);
    setMode('event-detail');
    const files = await window.fileManager?.getEventFiles(ev.id);
    setEventFiles((files as FileManagerFile[]) || []);
  };

  const dateRange = (ev: FileEvent) => {
    const s = ev.start_date ? new Date(ev.start_date).toLocaleDateString() : '';
    const e = ev.end_date ? new Date(ev.end_date).toLocaleDateString() : '';
    return s === e ? s : `${s} – ${e}`;
  };

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
        <div className="flex items-center gap-1">
          {mode === 'event-detail' ? (
            <Button variant="ghost" size="sm" onClick={() => setMode('events')} className="gap-2">
              <ChevronLeft className="h-4 w-4" />
              返回相册
            </Button>
          ) : (
            <>
              <Button
                variant={mode === 'events' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setMode('events')}
                className="gap-2"
              >
                <Images className="h-4 w-4" />
                事件相册 <span className="text-xs text-muted-foreground">({events.length})</span>
              </Button>
              <Button
                variant={mode === 'duplicates' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setMode('duplicates')}
                className="gap-2"
              >
                <Copy className="h-4 w-4" />
                重复照片 <span className="text-xs text-muted-foreground">({duplicates.length})</span>
              </Button>
            </>
          )}
        </div>

        <Button size="sm" onClick={handleAnalyze} disabled={analyzing} className="gap-2">
          {analyzing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {analyzing ? '分析中…' : '智能分析'}
        </Button>
      </div>

      {/* 分析进度 */}
      {analyzing && (
        <div className="px-4 py-2 text-xs text-muted-foreground">
          {progress?.phase === 'analyze' && progress?.total
            ? `去重 / 质量评分中… ${progress.processed ?? 0} / ${progress.total}`
            : '正在分析照片(去重、质量、事件聚类)…'}
        </div>
      )}

      {/* 内容 */}
      <div className="flex-1 overflow-auto p-4">
        {mode === 'events' && (
          events.length === 0 ? (
            <Empty text="暂无事件相册，点击「智能分析」自动按时间生成" />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
              {events.map((ev) => {
                const cover = thumbFor(ev);
                return (
                  <button
                    key={ev.id}
                    onClick={() => openEvent(ev)}
                    className="group text-left rounded-lg border border-border/40 overflow-hidden hover:border-primary/50"
                  >
                    <div className="aspect-square bg-muted/30 overflow-hidden">
                      {cover ? (
                        <img src={cover} alt={ev.name} className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                      ) : (
                        <div className="flex h-full items-center justify-center"><Images className="h-8 w-8 text-muted-foreground" /></div>
                      )}
                    </div>
                    <div className="p-2">
                      <p className="text-sm font-medium truncate">{ev.name}</p>
                      <p className="text-xs text-muted-foreground">{ev.photo_count} 张 · {dateRange(ev)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        )}

        {mode === 'duplicates' && (
          duplicates.length === 0 ? (
            <Empty text="未发现重复照片" />
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {duplicates.map((f) => (
                <div key={f.id} className="relative rounded-md border border-border/40 overflow-hidden">
                  <div className="aspect-square bg-muted/30">
                    {thumbFor(f) ? (
                      <img src={thumbFor(f)} alt={f.filename} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center"><Copy className="h-6 w-6 text-muted-foreground" /></div>
                    )}
                  </div>
                  <span className="absolute top-1 left-1 rounded bg-amber-500/90 px-1.5 py-0.5 text-[10px] text-white">
                    与 #{f.duplicate_of} 重复
                  </span>
                </div>
              ))}
            </div>
          )
        )}

        {mode === 'event-detail' && activeEvent && (
          <>
            <div className="mb-3">
              <h3 className="text-base font-semibold">{activeEvent.name}</h3>
              <p className="text-xs text-muted-foreground">{activeEvent.photo_count} 张 · {dateRange(activeEvent)}</p>
            </div>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {eventFiles.map((f) => {
                const q = (f as FileManagerFile & { quality_score?: number }).quality_score;
                const best = typeof q === 'number' && q >= 0.7;
                return (
                  <div key={f.id} className="relative rounded-md border border-border/40 overflow-hidden">
                    <div className="aspect-square bg-muted/30">
                      {thumbFor(f) ? (
                        <img src={thumbFor(f)} alt={f.filename} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center"><Images className="h-6 w-6 text-muted-foreground" /></div>
                      )}
                    </div>
                    {best && (
                      <span className="absolute top-1 right-1 rounded-full bg-primary/90 p-1" title="高质量(选优推荐)">
                        <Star className="h-3 w-3 text-white fill-white" />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

export default SmartAlbumView;
