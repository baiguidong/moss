import * as React from 'react';
import { Activity, Download, Layers3, LayoutGrid, ListTree, MessageCircleQuestion, ShieldCheck, Cpu, Gauge, X, Grip } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { contextUsagePresentation, formatTokenCount, type ContextUsageInfo } from '@/lib/context-usage';
import { PermissionModeSelector } from '@/components/permission-mode-selector';
import type { DesktopSettings } from '../types';
import type { PermissionMode } from '../types';

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

type Props = {
  onOpenSideQuestion?: () => void;
  onCompact?: () => void;
  onExport?: () => Promise<void>;
  permissionMode?: PermissionMode;
  onPermissionModeChange?: (mode: PermissionMode) => Promise<void> | void;
  permissionModeChanging?: boolean;
  sessionInfo?: React.ReactNode;
  effortControl?: React.ReactNode;
  contextUsage?: ContextUsageInfo | null;
  currentModel?: string;
  onModelChange?: (model: string) => Promise<void>;
  modelSettings?: Pick<DesktopSettings, 'url' | 'apiKey' | 'availableModels'>;
  sessionUsage?: SessionUsageSummary | null;
  outline?: SessionOutlineEntry[];
  onJumpToOutlineItem?: (messageId: string) => void;
  disabled?: boolean;
};

export function ModelSelector({
  currentModel,
  onModelChange,
  modelSettings,
  disabled = false,
}: Pick<Props, 'currentModel' | 'onModelChange' | 'modelSettings' | 'disabled'>) {
  const [models, setModels] = React.useState<string[]>(modelSettings?.availableModels || []);
  const [defaultModel, setDefaultModel] = React.useState(currentModel || '');
  const [changing, setChanging] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    const configured = modelSettings?.availableModels || [];
    setModels(configured);
    setDefaultModel(currentModel || configured[0] || '');
    void window.agentDesktop.listModels({ url: modelSettings?.url || '', apiKey: modelSettings?.apiKey || '' })
      .then(catalog => {
        if (!cancelled) {
          // When the user has configured an allow-list, keep the session
          // selector restricted to it. An empty local list may fall back to
          // the server-managed catalog.
          if (!configured.length) setModels(catalog.models || []);
          setDefaultModel(currentModel || (catalog as typeof catalog & { defaultModel?: string }).defaultModel || configured[0] || catalog.models?.[0] || '');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [modelSettings?.apiKey, modelSettings?.availableModels, modelSettings?.url]);
  const options = [...new Set([...(models || []), currentModel || ''].filter(Boolean))];
  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    if (!onModelChange || changing) return;
    setChanging(true);
    try { await onModelChange(event.target.value); }
    finally { setChanging(false); }
  };
  return (
    <label className="composer-control inline-flex h-9 max-w-56 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-2.5 text-xs text-foreground transition-colors hover:bg-muted/60 has-[:disabled]:opacity-50">
      <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
      <select
        value={currentModel && options.includes(currentModel) ? currentModel : 'default'}
        onChange={(event) => { void handleChange(event); }}
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

/**
 * Small command launcher that sits beside the file picker in the session
 * composer. Frequent session commands open their desktop-native card or panel.
 */
export function SessionCommandLauncher({
  onOpenSideQuestion,
  onCompact,
  onExport,
  permissionMode,
  onPermissionModeChange,
  permissionModeChanging = false,
  sessionInfo,
  effortControl,
  contextUsage,
  currentModel,
  onModelChange,
  modelSettings,
  sessionUsage,
  outline = [],
  onJumpToOutlineItem,
  disabled = false,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [contextOpen, setContextOpen] = React.useState(false);
  const [outlineOpen, setOutlineOpen] = React.useState(false);
  const close = () => setOpen(false);

  const contextPresentation = contextUsage ? contextUsagePresentation(contextUsage) : null;

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="打开会话操作"
          aria-haspopup="menu"
          aria-expanded={open}
          title="会话操作"
          className="composer-control inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-muted/35 p-0 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50"
        >
          <LayoutGrid className="h-4 w-4" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        className="w-[min(560px,calc(100vw-32px))] rounded-2xl border-border/70 bg-card/95 p-3 shadow-xl backdrop-blur"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <div>
            <div className="text-sm font-medium">会话操作</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">选择一个操作，结果会回到当前会话</div>
          </div>
          <LayoutGrid className="h-4 w-4 text-primary" aria-hidden="true" />
        </div>

        <div className="mb-2 px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">常用</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="menu" aria-label="常用会话操作">
          <button
            type="button"
            role="menuitem"
            disabled={!onOpenSideQuestion}
            onClick={() => { close(); onOpenSideQuestion?.(); }}
            className="flex min-h-16 items-start gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-45"
          >
            <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span><span className="block text-xs font-medium">侧问</span><span className="mt-1 block text-[11px] text-muted-foreground">不打断主任务</span></span>
          </button>

          <div
            className="flex min-h-16 items-start gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2"
            onClick={(event) => {
              if (event.target === event.currentTarget || !(event.target as HTMLElement).closest('button')) {
                event.currentTarget.querySelector('button')?.click();
              }
            }}
          >
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium">状态</span><span className="mt-1 block text-[11px] text-muted-foreground">查看当前会话信息</span></span>
            {sessionInfo}
          </div>

          <button
            type="button"
            role="menuitem"
            disabled={!onJumpToOutlineItem}
            onClick={() => { close(); setOutlineOpen(true); }}
            className="flex min-h-16 items-start gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-45"
          >
            <ListTree className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span><span className="block text-xs font-medium">会话大纲</span><span className="mt-1 block text-[11px] text-muted-foreground">{outline.length ? `${outline.length} 个对话轮次` : '浏览对话轮次'}</span></span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!contextUsage}
            onClick={() => { close(); setContextOpen(true); }}
            className="flex min-h-16 items-start gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-45"
          >
            <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span><span className="block text-xs font-medium">上下文</span><span className="mt-1 block text-[11px] text-muted-foreground">{contextPresentation?.summary || '暂无上下文用量'}</span></span>
          </button>
        </div>

        <div className="mb-2 mt-3 px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">调整与会话</div>
        <div className="grid grid-cols-2 gap-2" role="menu" aria-label="调整与会话操作">

          <div className="col-span-2 flex min-h-12 items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2">
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium">调整推理强度</span><span className="mt-1 block text-[11px] text-muted-foreground">仅影响当前会话的后续请求</span></span>
            {effortControl}
          </div>

          <button
            type="button"
            role="menuitem"
            disabled={!onCompact}
            onClick={() => { close(); onCompact?.(); }}
            className="col-span-2 flex min-h-12 items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-45"
          >
            <Layers3 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span><span className="block text-xs font-medium">压缩上下文</span><span className="mt-1 block text-[11px] text-muted-foreground">保留摘要，释放当前会话空间</span></span>
          </button>

          <div
            role="menuitem"
            aria-disabled={!permissionMode || !onPermissionModeChange || disabled}
            className="flex min-h-12 items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/60 aria-disabled:opacity-45"
          >
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="block text-xs font-medium">权限模式</span><span className="mt-1 block text-[11px] text-muted-foreground">只影响当前会话</span></span>
            {permissionMode && onPermissionModeChange && <PermissionModeSelector value={permissionMode} onChange={onPermissionModeChange} disabled={disabled || permissionModeChanging} />}
          </div>

          <button
            type="button"
            role="menuitem"
            disabled={!onExport}
            onClick={() => { close(); void onExport?.(); }}
            className="flex min-h-12 items-center gap-2 rounded-xl border border-border/60 bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:opacity-45"
          >
            <Download className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span><span className="block text-xs font-medium">导出会话</span><span className="mt-1 block text-[11px] text-muted-foreground">保存当前对话文本</span></span>
          </button>
        </div>
      </PopoverContent>
    </Popover>

    <ContextUsageDialog open={contextOpen} usage={contextUsage} sessionUsage={sessionUsage} onClose={() => setContextOpen(false)} />
    <OutlineDialog open={outlineOpen} outline={outline} onJump={onJumpToOutlineItem} onClose={() => setOutlineOpen(false)} />
    </>
  );
}

export function DraggableDialogShell({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input, textarea, select, a')) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX, y: event.clientY, originX: position.x, originY: position.y };
    const move = (moveEvent: PointerEvent) => {
      if (!dragRef.current) return;
      setPosition({
        x: dragRef.current.originX + moveEvent.clientX - dragRef.current.x,
        y: dragRef.current.originY + moveEvent.clientY - dragRef.current.y,
      });
    };
    const stop = () => {
      dragRef.current = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  };
  React.useEffect(() => () => { dragRef.current = null; }, []);
  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-labelledby={`dialog-title-${title}`} style={{ transform: `translate(${position.x}px, ${position.y}px)` }} className={`w-[min(${wide ? '680px' : '500px'},calc(100vw-32px))] max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-border bg-card text-foreground shadow-2xl`}>
    <div className="flex cursor-grab touch-none items-center justify-between border-b border-border/60 px-5 py-3 active:cursor-grabbing" onPointerDown={handlePointerDown} title="拖动移动窗口">
      <h2 id={`dialog-title-${title}`} className="text-sm font-semibold">{title}</h2>
      <div className="flex items-center gap-1"><Grip className="h-4 w-4 text-muted-foreground/70" aria-hidden="true" /><button type="button" aria-label="关闭" className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose}><X className="h-4 w-4" /></button></div>
    </div>
    {children}
    </div>
  </div>;
}

function ContextUsageDialog({ open, usage, sessionUsage, onClose }: { open: boolean; usage?: ContextUsageInfo | null; sessionUsage?: SessionUsageSummary | null; onClose: () => void }) {
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
  return <DraggableDialogShell title="上下文使用情况" wide onClose={onClose}>
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
  </DraggableDialogShell>;
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

function OutlineDialog({ open, outline, onJump, onClose }: { open: boolean; outline: SessionOutlineEntry[]; onJump?: (messageId: string) => void; onClose: () => void }) {
  const [query, setQuery] = React.useState('');
  React.useEffect(() => { if (open) setQuery(''); }, [open]);
  if (!open) return null;
  const normalized = query.trim().toLowerCase();
  const filtered = normalized ? outline.filter(entry => `${entry.question}\n${entry.answerPreview}`.toLowerCase().includes(normalized)) : outline;
  return <DraggableDialogShell title="会话大纲" wide onClose={onClose}>
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">快速定位当前会话的对话轮次</p><span className="rounded-full bg-muted px-2 py-1 text-[11px] tabular-nums text-muted-foreground">{outline.length} 轮</span></div>
      <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索对话轮次…" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      <div className="max-h-[min(52vh,420px)] overflow-y-auto rounded-xl border border-border/60">
        {filtered.length === 0 ? <div className="px-4 py-10 text-center text-xs text-muted-foreground">{outline.length ? '无匹配结果' : '还没有对话轮次'}</div> : filtered.map((entry, index) => <button key={entry.messageId} type="button" className="flex w-full flex-col gap-1 border-b border-border/40 px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50" onClick={() => { onJump?.(entry.messageId); onClose(); }}><span className="truncate text-sm font-medium">{index + 1}. {entry.question || '（附件消息）'}</span>{entry.answerPreview && <span className="truncate text-xs text-muted-foreground">{entry.answerPreview}</span>}</button>)}
      </div>
    </div>
  </DraggableDialogShell>;
}

function ModelPickerDialog({ open, currentModel, settings, onSelect, onClose }: { open: boolean; currentModel?: string; settings?: Pick<DesktopSettings, 'url' | 'apiKey' | 'availableModels'>; onSelect?: (model: string) => Promise<void>; onClose: () => void }) {
  const [models, setModels] = React.useState<string[]>([]);
  const [value, setValue] = React.useState(currentModel || '');
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!open) return;
    setValue(currentModel || '');
    setError('');
    let cancelled = false;
    setModels(settings?.availableModels || []);
    setLoading(true);
    void window.agentDesktop.listModels({ url: settings?.url || '', apiKey: settings?.apiKey || '' }).then(catalog => {
      if (!cancelled) setModels([...(settings?.availableModels || []), ...(catalog.models || [])].filter((model, index, values) => values.indexOf(model) === index));
    }).catch(cause => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [currentModel, open, settings?.apiKey, settings?.availableModels, settings?.url]);
  if (!open) return null;
  const save = async () => {
    const next = value.trim();
    if (!next || !onSelect || saving) return;
    setSaving(true); setError('');
    try { await onSelect(next); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  };
  return <DraggableDialogShell title="选择模型" onClose={onClose}>
    <div className="space-y-3 p-5">
      <p className="text-xs leading-5 text-muted-foreground">选择只作用于当前会话；新会话可单独选择，运行中的请求完成后再应用。</p>
      <input value={value} onChange={event => setValue(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); }} placeholder="输入模型名称" className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring" />
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border/60">
        <button type="button" onClick={() => setValue('default')} className={`flex w-full items-center px-3 py-2 text-left text-xs hover:bg-muted ${value === 'default' ? 'bg-primary/10 text-primary' : ''}`}>使用默认模型{settings?.availableModels?.[0] ? `（${settings.availableModels[0]}）` : ''}</button>
        {loading ? <p className="p-3 text-xs text-muted-foreground">正在读取可用模型…</p> : models.length ? models.map(model => <button type="button" key={model} onClick={() => setValue(model)} className={`flex w-full items-center px-3 py-2 text-left text-xs hover:bg-muted ${value === model ? 'bg-primary/10 text-primary' : ''}`}>{model}</button>) : <p className="p-3 text-xs text-muted-foreground">暂无模型列表，可直接输入模型名称。</p>}
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted" onClick={onClose}>取消</button><button type="button" disabled={!value.trim() || saving} className="rounded-lg bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" onClick={() => void save()}>{saving ? '应用中…' : '应用模型'}</button></div>
    </div>
  </DraggableDialogShell>;
}
