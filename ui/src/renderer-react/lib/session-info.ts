import type { AgentEvent, SessionTokenTotals } from '../types';

type ToolCall = {
  id: string;
  name: string;
  status: 'success' | 'error' | 'unknown';
  startedAt: number | null;
  completedAt: number | null;
};

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function timestamp(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyTotals(): SessionTokenTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, requestCount: 0 };
}

function readUsage(usage: any): SessionTokenTotals | null {
  if (!usage || !['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']
    .some((key) => typeof usage[key] === 'number' && Number.isFinite(usage[key]) && usage[key] >= 0)) return null;
  const inputTokens = count(usage.input_tokens);
  const outputTokens = count(usage.output_tokens);
  const cacheReadTokens = count(usage.cache_read_input_tokens);
  const cacheWriteTokens = count(usage.cache_creation_input_tokens);
  return {
    inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    requestCount: 1,
  };
}

function mergeUsage(left: SessionTokenTotals, right: SessionTokenTotals): SessionTokenTotals {
  const inputTokens = Math.max(left.inputTokens, right.inputTokens);
  const outputTokens = Math.max(left.outputTokens, right.outputTokens);
  const cacheReadTokens = Math.max(left.cacheReadTokens, right.cacheReadTokens);
  const cacheWriteTokens = Math.max(left.cacheWriteTokens, right.cacheWriteTokens);
  return { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens, requestCount: 1 };
}

function addUsage(sum: SessionTokenTotals, usage: SessionTokenTotals) {
  for (const key of Object.keys(sum) as Array<keyof SessionTokenTotals>) sum[key] += usage[key];
}

/** Use provider message IDs and tool-use IDs, never stream-event counts. */
export function buildSessionInfo(history: AgentEvent[]) {
  const requests = new Map<string, SessionTokenTotals & { model: string }>();
  const tools = new Map<string, ToolCall>();
  const compactions = new Set<string>();
  let latestContext: SessionTokenTotals | null = null;
  let currentModel: string | null = null;
  let lastTurnDurationMs: number | null = null;

  const ensureTool = (id: string, name?: string) => {
    let tool = tools.get(id);
    if (!tool) {
      tool = { id, name: name || '未知工具', status: 'unknown', startedAt: null, completedAt: null };
      tools.set(id, tool);
    } else if (name) tool.name = name;
    return tool;
  };

  history.forEach((event, index) => {
    if (!event || typeof event !== 'object') return;
    const isMain = event.parent_tool_use_id == null && !event.isSidechain;
    if (isMain && event.type === 'system' && event.subtype === 'init' && typeof event.model === 'string') {
      currentModel = event.model;
    }
    if (isMain && event.type === 'system' && event.subtype === 'compact_boundary') {
      compactions.add(String(event.uuid || event.id || index));
      // The old request no longer describes the context after compaction.
      latestContext = null;
    }
    if (isMain && event.type === 'result' && typeof event.duration_ms === 'number'
      && Number.isFinite(event.duration_ms) && event.duration_ms >= 0) {
      lastTurnDurationMs = event.duration_ms;
    }
    if (event.type === 'assistant' && event.message?.model !== '<synthetic>' && !event.isApiErrorMessage) {
      const model = typeof event.message?.model === 'string' ? event.message.model : 'unknown';
      if (isMain && model !== 'unknown') currentModel = model;
      const usage = readUsage(event.message?.usage);
      if (usage) {
        const key = `${event.parent_tool_use_id || ''}:${event.message?.id || event.uuid || index}`;
        const previous = requests.get(key);
        const merged = previous ? mergeUsage(previous, usage) : usage;
        requests.set(key, { ...merged, model });
        if (isMain) latestContext = merged;
      }
    }

    // Results are cumulative runtime snapshots; adding them to assistant usage
    // double-counts requests. Tool results are paired separately below.
    const blocks = Array.isArray(event.message?.content) ? event.message.content
      : Array.isArray(event.content) ? event.content : [];
    const streamBlock = event.type === 'stream_event' && event.event?.type === 'content_block_start'
      ? event.event.content_block : null;
    const at = timestamp(event.timestamp);
    for (const block of streamBlock ? [...blocks, streamBlock] : blocks) {
      if (block?.type === 'tool_use' && typeof block.id === 'string' && block.id) {
        const tool = ensureTool(block.id, typeof block.name === 'string' ? block.name : undefined);
        if (at !== null) tool.startedAt = tool.startedAt === null ? at : Math.min(tool.startedAt, at);
      } else if (block?.type === 'tool_result' && typeof block.tool_use_id === 'string' && block.tool_use_id) {
        const tool = ensureTool(block.tool_use_id, typeof block.tool_name === 'string' ? block.tool_name : undefined);
        tool.status = block.is_error ? 'error' : 'success';
        if (at !== null) tool.completedAt = at;
      }
    }
  });

  const totals = emptyTotals();
  const modelTotals = new Map<string, SessionTokenTotals & { model: string }>();
  for (const usage of requests.values()) {
    addUsage(totals, usage);
    let model = modelTotals.get(usage.model);
    if (!model) {
      model = { ...emptyTotals(), model: usage.model };
      modelTotals.set(usage.model, model);
    }
    // Only add numeric total fields (not the model name).
    for (const key of Object.keys(totals) as Array<keyof SessionTokenTotals>) model[key] += usage[key];
  }

  const byTool = new Map<string, { name: string; total: number; success: number; error: number; unknown: number; durationMs: number; timedCount: number }>();
  const toolTotals = { total: tools.size, success: 0, error: 0, unknown: 0, durationMs: 0, timedCount: 0 };
  for (const tool of tools.values()) {
    let row = byTool.get(tool.name);
    if (!row) {
      row = { name: tool.name, total: 0, success: 0, error: 0, unknown: 0, durationMs: 0, timedCount: 0 };
      byTool.set(tool.name, row);
    }
    row.total += 1;
    row[tool.status] += 1;
    toolTotals[tool.status] += 1;
    if (tool.status !== 'unknown' && tool.startedAt !== null && tool.completedAt !== null && tool.completedAt >= tool.startedAt) {
      const duration = tool.completedAt - tool.startedAt;
      row.durationMs += duration;
      row.timedCount += 1;
      toolTotals.durationMs += duration;
      toolTotals.timedCount += 1;
    }
  }

  return {
    historyUsage: requests.size > 0 ? { totals, models: [...modelTotals.values()] } : null,
    latestContext,
    currentModel,
    lastTurnDurationMs,
    compactionCount: compactions.size,
    tools: { ...toolTotals, rows: [...byTool.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)) },
  };
}

export function formatSessionDuration(ms: number | null): string {
  if (ms === null) return '暂无记录';
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} 秒`;
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分` : `${minutes} 分 ${Math.floor(ms % 60_000 / 1000)} 秒`;
}
