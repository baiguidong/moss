import * as React from 'react';
import { ImageIcon, LoaderCircle, AlertCircle, ArrowUpRight } from 'lucide-react';
import { LocalImage } from '@/components/local-image';
import { handleMarkdownLinkClick } from '@/lib/markdown-links';
import type { ToolResultRenderMessage, ToolUseRenderMessage } from '@/lib/agent-transcript';

function record(value: unknown): Record<string, any> | null {
  if (typeof value === 'string') { try { return record(JSON.parse(value)); } catch { return null; } }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

export function imageGenerationResult(result?: ToolResultRenderMessage) {
  const raw = result?.rawContent;
  const blocks = Array.isArray(raw) ? raw : [];
  const metadata = record(result?.structuredResult) || record(raw)
    || blocks.map(block => block?.type === 'text' ? record(block.text) : null).find(Boolean)
    || record(result?.content);
  const block = blocks.find(block => block?.type === 'image' && block.source?.type === 'base64');
  const image = metadata?.image;
  const mediaType = image?.mediaType || block?.source?.media_type;
  const base64 = image?.base64 || block?.source?.data;
  const src = typeof base64 === 'string' && /^image\/(png|jpeg|webp)$/.test(mediaType)
    ? `data:${mediaType};base64,${base64}` : undefined;
  return { src, path: typeof metadata?.filePath === 'string' ? metadata.filePath : result?.attachments?.find(item => item.kind === 'image')?.path,
    failed: result?.isError || metadata?.ok === false,
    error: typeof metadata?.error === 'string' ? metadata.error : undefined };
}

/** Image artifacts remain visible even when ordinary tool receipts collapse. */
export function ImageGenerationCard({ toolCall, result, sessionId }: {
  toolCall: ToolUseRenderMessage; result?: ToolResultRenderMessage; sessionId?: string;
}) {
  const output = React.useMemo(() => imageGenerationResult(result), [result]);
  const failed = output.failed || toolCall.status === 'error';
  const running = !result && !failed && ['running', 'pending'].includes(toolCall.status);
  const [openError, setOpenError] = React.useState('');
  const prompt = record(toolCall.input)?.prompt;
  const label = running ? '正在生成图片…' : failed ? '图片生成失败' : output.src || output.path ? '图片已生成' : '图片生成已结束，未收到图片';
  return <div data-image-generation={running ? 'running' : failed ? 'failed' : 'completed'} className="my-3 max-w-2xl space-y-2">
    <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
      {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : failed ? <AlertCircle className="h-4 w-4 text-destructive" /> : <ImageIcon className="h-4 w-4" />}
      <span>{label}</span><span className="ml-auto text-[10px]" aria-label="来源：Moss 内置">Moss 内置</span>
    </div>
    {running ? <div className="flex min-h-44 items-center justify-center rounded-xl border border-border/60 bg-muted/25 text-sm text-muted-foreground">正在绘制，请稍候</div> : null}
    {!failed && (output.src || output.path) ? <div className="overflow-hidden rounded-xl border border-border/50 bg-muted/20 p-1">
      <LocalImage src={output.src || output.path!} alt="生成的图片" className="mx-auto max-h-[520px] max-w-full rounded-lg object-contain" />
    </div> : null}
    {failed ? <p role="alert" className="break-words text-sm text-destructive">{output.error || result?.content || '请求已停止或失败，请在主会话中重试。'}</p> : null}
    {output.path && !failed ? <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={event => {
      setOpenError(''); void handleMarkdownLinkClick(event, output.path!, window.agentDesktop, sessionId).catch(error => setOpenError(String(error)));
    }}><ArrowUpRight className="h-3 w-3" />在右侧查看图片</button> : null}
    {openError ? <p role="alert" className="text-xs text-destructive">{openError}</p> : null}
    {typeof prompt === 'string' && prompt ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">提示词</summary><p className="mt-2 whitespace-pre-wrap break-words select-text">{prompt}</p></details> : null}
  </div>;
}
