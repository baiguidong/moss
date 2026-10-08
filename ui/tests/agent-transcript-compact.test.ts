import { describe, expect, it } from 'bun:test';
import { buildMainChatRenderMessagesFromHistory as render } from '@/lib/agent-transcript';
import { buildRenderModel } from '@/components/chat/message-list';

const assistant = (text: string) => ({
  type: 'assistant', message: { content: [{ type: 'text', text }] },
});

describe('compact transcript markers', () => {
  it.each([
    { compactMetadata: { trigger: 'auto', preTokens: 185837 }, content: 'Conversation compacted' },
    { compact_metadata: { trigger: 'auto', pre_tokens: 185837 } },
  ])('shows persisted and SDK boundaries independently of assistant metadata: %j', (event) => {
    const messages = render([
      { type: 'user', uuid: 'turn-1', prompt: '继续处理' },
      assistant('压缩前的回复'),
      { type: 'system', subtype: 'compact_boundary', timestamp: '2026-10-01T07:32:04.614Z', ...event },
      assistant('压缩后的回复'),
      { type: 'result', subtype: 'success' },
    ]);
    expect(messages.map(message => message.type)).toEqual([
      'user_text', 'assistant_text', 'system', 'assistant_text',
    ]);
    expect(messages[2]).toMatchObject({
      type: 'system', variant: 'compact',
      content: '已自动压缩上下文（压缩前约 185,837 tokens）',
      timestamp: new Date('2026-10-01T07:32:04.614Z'),
    });
    expect(messages[1]).toMatchObject({ content: '压缩前的回复', streaming: false });
    expect(messages[3]).toMatchObject({ content: '压缩后的回复', streaming: false });
    expect(buildRenderModel(messages).renderItems).toContainEqual({ kind: 'message', message: messages[2] });
  });

  it('keeps the marker visible between tool groups within a turn', () => {
    const tool = (id: string) => ({ type: 'assistant', message: { content: [
      { type: 'tool_use', id, name: 'Read', input: { file_path: '/tmp/example' } },
    ] } });
    const messages = render([
      { type: 'user', uuid: 'turn-tools', prompt: '继续读取' },
      tool('read-before'),
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-before', content: 'done' }] } },
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 185837 } },
      tool('read-after'),
    ]);
    const { renderItems } = buildRenderModel(messages);
    expect(renderItems.map(item => item.kind)).toEqual(['message', 'tool_group', 'message', 'tool_group']);
    expect(renderItems[2]).toMatchObject({ kind: 'message', message: { type: 'system', variant: 'compact' } });
    expect(messages.find(message => message.type === 'tool_use' && message.toolUseId === 'read-after'))
      .toMatchObject({ status: 'running', turnId: 'turn-tools' });
  });

  it('labels manual compaction and tolerates missing counts', () => {
    expect(render([{ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'manual' } }]))
      .toEqual([expect.objectContaining({ type: 'system', variant: 'compact', content: '已手动压缩上下文' })]);
    expect(render([{ type: 'system', subtype: 'compact_boundary' }]))
      .toEqual([expect.objectContaining({ content: '已压缩上下文' })]);
  });
});
