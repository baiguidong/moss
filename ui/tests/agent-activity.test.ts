import { describe, expect, it } from 'bun:test';
import { deriveAgentActivity } from '../src/renderer-react/lib/agent-activity';
import type { TranscriptRenderMessage } from '../src/renderer-react/lib/agent-transcript';

const timestamp = new Date('2026-10-27T00:00:00.000Z');

function user(id = 'turn-1'): TranscriptRenderMessage {
  return { id, timestamp, type: 'user_text', role: 'user', content: '继续' };
}

function tool(id: string, name: string, status: 'pending' | 'running' | 'success' = 'running'): TranscriptRenderMessage {
  return {
    id,
    timestamp,
    type: 'tool_use',
    role: 'assistant',
    toolUseId: id,
    toolName: name,
    displayName: name,
    status,
  };
}

describe('agent activity state', () => {
  it('returns the model phase instead of a generic working label', () => {
    expect(deriveAgentActivity([user(), {
      id: 'thinking', timestamp, type: 'thinking', role: 'assistant', content: '', streaming: true,
    }], true)).toMatchObject({ kind: 'thinking', label: '正在思考' });

    expect(deriveAgentActivity([user(), tool('read-1', 'Read')], true)).toEqual({
      kind: 'tool', label: '正在执行 Read',
    });
    expect(deriveAgentActivity([user(), tool('read-1', 'Read'), tool('glob-1', 'Glob')], true)).toEqual({
      kind: 'tool', label: '正在并行执行 2 个工具',
    });

    expect(deriveAgentActivity([user(), {
      id: 'reply', timestamp, type: 'assistant_text', role: 'assistant', content: '正在写', streaming: true,
    }], true)).toEqual({ kind: 'responding', label: '正在输出回复' });
  });

  it('keeps the newer response phase ahead of a stale running tool', () => {
    expect(deriveAgentActivity([
      user(),
      tool('read-1', 'Read'),
      { id: 'result', timestamp, type: 'tool_result', role: 'assistant', toolUseId: 'read-1', toolName: 'Read', content: 'ok' },
      { id: 'thinking', timestamp, type: 'thinking', role: 'assistant', content: '', streaming: true },
    ], true)).toMatchObject({ kind: 'thinking' });
  });

  it('reports invisible request gaps and waiting states', () => {
    expect(deriveAgentActivity([user(), {
      id: 'result', timestamp, type: 'tool_result', role: 'assistant', toolUseId: 'read-1', toolName: 'Read', content: 'ok',
    }], true)).toEqual({ kind: 'requesting', label: '正在请求模型' });

    expect(deriveAgentActivity([user()], true, {
      questionRequest: { requestId: 'q', sessionId: 's', requestedAt: 1, input: { questions: [] } },
    })).toEqual({ kind: 'waiting', label: '等待你的回答' });
    expect(deriveAgentActivity([user()], true, {
      toolPermissionRequest: { requestId: 'p', sessionId: 's', requestedAt: 1, input: { metadata: { toolName: 'Bash' } } },
    })).toEqual({ kind: 'waiting', label: '等待确认：Bash' });
    expect(deriveAgentActivity([user()], false, {
      questionRequest: { requestId: 'q-idle', sessionId: 's', requestedAt: 1, input: { questions: [] } },
    })).toEqual({ kind: 'waiting', label: '等待你的回答' });
  });

  it('recognizes compaction and stops when the turn is idle', () => {
    expect(deriveAgentActivity([user(), {
      id: 'compact', timestamp, type: 'system', role: 'system', content: '已自动压缩上下文', variant: 'compact',
    }], true)).toEqual({ kind: 'compacting', label: '正在压缩上下文' });
    expect(deriveAgentActivity([user()], false)).toBeNull();
  });

  it('keeps plan approval visible after the turn becomes idle', () => {
    expect(deriveAgentActivity([user()], false, { pendingPlanApproval: true })).toEqual({
      kind: 'waiting',
      label: '等待批准执行计划',
    });
  });
});
