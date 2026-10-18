import { useToolDisplaySettings } from '@/components/chat/tool-display-settings';
import type { PresentationResult } from '@/types';

export function parsePresentationResult(raw: unknown, text: string): PresentationResult | null {
  let result: any = raw;
  if (result?.presentationResult) result = result.presentationResult;
  if (result?.schema === 'moss.presentation-result/v1') return result;
  try { result = JSON.parse(typeof raw === 'string' ? raw : text); return result?.schema === 'moss.presentation-result/v1' ? result : null; } catch { return null; }
}
const labels: Record<string, string> = { pending: '已登记，等待预览', shown: '已显示', updated: '已更新', deferred: '已收录到结果', error: '预览失败', unavailable: '内容不可用' };
export function usePresentationToolResult(raw: unknown, text: string) {
  const { presentationResults } = useToolDisplaySettings();
  const original = parsePresentationResult(raw, text);
  return original && (presentationResults?.get(original.request_id) || original);
}
export const presentationResultLabel = (result: PresentationResult) => labels[result.presentation?.state || ''] || (result.ok ? '已登记' : '登记失败');
export function PresentationToolStatus({ raw, text }: { raw: unknown; text: string }) {
  const { sessionId } = useToolDisplaySettings();
  const result = usePresentationToolResult(raw, text);
  if (!result) return null;
  return <div data-presentation-status className="mx-2 mb-2 flex items-center gap-2 rounded border border-border/60 px-3 py-2 text-xs">
    <span className="flex-1 text-muted-foreground">{presentationResultLabel(result)}{result.items?.length ? ` · ${result.items.length} 项` : ''}</span>
    {sessionId && result.ok && <button className="shrink-0 text-primary hover:underline" onClick={() => void window.agentDesktop.presentation.action({ sessionId, action: { type: 'select', id: 'results' } })}>查看结果</button>}
  </div>;
}
