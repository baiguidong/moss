export type ToolStatus = 'pending' | 'running' | 'success' | 'error';

export type ToolStep = {
  id: string;
  name: string;
  type: 'exec' | 'search' | 'code' | 'api' | 'db' | 'other';
  status: ToolStatus;
  duration?: number;
  result?: string;
  inputSummary?: string;
  statusText?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  timestamp: Date;
  toolSteps?: ToolStep[];
  toolsComplete?: boolean;
  meta?: string[];
  streaming?: boolean;
  images?: string[];
  files?: string[];
};

export type WorkerThreadStatus = 'queued' | 'running' | 'completed' | 'failed';

export type WorkerThread = {
  id: string;
  title: string;
  prompt: string;
  status: WorkerThreadStatus;
  agentId?: string;
  description?: string;
  summary?: string;
  resultText?: string;
  messages: ChatMessage[];
};

export type AgentTranscriptDebugInfo = {
  historyLength: number;
  mainHistoryLength: number;
  derivedWorkers: Array<{
    id: string;
    title: string;
    status: WorkerThreadStatus;
    promptPreview: string;
    resultPreview: string;
    messageCount: number;
  }>;
  mainMessages: Array<{
    role: 'user' | 'assistant';
    contentPreview: string;
    meta?: string[];
  }>;
};

type AgentEvent = Record<string, any>;

type MutableChatMessage = ChatMessage & {
  _finalized?: boolean;
};

function safeDate(input: unknown): Date {
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string') {
    const timestamp = Date.parse(input);
    if (!Number.isNaN(timestamp)) return new Date(timestamp);
  }
  return new Date();
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeText(entry)).filter(Boolean).join('\n\n').trim();
  }
  if (value && typeof value === 'object') {
    if (typeof (value as any).text === 'string') return (value as any).text.trim();
    if (typeof (value as any).content === 'string') return (value as any).content.trim();
  }
  return '';
}

function appendText(message: MutableChatMessage, text: string) {
  const normalized = String(text || '').trim();
  if (!normalized) return;
  message.content = message.content ? `${message.content}\n\n${normalized}` : normalized;
}

function appendThinking(message: MutableChatMessage, text: string) {
  const normalized = String(text || '');
  if (!normalized.trim()) return;
  message.thinking = `${message.thinking || ''}${normalized}`;
}

function summarizeThinkingBlock(block: any): string {
  if (block?.type === 'thinking' && typeof block.thinking === 'string') {
    return block.thinking;
  }
  if (block?.type === 'redacted_thinking') {
    return '模型返回了受保护的思考内容，当前只提供占位信息。';
  }
  return '';
}

function summarizeToolResultBlock(block: any): string {
  const parts: string[] = [];
  const text = normalizeText(block?.content);
  if (text) parts.push(text);
  else if (block?.content !== undefined) parts.push(formatJson(block.content));
  if (block?.is_error) parts.unshift('执行失败');
  return parts.join('\n\n').trim();
}

function extractInputSummary(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const i = input as Record<string, unknown>;
  if (typeof i.file_path === 'string') return i.file_path;
  if (typeof i.path === 'string') return i.path;
  if (typeof i.pattern === 'string') return i.pattern;
  if (typeof i.command === 'string') return String(i.command).slice(0, 100);
  if (typeof i.url === 'string') return i.url;
  if (typeof i.query === 'string') return String(i.query).slice(0, 100);
  if (typeof i.prompt === 'string') return String(i.prompt).slice(0, 100);
  const firstStr = Object.values(i).find((v) => typeof v === 'string');
  return firstStr ? String(firstStr).slice(0, 100) : undefined;
}

function mapToolType(name: string): ToolStep['type'] {
  const lower = String(name || '').toLowerCase();
  if (lower.includes('bash') || lower.includes('exec') || lower.includes('command')) return 'exec';
  if (lower.includes('read') || lower.includes('glob') || lower.includes('grep') || lower.includes('search')) return 'search';
  if (lower.includes('write') || lower.includes('edit') || lower.includes('patch') || lower.includes('multi_edit')) return 'code';
  if (lower.includes('web') || lower.includes('fetch') || lower.includes('api')) return 'api';
  if (lower.includes('sql') || lower.includes('db')) return 'db';
  return 'other';
}

function humanizeToolName(name: string): string {
  return String(name || 'Tool')
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
}

function buildToolDetail(input: unknown, output?: unknown): string {
  const parts: string[] = [];
  if (input !== undefined && input !== null && !(typeof input === 'object' && Object.keys(input).length === 0)) {
    parts.push(`Input\n${formatJson(input)}`);
  }
  if (output !== undefined && output !== null) {
    parts.push(`Output\n${typeof output === 'string' ? output : formatJson(output)}`);
  }
  return parts.join('\n\n').trim();
}

function normalizeTextFromContentBlocks(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      if ((block as any).type === 'text' && typeof (block as any).text === 'string') {
        return (block as any).text;
      }
      if ((block as any).type === 'thinking' && typeof (block as any).thinking === 'string') {
        return (block as any).thinking;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function previewText(value: unknown, max = 120): string {
  const text = normalizeText(value).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

// ---------------------------------------------------------------------------
// Event classifiers used for main-chat sanitization
// ---------------------------------------------------------------------------

function isWorkerCompletionEvent(event: AgentEvent): boolean {
  return (
    event?.type === 'user' &&
    !!event?.tool_use_result &&
    typeof event.tool_use_result === 'object' &&
    typeof event.tool_use_result.agentId === 'string' &&
    typeof event.tool_use_result.status === 'string' &&
    event.tool_use_result.status !== 'async_launched'
  );
}

function isWorkerAsyncLaunchEvent(event: AgentEvent): boolean {
  return (
    event?.type === 'user' &&
    !!event?.tool_use_result &&
    typeof event.tool_use_result === 'object' &&
    typeof event.tool_use_result.agentId === 'string' &&
    event.tool_use_result.status === 'async_launched'
  );
}

function isSidechainEvent(event: AgentEvent): boolean {
  return (
    !!event &&
    typeof event === 'object' &&
    event.isSidechain === true &&
    typeof event.agentId === 'string' &&
    event.agentId.trim().length > 0
  );
}

function isWorkerLaunchToolUse(block: any): boolean {
  const toolName = String(block?.name || '').trim();
  return (
    block?.type === 'tool_use' &&
    toolName === 'Agent' &&
    typeof block?.id === 'string' &&
    block?.input &&
    typeof block.input === 'object' &&
    typeof block.input.prompt === 'string'
  );
}

// Strip Agent tool-use blocks from a top-level assistant event so the
// coordinator's "I'm launching workers" message shows its text but not the
// raw tool invocation JSON.
function stripWorkerLaunchBlocks(event: AgentEvent): AgentEvent | null {
  if (event?.type !== 'assistant' || !Array.isArray(event?.message?.content)) {
    return event;
  }
  const filtered = event.message.content.filter((block: any) => !isWorkerLaunchToolUse(block));
  if (filtered.length === event.message.content.length) return event;
  if (filtered.length === 0) return null;
  return { ...event, message: { ...event.message, content: filtered } };
}

// Collect all Agent tool-use IDs from the coordinator's own assistant messages.
// In coordinator mode the SDK normalises in-process worker events into plain
// assistant/user events that carry parent_tool_use_id pointing back to the
// Agent call that spawned the worker. We use these IDs to drop worker events.
function collectAgentToolUseIds(history: AgentEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of history) {
    if (event?.type !== 'assistant' || !Array.isArray(event?.message?.content)) continue;
    for (const block of event.message.content) {
      if (
        block?.type === 'tool_use' &&
        String(block?.name || '').trim() === 'Agent' &&
        typeof block?.id === 'string'
      ) {
        ids.add(block.id);
      }
    }
  }
  return ids;
}

// Remove worker-related events from main chat history.
// Workers are now a separate data source (subagent .jsonl files), so their
// events must not appear in the coordinator's chat transcript.
function sanitizeMainHistory(history: AgentEvent[]): AgentEvent[] {
  // Build the set of Agent tool-use IDs once so we can filter worker events.
  const agentToolIds = collectAgentToolUseIds(history);

  const result: AgentEvent[] = [];
  for (const event of history) {
    if (!event || typeof event !== 'object') continue;
    // Drop events that belong to a worker sub-agent (isSidechain path)
    if (isSidechainEvent(event)) continue;
    if (isWorkerAsyncLaunchEvent(event)) continue;
    if (isWorkerCompletionEvent(event)) continue;
    // Drop in-process worker events: the SDK normalises them from progress
    // wrappers into plain assistant/user events but attaches parent_tool_use_id
    // referencing the coordinator's Agent tool call.
    if (
      agentToolIds.size > 0 &&
      typeof event.parent_tool_use_id === 'string' &&
      agentToolIds.has(event.parent_tool_use_id)
    ) {
      continue;
    }
    // Drop user events whose message content consists only of tool_result
    // blocks for Agent calls — these are the coordinator receiving back the
    // worker results and should not appear as orphaned tool steps in the chat.
    if (
      agentToolIds.size > 0 &&
      event?.type === 'user' &&
      Array.isArray(event?.message?.content) &&
      event.message.content.length > 0 &&
      event.message.content.every(
        (block: any) =>
          block?.type === 'tool_result' &&
          typeof block?.tool_use_id === 'string' &&
          agentToolIds.has(block.tool_use_id),
      )
    ) {
      continue;
    }
    const stripped = stripWorkerLaunchBlocks(event);
    if (stripped) result.push(stripped);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

// Build chat messages from a worker sub-agent's raw .jsonl events.
// The events come directly from the SDK file and are the authoritative source
// of worker content — no history-splitting or routing heuristics needed.
export function buildWorkerMessagesFromSubagentEvents(events: any[]): ChatMessage[] {
  // system events only carry the system-prompt text; skip them so they don't
  // appear as an extra message bubble in the worker panel.
  const filtered = events.filter(
    (e) => e && typeof e === 'object' && e.type !== 'system',
  );
  return buildChatMessages(filtered);
}

export function buildMainChatMessagesFromHistory(history: AgentEvent[]): ChatMessage[] {
  const sanitized = sanitizeMainHistory(history);
  // Result text is now embedded inline by buildChatMessages when processing 'result'
  // events (if the assistant had no content yet), so no separate fallback needed.
  return buildChatMessages(sanitized);
}

export function collectAgentTranscriptDebugInfo(
  history: AgentEvent[],
  workerThreads: WorkerThread[],
  mainMessages: ChatMessage[],
): AgentTranscriptDebugInfo {
  const sanitized = sanitizeMainHistory(history);

  return {
    historyLength: history.length,
    mainHistoryLength: sanitized.length,
    derivedWorkers: workerThreads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      status: thread.status,
      promptPreview: previewText(thread.prompt),
      resultPreview: previewText(thread.resultText),
      messageCount: thread.messages.length,
    })),
    mainMessages: mainMessages.map((message) => ({
      role: message.role,
      contentPreview: previewText(message.content),
      meta: message.meta,
    })),
  };
}

// ---------------------------------------------------------------------------
// Core message builder — shared by main chat and worker panels
// ---------------------------------------------------------------------------

function ensureMeta(message: MutableChatMessage) {
  if (!message.meta) message.meta = [];
  return message.meta;
}

function addMeta(message: MutableChatMessage, value: string) {
  if (!value) return;
  const meta = ensureMeta(message);
  if (!meta.includes(value)) meta.push(value);
}

function ensureToolSteps(message: MutableChatMessage) {
  if (!message.toolSteps) message.toolSteps = [];
  return message.toolSteps;
}

function ensureToolStep(message: MutableChatMessage, block: any): ToolStep {
  const toolSteps = ensureToolSteps(message);
  const toolId = String(block?.id || block?.tool_use_id || block?.toolCallId || `${message.id}-tool-${toolSteps.length}`);
  const existing = toolSteps.find((entry) => entry.id === toolId);
  if (existing) return existing;

  const step: ToolStep = {
    id: toolId,
    name: humanizeToolName(block?.display_name || block?.tool_name || block?.name || 'Tool'),
    type: mapToolType(block?.tool_name || block?.name || 'tool'),
    status: 'running',
    result: buildToolDetail(block?.input),
    inputSummary: extractInputSummary(block?.input),
    statusText: '进行中',
  };
  toolSteps.push(step);
  return step;
}

function finalizeAssistant(message: MutableChatMessage | null) {
  if (!message) return;
  if (!message.toolSteps?.length) {
    message.toolSteps = undefined;
    message.toolsComplete = undefined;
  } else {
    message.toolsComplete = message.toolSteps.every((entry) => entry.status !== 'running' && entry.status !== 'pending');
  }
  if (!message.meta?.length) {
    message.meta = undefined;
  }
  if (typeof message.thinking === 'string') {
    const normalizedThinking = message.thinking.trim();
    message.thinking = normalizedThinking || undefined;
  }
  message._finalized = true;
}

export function buildChatMessages(history: AgentEvent[]): ChatMessage[] {
  const messages: MutableChatMessage[] = [];
  const toolOwners = new Map<string, MutableChatMessage>();
  let currentAssistant: MutableChatMessage | null = null;
  let turnIndex = -1;
  let assistantIndex = -1;

  const getCurrentAssistant = (timestamp: Date) => {
    if (currentAssistant && !currentAssistant._finalized) {
      if (timestamp.getTime() > currentAssistant.timestamp.getTime()) {
        currentAssistant.timestamp = timestamp;
      }
      return currentAssistant;
    }

    assistantIndex += 1;
    const assistant: MutableChatMessage = {
      id: `assistant-${assistantIndex}`,
      role: 'assistant',
      content: '',
      timestamp,
      toolSteps: [],
      toolsComplete: false,
      meta: [],
      streaming: false,
      images: [],
      files: [],
      _finalized: false,
    };
    messages.push(assistant);
    currentAssistant = assistant;
    return assistant;
  };

  for (let index = 0; index < history.length; index += 1) {
    const event = history[index];
    const timestamp = safeDate(event?.timestamp);

    if (event?.type === 'user' && typeof event?.prompt === 'string') {
      finalizeAssistant(currentAssistant);
      turnIndex += 1;
      messages.push({
        id: `user-${turnIndex}`,
        role: 'user',
        content: event.prompt,
        timestamp,
        images: event.images || [],
        files: event.files ? (event.files as string[]).filter((f: string) => !/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f)) : [],
      });
      currentAssistant = null;
      continue;
    }

    if (event?.type === 'user' && Array.isArray(event?.message?.content)) {
      const assistant = getCurrentAssistant(timestamp);
      const resultBlocks = event.message.content.filter((block: any) => block?.type === 'tool_result');
      if (resultBlocks.length > 0) {
        for (const block of resultBlocks) {
          const toolId = String(block.tool_use_id || '');
          const owner = (toolId && toolOwners.get(toolId)) || assistant;
          const step = ensureToolStep(owner, {
            id: toolId,
            tool_name: block.tool_name || 'Tool',
          });
          step.status = block.is_error ? 'error' : 'success';
          step.statusText = block.is_error ? '执行失败' : '执行完成';
          step.result = buildToolDetail(undefined, summarizeToolResultBlock(block));
        }
      }
      continue;
    }

    if (event?.type === 'app_plan_state' && event?.kind === 'create-app') {
      finalizeAssistant(currentAssistant);

      let content = '';
      if (event.state === 'awaiting_approval') {
        content = '创建 App 的计划已经生成，等待你确认后才会继续执行。';
      } else if (event.state === 'approved') {
        content = '已批准创建 App 计划，开始按计划生成应用。';
      } else if (event.state === 'rejected') {
        content = '已退回创建 App 计划，当前不会继续生成应用。';
      }

      if (content) {
        assistantIndex += 1;
        messages.push({
          id: `assistant-${assistantIndex}`,
          role: 'assistant',
          content,
          timestamp,
          meta: ['创建 App'],
        });
      }

      currentAssistant = null;
      continue;
    }

    if (event?.type === 'stream_event') {
      const assistant = getCurrentAssistant(timestamp);
      assistant.streaming = true;
      const streamEvent = event?.event;
      if (streamEvent?.type === 'content_block_start' && streamEvent.content_block?.type === 'tool_use') {
        const step = ensureToolStep(assistant, streamEvent.content_block);
        step.status = 'running';
        step.statusText = '进行中';
        step.result = buildToolDetail(streamEvent.content_block.input);
        toolOwners.set(step.id, assistant);
      } else if (streamEvent?.type === 'content_block_start' && streamEvent.content_block?.type === 'thinking') {
        appendThinking(assistant, summarizeThinkingBlock(streamEvent.content_block));
      } else if (streamEvent?.type === 'content_block_delta') {
        if (streamEvent.delta?.type === 'text_delta' && typeof streamEvent.delta.text === 'string') {
          assistant.content += streamEvent.delta.text;
        } else if (streamEvent.delta?.type === 'thinking_delta' && typeof streamEvent.delta.thinking === 'string') {
          appendThinking(assistant, streamEvent.delta.thinking);
        } else if (streamEvent.delta?.type === 'input_json_delta') {
          const toolSteps = ensureToolSteps(assistant);
          const step = toolSteps[toolSteps.length - 1];
          if (step) {
            step.result = `${step.result || 'Input'}${step.result ? '\n' : '\n'}${streamEvent.delta.partial_json}`;
          }
        }
      }
      continue;
    }

    if (event?.type === 'tool_progress') {
      const assistant = getCurrentAssistant(timestamp);
      const toolId = String(event?.parent_tool_use_id || event?.tool_use_id || '');
      const owner = (toolId && toolOwners.get(toolId)) || assistant;
      const step = ensureToolStep(owner, {
        id: toolId,
        tool_name: event?.tool_name || 'Tool',
      });
      step.status = 'running';
      step.statusText = typeof event?.elapsed_time_seconds === 'number'
        ? `运行 ${event.elapsed_time_seconds}s`
        : '进行中';
      if (typeof event?.elapsed_time_seconds === 'number') {
        step.duration = event.elapsed_time_seconds * 1000;
      }
      continue;
    }

    if (event?.type === 'system') {
      const assistant = getCurrentAssistant(timestamp);
      const content = normalizeText(event?.content);
      if (content) {
        addMeta(assistant, content);
      }
      continue;
    }

    if (event?.type === 'assistant') {
      const assistant = getCurrentAssistant(timestamp);
      assistant.streaming = false;
      assistant.content = '';
      assistant.thinking = '';
      assistant.toolSteps = assistant.toolSteps || [];
      assistant.meta = assistant.meta || [];
      assistant.images = [];
      assistant.files = [];
      assistant.toolsComplete = false;

      if (Array.isArray(event?.message?.content)) {
        for (const block of event.message.content) {
          if (!block || typeof block !== 'object') continue;
          if (block.type === 'text' && typeof block.text === 'string') {
            appendText(assistant, block.text);
          } else if (block.type === 'thinking' || block.type === 'redacted_thinking') {
            appendThinking(assistant, summarizeThinkingBlock(block));
          } else if (block.type === 'tool_use') {
            const step = ensureToolStep(assistant, block);
            step.status = 'running';
            step.statusText = '进行中';
            step.result = buildToolDetail(block.input);
            toolOwners.set(step.id, assistant);
          } else if (block.type === 'image' && typeof block.source === 'object') {
            const imgSrc = block.source?.data || block.source?.url || '';
            if (imgSrc) {
              if (!assistant.images) assistant.images = [];
              if (!assistant.images.includes(imgSrc)) assistant.images.push(imgSrc);
            }
          }
        }
      }
      if (event?.error?.message) {
        addMeta(assistant, `错误: ${String(event.error.message)}`);
      }
      continue;
    }

    if (event?.type === 'result') {
      const assistant = getCurrentAssistant(timestamp);
      if (typeof event.duration_ms === 'number') addMeta(assistant, `耗时 ${event.duration_ms}ms`);
      if (typeof event.total_cost_usd === 'number') addMeta(assistant, `费用 $${event.total_cost_usd.toFixed(4)}`);
      if (event.subtype && event.subtype !== 'success') addMeta(assistant, `状态 ${String(event.subtype)}`);
      if (assistant.toolSteps?.length) {
        for (const step of assistant.toolSteps) {
          if (step.status === 'running' || step.status === 'pending') {
            step.status = event.subtype === 'success' ? 'success' : 'error';
            if (!step.statusText || step.statusText === '进行中' || step.statusText.startsWith('运行 ')) {
              step.statusText = event.subtype === 'success' ? '执行完成' : '执行失败';
            }
          }
        }
      }
      // If no assistant content was built from event stream (common in coordinator
      // mode where the final text lives only in the result event), use it directly.
      const resultText = typeof event.result === 'string' ? event.result.trim() : '';
      if (resultText && !assistant.content.trim()) {
        assistant.content = resultText;
      }
      finalizeAssistant(assistant);
      continue;
    }

    if (event?.type === 'error') {
      const assistant = getCurrentAssistant(timestamp);
      assistant.streaming = false;
      appendText(assistant, String(event?.message || 'Unknown error'));
      addMeta(assistant, '执行失败');
      finalizeAssistant(assistant);
      continue;
    }
  }

  finalizeAssistant(currentAssistant);
  return messages;
}
