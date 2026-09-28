import { describe, expect, it } from 'bun:test';
import { buildMainChatRenderMessagesFromHistory as render } from '@/lib/agent-transcript';

const user = (uuid: string) => ({ type: 'user', uuid, prompt: '继续' });
const stream = (event: Record<string, unknown>) => ({ type: 'stream_event', event });
const startMessage = () => stream({ type: 'message_start' });
const startBlock = (index: number, type: 'thinking' | 'text') => stream({
  type: 'content_block_start', index,
  content_block: type === 'text' ? { type, text: '' } : { type, thinking: '' },
});
const delta = (index: number, type: 'thinking' | 'text', value: string) => stream({
  type: 'content_block_delta', index,
  delta: type === 'text' ? { type: 'text_delta', text: value } : { type: 'thinking_delta', thinking: value },
});
const complete = (type: 'thinking' | 'text', value: string) => ({
  type: 'assistant',
  message: { content: [type === 'text' ? { type, text: value } : { type, thinking: value }] },
});
const stopBlock = (index: number) => stream({ type: 'content_block_stop', index });
const result = () => ({ type: 'result', subtype: 'success' });

describe('live transcript streaming', () => {
  it('shows each thinking and reply chunk before completion, preserving spaces and newlines', () => {
    const history = [user('turn-1'), startMessage(), startBlock(0, 'thinking')];
    let thinking = '';
    for (const chunk of ['我', '先分析', '\n', 'the', ' ', 'request']) {
      history.push(delta(0, 'thinking', chunk));
      thinking += chunk;
      expect(render(history).filter(item => item.type === 'thinking')).toEqual([
        expect.objectContaining({ content: thinking, streaming: true, turnId: 'turn-1' }),
      ]);
    }
    // The runtime emits the completed block before its content_block_stop event.
    history.push(complete('thinking', thinking), stopBlock(0), startBlock(1, 'text'));
    let reply = '';
    for (const chunk of ['你', '好', '\n\n', '接下来']) {
      history.push(delta(1, 'text', chunk));
      reply += chunk;
      expect(render(history).filter(item => item.type === 'assistant_text')).toEqual([
        expect.objectContaining({ content: reply, streaming: true, turnId: 'turn-1' }),
      ]);
    }
    expect(render(history).find(item => item.type === 'thinking')).toMatchObject({ streaming: false });
    const liveId = render(history).find(item => item.type === 'assistant_text')!.id;
    history.push(complete('text', reply), stopBlock(1), result());
    expect(render(history).filter(item => item.type === 'assistant_text')).toEqual([
      expect.objectContaining({ id: liveId, content: reply, streaming: false }),
    ]);
    expect(render(history).filter(item => item.type === 'thinking')).toHaveLength(1);
  });

  it('keeps the streamed reply after a tool result without duplicating it on completion', () => {
    const history = [
      user('turn-tool'),
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: {} }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'contents' }] } },
      startMessage(), startBlock(0, 'text'), delta(0, 'text', '已读取'),
    ];
    const liveId = render(history).find(item => item.type === 'assistant_text')!.id;
    history.push(complete('text', '已读取'), stopBlock(0), result());
    expect(render(history).filter(item => item.type === 'assistant_text')).toEqual([
      expect.objectContaining({ id: liveId, content: '已读取', streaming: false, turnId: 'turn-tool' }),
    ]);
    expect(render(history).find(item => item.type === 'tool_use')).toMatchObject({ status: 'success' });
  });

  it('preserves earlier text blocks when another block streams in the same response', () => {
    const history = [
      user('turn-blocks'), startMessage(),
      startBlock(0, 'text'), delta(0, 'text', '第一段'), complete('text', '第一段'), stopBlock(0),
      startBlock(1, 'text'), delta(1, 'text', '第二段'),
    ];
    expect(render(history).filter(item => item.type === 'assistant_text').map(item => item.content))
      .toEqual(['第一段', '第二段']);
    history.push(complete('text', '第二段'), stopBlock(1), result());
    expect(render(history).filter(item => item.type === 'assistant_text').map(item => item.content))
      .toEqual(['第一段', '第二段']);
  });

  it('streams every user turn and retains interrupted partial output', () => {
    const history = [
      user('turn-1'), startMessage(), startBlock(0, 'text'), delta(0, 'text', '第一轮'),
      complete('text', '第一轮'), stopBlock(0), result(),
      user('turn-2'), startMessage(), startBlock(0, 'text'), delta(0, 'text', '第二'),
    ];
    expect(render(history).filter(item => item.type === 'assistant_text')).toEqual([
      expect.objectContaining({ content: '第一轮', streaming: false, turnId: 'turn-1' }),
      expect.objectContaining({ content: '第二', streaming: true, turnId: 'turn-2' }),
    ]);
    history.push({ type: 'result', subtype: 'error_during_execution', is_error: true });
    expect(render(history).filter(item => item.type === 'assistant_text')).toEqual([
      expect.objectContaining({ content: '第一轮', streaming: false }),
      expect.objectContaining({ content: '第二', streaming: false }),
    ]);
  });
});
