import * as React from 'react';
import * as Slider from '@radix-ui/react-slider';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import type { EffortLevel, SessionEffortConfiguration } from '../types';

const LABELS: Record<EffortLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max' };

export function SessionEffortSelector({ sessionId, disabled = false, busy = false }: { sessionId: string; disabled?: boolean; busy?: boolean }) {
  const [config, setConfig] = React.useState<SessionEffortConfiguration | null>(null);
  const [draft, setDraft] = React.useState<EffortLevel | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const generation = React.useRef(0);
  const apply = (next: SessionEffortConfiguration) => { setConfig(next); setDraft(next.applied); };

  React.useEffect(() => {
    const current = ++generation.current;
    setError('');
    if (!window.agentDesktop.getSessionEffort) {
      setError('请更新客户端以设置推理强度。');
      return;
    }
    void window.agentDesktop.getSessionEffort({ sessionId }).then(next => {
      if (current === generation.current) apply(next);
    }).catch(cause => { if (current === generation.current) setError(cleanIpcErrorMessage(cause)); });
    return () => { generation.current++; };
  }, [sessionId, busy, open]);

  const save = async (effort: EffortLevel | null) => {
    const current = generation.current;
    setSaving(true);
    setError('');
    try {
      const next = await window.agentDesktop.setSessionEffort({ sessionId, effort });
      if (current === generation.current) apply(next);
    } catch (cause) {
      if (current === generation.current) { setError(cleanIpcErrorMessage(cause)); setDraft(config?.applied ?? null); }
    } finally { setSaving(false); }
  };
  const levels = config?.levels ?? [];
  const locked = disabled || saving || !config || config.overridden || levels.length === 0;
  const selectedIndex = Math.max(0, levels.indexOf(draft ?? 'high'));
  const label = draft ? LABELS[draft] : 'Auto';
  const status = saving ? '正在应用…' : config?.overridden ? '由环境变量指定' : config && levels.length === 0 ? '当前模型不支持设置推理强度' : '';

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <button type="button" disabled={disabled} aria-label={`推理强度：${config?.applied ? LABELS[config.applied] : 'Auto'}`}
        title="推理强度 · 仅当前会话，后续请求生效"
        className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-50">
        <span>{config?.applied ? LABELS[config.applied] : '推理强度'}</span><ChevronDown className="h-3 w-3" />
      </button>
    </PopoverTrigger>
    <PopoverContent side="top" align="start" sideOffset={6} className="w-64 rounded-xl border-border/70 bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur">
      <div className="flex h-6 items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-primary">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={config?.model}>{config?.model || '读取中…'}</span>
        <button type="button" className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="恢复模型默认推理强度" title="恢复模型默认" disabled={locked} onClick={() => void save(null)}>
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      {levels.length > 0 && <div className="relative mt-2">
        <Slider.Root min={0} max={Math.max(1, levels.length - 1)} step={1} value={[selectedIndex]} disabled={locked}
          onValueChange={([index]) => setDraft(levels[index] ?? null)} onValueCommit={([index]) => void save(levels[index] ?? null)}
          className="relative flex h-5 w-full touch-none select-none items-center">
          <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-primary/20">
            <Slider.Range className="absolute h-full rounded-full bg-primary" />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-between px-2" aria-hidden="true">{levels.map(level => <span key={level} className="h-1 w-1 rounded-full bg-foreground/25" />)}</span>
          </Slider.Track>
          <Slider.Thumb aria-label="当前会话推理强度" aria-valuetext={label} className="block h-4 w-4 rounded-full bg-foreground shadow ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" />
        </Slider.Root>
      </div>}
      {status && <p className="mt-2 text-[11px] text-muted-foreground" role="status">{status}</p>}
      {error && <p className="mt-2 text-xs text-destructive" role="alert">{error}</p>}
    </PopoverContent>
  </Popover>;
}
