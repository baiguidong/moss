export type ToolStatus = 'pending' | 'running' | 'success' | 'error';

export type ToolStep = {
  id: string;
  name: string;
  type: 'exec' | 'search' | 'code' | 'api' | 'db' | 'other';
  status: ToolStatus;
  duration?: number;
  result?: string;
  inputSummary?: string;
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

  const getCurrentAssistant = (timestamp: Date) => {
    if (currentAssistant && !currentAssistant._finalized) {
      if (timestamp.getTime() > currentAssistant.timestamp.getTime()) {
        currentAssistant.timestamp = timestamp;
      }
      return currentAssistant;
    }

    const assistant: MutableChatMessage = {
      id: `assistant-turn-${Math.max(turnIndex, 0)}`,
      role: 'assistant',
      content: '',
      timestamp,
      toolSteps: [],
      toolsComplete: false,
      meta: [],
      streaming: false,
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
          step.result = buildToolDetail(undefined, summarizeToolResultBlock(block));
        }
      }
      continue;
    }

    if (event?.type === 'stream_event') {
      const assistant = getCurrentAssistant(timestamp);
      assistant.streaming = true;
      const streamEvent = event?.event;
      if (streamEvent?.type === 'content_block_start' && streamEvent.content_block?.type === 'tool_use') {
        const step = ensureToolStep(assistant, streamEvent.content_block);
        step.status = 'running';
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

    if (event?.type === 'assistant') {
      const assistant = getCurrentAssistant(timestamp);
      assistant.streaming = false;
      assistant.content = '';
      assistant.thinking = '';
      assistant.toolSteps = assistant.toolSteps || [];
      assistant.meta = assistant.meta || [];
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
            step.result = buildToolDetail(block.input);
            toolOwners.set(step.id, assistant);
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
          }
        }
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
