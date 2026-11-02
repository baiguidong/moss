import * as React from 'react';
import { ArrowUp, Info, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function ProjectCreationComposer({ value, onChange, busy, onSend }: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  onSend: (prompt: string) => Promise<void>;
}) {
  const textarea = React.useRef<HTMLTextAreaElement>(null);
  const submitting = React.useRef(false);
  const [error, setError] = React.useState('');
  React.useLayoutEffect(() => {
    const input = textarea.current;
    if (!input) return;
    input.style.height = '0px';
    input.style.height = `${Math.min(240, Math.max(112, input.scrollHeight))}px`;
  }, [value]);
  const submit = async () => {
    if (!value.trim() || busy || submitting.current) return;
    submitting.current = true; setError('');
    try { await onSend(value.trim()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { submitting.current = false; }
  };
  return <section aria-label="通过会话创建项目" className="mx-auto w-full max-w-[820px] py-6 sm:py-8">
    <div className="mb-5 text-center">
      <h1 className="text-xl font-medium tracking-tight text-foreground sm:text-2xl">想创建什么项目？</h1>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">描述你的目标，我会整理项目方案，协助选择技能、专家和 App。</p>
    </div>
    <form onSubmit={event => { event.preventDefault(); void submit(); }} aria-busy={busy}
      className="rounded-[26px] border border-border/80 bg-card/92 shadow-[0_24px_80px_-44px_rgba(0,0,0,0.55)] backdrop-blur focus-within:border-primary/40">
      <Textarea ref={textarea} value={value} onChange={event => { setError(''); onChange(event.target.value); }} disabled={busy}
        aria-label="描述要创建的项目" placeholder="描述项目目标、约束，以及希望使用的技能、专家或 App…"
        className="min-h-[112px] max-h-[240px] resize-none overflow-y-auto rounded-t-[26px] border-0 bg-transparent px-4 pb-2 pt-4 text-sm leading-6 shadow-none focus-visible:ring-0 sm:px-5 [field-sizing:fixed]"
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
            event.preventDefault(); void submit();
          }
        }} />
      <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1 sm:px-5">
        <Tooltip>
          <TooltipTrigger asChild><button type="button" aria-label="了解项目创建流程" className="inline-flex min-w-0 items-center gap-1.5 rounded-md text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"><Info className="h-3.5 w-3.5 shrink-0" /><span>确认方案后创建</span></button></TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">先通过会话完善项目方案，确认后安装缺失资源并创建项目。后续项目会话会自动携带所选资源。</TooltipContent>
        </Tooltip>
        <div className="flex shrink-0 items-center gap-3"><span className="hidden text-xs text-muted-foreground sm:inline">Shift + Enter 换行</span>
          <Button type="submit" size="icon" aria-label="发送项目需求" title="发送项目需求" disabled={busy || !value.trim()} className="h-9 w-9 rounded-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </form>
    {error && <p role="alert" className="mt-2 px-4 text-xs text-destructive">{error}</p>}
  </section>;
}
