import * as React from 'react';
import { ChevronUp, Cpu } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { SessionDialog } from './session-dialog';
import { contextUsagePresentation, formatTokenCount, type ContextUsageInfo } from '@/lib/context-usage';
import type { SessionModelSettings } from '../types';

export type SessionUsageSummary = {
  promptTokens: number;
  outputTokens: number;
  cacheTokens: number;
  requestCount: number;
  toolCalls: number;
  toolSuccess: number;
  toolErrors: number;
  toolUnknown: number;
};

export type SessionOutlineEntry = {
  messageId: string;
  question: string;
  answerPreview: string;
};

export function ModelSelector({ currentModel, onModelChange, modelSettings, disabled = false, compact = false }: {
  currentModel?: string;
  onModelChange?: (model: string) => Promise<void>;
  modelSettings?: SessionModelSettings;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [changing, setChanging] = React.useState(false);
  const [error, setError] = React.useState('');
  const configured = modelSettings?.availableModels || [];
  const defaultModel = modelSettings?.model || configured[0] || '';
  const options = [...new Set([...configured, currentModel || ''].filter(Boolean))];
  const refreshCatalog = () => {
    if (modelSettings?.followModelCatalog) void window.agentDesktop.listModels({ refresh: false }).catch(() => {});
  };
  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!onModelChange || changing) return;
    setChanging(true);
    try { await onModelChange(event.target.value); }
    finally { setChanging(false); }
  };
  if (compact) {
    const selected = currentModel || 'default';
    const label = selected === 'default' ? '默认' : selected;
    return <DropdownMenu modal={false} open={open} onOpenChange={next => {
      if (next) { refreshCatalog(); setError(''); }
      setOpen(next);
    }}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="session-model" aria-label={`选择模型：${label}`}
          title={`选择模型 · ${selected === 'default' ? defaultModel || label : label}`} disabled={disabled || !onModelChange || changing}>
          <span className="truncate">{label}</span><ChevronUp className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" sideOffset={6} collisionPadding={8} aria-label="选择模型"
        className="w-max max-w-[min(22rem,calc(100vw-1rem))]">
        <DropdownMenuRadioGroup value={selected} onValueChange={async model => {
          setChanging(true);
          try { await onModelChange?.(model); setOpen(false); }
          catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          finally { setChanging(false); }
        }}>
          {['default', ...options.filter(model => model !== 'default')].map(model =>
            <DropdownMenuRadioItem key={model} value={model} disabled={disabled || changing} onSelect={event => event.preventDefault()}>
              <span className="break-all">{model === 'default' ? `默认模型${defaultModel ? '（' + defaultModel + '）' : ''}` : model}</span>
            </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {error && <p role="alert" className="p-2 text-xs text-destructive">{error}</p>}
      </DropdownMenuContent>
    </DropdownMenu>;
  }
  return (
    <label className="composer-control inline-flex h-9 max-w-56 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-2.5 text-xs text-foreground transition-colors hover:bg-muted/60 has-[:disabled]:opacity-50">
      <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <select
        value={currentModel && options.includes(currentModel) ? currentModel : 'default'}
        onChange={(event) => { void handleChange(event); }}
        onFocus={refreshCatalog}
        onPointerDown={refreshCatalog}
        disabled={disabled || !onModelChange || changing}
        title="选择模型"
        aria-label="选择模型"
        className="min-w-0 max-w-48 cursor-pointer appearance-none bg-transparent pr-1 text-xs outline-none"
      >
        <option value="default">默认模型{defaultModel ? `（${defaultModel}）` : ''}</option>
        {options.map(model => <option key={model} value={model}>{model}</option>)}
      </select>
    </label>
  );
}

export function ContextUsageDialog({ open, usage, sessionUsage, onClose }: { open: boolean; usage?: ContextUsageInfo | null; sessionUsage?: SessionUsageSummary | null; onClose: () => void }) {
  if (!open || !usage) return null;
  const { pct, details, summary } = contextUsagePresentation(usage);
  const limit = usage.modelContext?.contextWindow;
  const contextSegments = [
    { label: '提示词', value: usage.inputTokens, color: '#6366f1' },
    { label: '缓存读', value: usage.cacheRead, color: '#06b6d4' },
    { label: '缓存写', value: usage.cacheWrite, color: '#f59e0b' },
    { label: '输出', value: usage.outputTokens, color: '#22c55e' },
  ];
  const sessionPrompt = sessionUsage?.promptTokens ?? 0;
  const sessionOutput = sessionUsage?.outputTokens ?? 0;
  const sessionTotal = sessionPrompt + sessionOutput;
  return <SessionDialog draggable title="上下文使用情况" wide onClose={onClose}>
    <div className="space-y-4 p-5">
      <div className="grid gap-4 md:grid-cols-[190px_1fr]">
        <div className="flex flex-col items-center justify-center rounded-xl border border-border/60 bg-muted/20 p-4">
          <DonutChart segments={contextSegments} center={`${Math.round(pct * 100)}%`} />
          <div className="mt-3 text-center text-xs font-medium">当前请求上下文</div>
          <div className="mt-1 text-center text-[11px] text-muted-foreground">{summary}</div>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4"><div className="flex items-end justify-between gap-3"><span className="text-sm font-medium">会话窗口占用</span><span className="text-2xl font-semibold tabular-nums">{Math.round(pct * 100)}%</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(pct * 100)}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{details}</p></div>
          <dl className="grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-muted/20 p-3"><dt className="text-muted-foreground">模型</dt><dd className="mt-1 break-all font-medium">{usage.modelContext?.model || '未知'}</dd></div><div className="rounded-lg bg-muted/20 p-3"><dt className="text-muted-foreground">上下文窗口</dt><dd className="mt-1 font-medium">{limit ? formatTokenCount(limit) : '读取中…'}</dd></div></dl>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 p-4"><div className="mb-3 text-xs font-semibold">当前请求分布</div><div className="space-y-2">{contextSegments.map(segment => <UsageRow key={segment.label} label={segment.label} value={segment.value} total={usage.used} color={segment.color} />)}</div></div>
        <div className="rounded-xl border border-border/60 p-4"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-semibold">会话累计</span><span className="text-[11px] text-muted-foreground">{sessionUsage?.requestCount ?? 0} 次请求</span></div><UsageRow label="提示词" value={sessionPrompt} total={sessionTotal} color="#6366f1" /><UsageRow label="输出" value={sessionOutput} total={sessionTotal} color="#22c55e" /><div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]"><div className="rounded-lg bg-muted/20 p-2"><div className="font-semibold">{sessionUsage?.toolCalls ?? 0}</div><div className="text-muted-foreground">工具调用</div></div><div className="rounded-lg bg-muted/20 p-2"><div className="font-semibold text-emerald-600">{sessionUsage?.toolSuccess ?? 0}</div><div className="text-muted-foreground">成功</div></div><div className="rounded-lg bg-muted/20 p-2"><div className="font-semibold text-destructive">{sessionUsage?.toolErrors ?? 0}</div><div className="text-muted-foreground">失败</div></div></div></div>
      </div>
      {usage.loadingCapacity && <p className="text-xs text-muted-foreground">正在读取模型上下文上限…</p>}
    </div>
  </SessionDialog>;
}

function DonutChart({ segments, center }: { segments: Array<{ label: string; value: number; color: string }>; center: string }) {
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  let cursor = 0;
  const stops = total > 0 ? segments.map(segment => { const start = cursor; cursor += Math.max(0, segment.value) / total * 100; return `${segment.color} ${start}% ${cursor}%`; }).join(', ') : 'hsl(var(--muted)) 0% 100%';
  return <div className="relative h-32 w-32 rounded-full" style={{ background: `conic-gradient(${stops})` }}><div className="absolute inset-3 flex items-center justify-center rounded-full bg-card text-lg font-semibold tabular-nums">{center}</div></div>;
}

function UsageRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const percentage = total > 0 ? Math.round(value / total * 100) : 0;
  return <div className="flex items-center gap-2 text-xs"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} /><span className="min-w-0 flex-1 text-muted-foreground">{label}</span><span className="tabular-nums">{formatTokenCount(value)}</span><span className="w-9 text-right text-muted-foreground tabular-nums">{percentage}%</span></div>;
}

export function OutlineDialog({ open, outline, onJump, onClose }: { open: boolean; outline: SessionOutlineEntry[]; onJump?: (messageId: string) => void; onClose: () => void }) {
  const [query, setQuery] = React.useState('');
  React.useEffect(() => { if (open) setQuery(''); }, [open]);
  if (!open) return null;
  const normalized = query.trim().toLowerCase();
  const filtered = normalized ? outline.filter(entry => `${entry.question}\n${entry.answerPreview}`.toLowerCase().includes(normalized)) : outline;
  return <SessionDialog title="会话大纲" wide onClose={onClose}>
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">快速定位当前会话的对话轮次</p><span className="rounded-full bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{outline.length} 轮</span></div>
      <input data-initial-focus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索对话轮次…" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      <div className="max-h-[min(52vh,420px)] overflow-y-auto rounded-xl border border-border/60">
        {filtered.length === 0 ? <div className="px-4 py-10 text-center text-xs text-muted-foreground">{outline.length ? '无匹配结果' : '还没有对话轮次'}</div> : filtered.map((entry, index) => <button key={entry.messageId} type="button" className="flex w-full flex-col gap-1 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50" onClick={() => { onJump?.(entry.messageId); onClose(); }}><span className="truncate text-sm font-medium">{index + 1}. {entry.question || '（附件消息）'}</span>{entry.answerPreview && <span className="truncate text-xs text-muted-foreground">{entry.answerPreview}</span>}</button>)}
      </div>
    </div>
  </SessionDialog>;
}
