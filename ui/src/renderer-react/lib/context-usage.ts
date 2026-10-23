import type { AgentEvent, ModelContextInfo } from '../types';
import { getContextUsageFromUsage } from '../../../../shared/context-token-usage';

export type ContextUsageInfo = {
  used: number;
  inputTokens: number;
  cacheRead: number;
  cacheWrite: number;
  outputTokens: number;
  modelContext: ModelContextInfo | null;
  loadingCapacity: boolean;
};

// Result usage is cumulative across API calls; only assistant usage describes
// the current context. Subagents have independent windows and are excluded.
export function deriveContextUsage(
  history: AgentEvent[] | undefined,
  modelContext: ModelContextInfo | null,
  loadingCapacity = false,
): ContextUsageInfo | null {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (event?.type === 'system' && event.subtype === 'compact_boundary' && event.parent_tool_use_id == null) return null;
    if (event?.type !== 'assistant' || event.parent_tool_use_id != null || event.isSidechain
      || event.isUnmetered || event.message?.model === '<synthetic>') continue;
    const usage = event.message?.usage;
    if (usage && typeof usage.input_tokens === 'number') {
      const contextUsage = getContextUsageFromUsage(usage);
      const inputTokens = contextUsage.input_tokens;
      const cacheRead = contextUsage.cache_read_input_tokens;
      const cacheWrite = contextUsage.cache_creation_input_tokens;
      const outputTokens = contextUsage.output_tokens;
      return {
        used: inputTokens + cacheRead + cacheWrite + outputTokens,
        inputTokens, cacheRead, cacheWrite, outputTokens,
        modelContext, loadingCapacity,
      };
    }
  }
  return null;
}

export function getRemoteModelContext(history: AgentEvent[] | undefined): ModelContextInfo | null {
  if (!Array.isArray(history)) return null;
  let model: string | undefined;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (event?.parent_tool_use_id != null) continue;
    if (event?.type === 'assistant' && typeof event.message?.model === 'string') {
      model = event.message.model;
      break;
    }
    if (event?.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') {
      model = event.model;
      break;
    }
  }
  if (!model) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const event = history[i];
    if (event?.type !== 'result' || event.parent_tool_use_id != null) continue;
    const contextWindow = event.modelUsage?.[model]?.contextWindow;
    if (Number.isSafeInteger(contextWindow) && contextWindow > 0) {
      return { model, contextWindow, isDefault: false };
    }
    if (event.modelUsage?.[model]) return null;
  }
  return null;
}

export function formatTokenCount(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

export function contextUsagePresentation(usage: ContextUsageInfo) {
  const limit = usage.modelContext?.contextWindow;
  const pct = !usage.modelContext?.isDefault && typeof limit === 'number' && Number.isFinite(limit) && limit > 0
    ? Math.min(1, Math.max(0, usage.used / limit))
    : null;
  const capacity = pct !== null
    ? `${formatTokenCount(limit!)}（${Math.round(pct * 100)}%）`
    : usage.loadingCapacity ? '容量读取中' : '容量未知';
  return {
    pct,
    summary: `上下文已用 ${formatTokenCount(usage.used)} / ${capacity}`,
    details: `输入 ${formatTokenCount(usage.inputTokens)} · 缓存读 ${formatTokenCount(usage.cacheRead)} · 缓存写 ${formatTokenCount(usage.cacheWrite)} · 输出 ${formatTokenCount(usage.outputTokens)}`,
  };
}
