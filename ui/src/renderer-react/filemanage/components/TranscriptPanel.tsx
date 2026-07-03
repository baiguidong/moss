/**
 * 语音转写面板 (本地 whisper.cpp)
 * 供 AudioPlayer / VideoEditor 复用: 对选中的音视频文件做本地转写, 显示纯文本结果。
 */

import * as React from 'react';
import { FileText, Loader2, Square, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TranscribeProgress, ModelDownloadProgress } from '../ipc/types';

interface TranscriptPanelProps {
  fileId?: number;
  className?: string;
}

type Phase = 'idle' | 'downloading' | 'transcribing' | 'done' | 'error';

function formatBytes(n: number): string {
  if (!n || n < 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function TranscriptPanel({ fileId, className }: TranscriptPanelProps) {
  const [text, setText] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [progress, setProgress] = React.useState(0); // 0-100, -1=转码中
  const [dlPercent, setDlPercent] = React.useState(0);
  const [dl, setDl] = React.useState<{ received: number; total: number; speed: number; dir?: string }>({ received: 0, total: 0, speed: 0 });
  const [error, setError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  // 本面板是否发起过转写。modelDownloadProgress 是全局广播(无 fileId),
  // 用它过滤, 避免未操作的面板被别处触发的下载带进「下载中」状态。
  const startedRef = React.useRef(false);

  // 回显已有转写结果
  React.useEffect(() => {
    let active = true;
    startedRef.current = false;
    setText(''); setError(null); setPhase('idle'); setProgress(0);
    if (!fileId) return;
    (async () => {
      if (!window.fileManager) await import('../ipc/fileManager.ipc');
      const r = await window.fileManager?.getTranscript(fileId);
      if (!active) return;
      if (r?.status === 'done' && r.text) { setText(r.text); setPhase('done'); }
    })();
    return () => { active = false; };
  }, [fileId]);

  // 订阅进度 (转写 + 模型下载)
  React.useEffect(() => {
    let offT: (() => void) | undefined;
    let offD: (() => void) | undefined;
    (async () => {
      if (!window.fileManager) await import('../ipc/fileManager.ipc');
      offT = window.fileManager?.onTranscribeProgress((p: TranscribeProgress) => {
        if (p.fileId !== fileId) return;
        if (p.status === 'completed') {
          startedRef.current = false;
          setPhase('done'); setProgress(100);
          window.fileManager?.getTranscript(fileId).then((r) => { if (r?.text) setText(r.text); });
        } else if (p.status === 'error') {
          startedRef.current = false;
          setPhase('error'); setError(p.error || '转写失败');
        } else if (p.status === 'cancelled') {
          startedRef.current = false;
          setPhase('idle'); setProgress(0);
        } else {
          setPhase('transcribing'); setProgress(p.progress);
        }
      });
      offD = window.fileManager?.onModelDownloadProgress((p: ModelDownloadProgress) => {
        if (!startedRef.current) return; // 只处理本面板发起的下载
        if (p.status === 'completed') { setDlPercent(100); setDl((d) => ({ ...d, speed: 0 })); }
        else if (p.status === 'error') { startedRef.current = false; setPhase('error'); setError('模型下载失败: ' + (p.error || '')); }
        else if (p.status === 'cancelled') { startedRef.current = false; setPhase('idle'); setDlPercent(0); setDl({ received: 0, total: 0, speed: 0 }); }
        else {
          setPhase('downloading');
          setDlPercent(p.percent);
          setDl({ received: p.received ?? 0, total: p.total ?? 0, speed: p.speed ?? 0, dir: p.dir });
        }
      });
    })();
    return () => { offT?.(); offD?.(); };
  }, [fileId]);

  const start = async () => {
    if (!fileId) return;
    startedRef.current = true;
    setError(null); setText(''); setProgress(0); setPhase('transcribing');
    if (!window.fileManager) await import('../ipc/fileManager.ipc');
    const r = await window.fileManager?.transcribeFile(fileId);
    if (r?.error) { startedRef.current = false; setPhase('error'); setError(r.error); }
  };

  const stop = async () => {
    if (!fileId) return;
    await window.fileManager?.stopTranscribe(fileId);
  };

  const copy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const busy = phase === 'downloading' || phase === 'transcribing';

  return (
    <div className={cn('flex flex-col border-t border-border/40', className)}>
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileText className="h-4 w-4" />
          语音转写
        </div>
        <div className="flex items-center gap-2">
          {text && !busy && (
            <Button variant="ghost" size="sm" onClick={copy} className="gap-1">
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? '已复制' : '复制'}
            </Button>
          )}
          {busy ? (
            <Button variant="ghost" size="sm" onClick={stop} className="gap-1">
              <Square className="h-3.5 w-3.5" />
              停止
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={start} disabled={!fileId} className="gap-1">
              <FileText className="h-3.5 w-3.5" />
              {text ? '重新转写' : '转写'}
            </Button>
          )}
        </div>
      </div>

      <div className="px-4 pb-3 max-h-48 overflow-auto text-sm">
        {phase === 'downloading' && (
          <div className="text-muted-foreground space-y-1">
            <p className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              首次使用，正在下载语音模型… {dlPercent}%
            </p>
            <p className="text-xs pl-5">
              {formatBytes(dl.received)}{dl.total > 0 ? ` / ${formatBytes(dl.total)}` : ''}
              {dl.speed > 0 ? ` · ${formatBytes(dl.speed)}/s` : ''}
            </p>
            {dl.dir && (
              <p className="text-xs pl-5 break-all">保存位置：{dl.dir}</p>
            )}
          </div>
        )}
        {phase === 'transcribing' && (
          <p className="text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {progress < 0 ? '正在处理音频…' : `转写中… ${progress}%`}
          </p>
        )}
        {phase === 'error' && <p className="text-destructive">{error}</p>}
        {text && phase !== 'downloading' && (
          <p className="whitespace-pre-wrap leading-relaxed">{text}</p>
        )}
        {!text && phase === 'idle' && (
          <p className="text-muted-foreground">点击「转写」生成本地语音转写文本（离线）。</p>
        )}
      </div>
    </div>
  );
}

export default TranscriptPanel;
