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
const startTool = (index: number, id: string) => stream({
  type: 'content_block_start', index,
  content_block: { type: 'tool_use', id, name: 'Read', input: {} },
});
const completeTool = (id: string, input: Record<string, unknown>) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id, name: 'Read', input }] },
});
const toolResult = (id: string, isError = false) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: isError ? 'Invalid pages' : 'contents', is_error: isError }] },
});

describe('live transcript streaming', () => {
  it('retains the recorded owner for each call during streaming and after history reload', () => {
    const source = { kind: 'app', appId: 'moss.visualize', appName: '可视化', contributionId: 'moss.visualize/visualize_create' };
    const block = { type: 'tool_use', id: 'visualize-1', name: 'visualize_create', input: {} };
    const live = { ...stream({ type: 'content_block_start', index: 0, content_block: block }), tool_sources: { 'visualize-1': source } };
    const saved = { type: 'assistant', message: { content: [block] }, tool_sources: { 'visualize-1': source } };
    for (const history of [[user('sources'), live], [user('sources'), live, saved], JSON.parse(JSON.stringify([user('sources'), saved, toolResult('visualize-1')]))]) {
      const calls = render(history).filter(item => item.type === 'tool_use');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ toolName: 'visualize_create', source });
    }
    const spoofed = { type: 'assistant', message: { content: [{ ...block, input: { tool_sources: { 'visualize-1': source } } }] } };
    expect(render([user('sources'), spoofed]).find(item => item.type === 'tool_use')?.source).toBeUndefined();
  });
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

  it('merges streamed sibling calls when a result arrives before the next completed block', () => {
    const firstInput = { file_path: '/repo/a.md', pages: '' };
    const secondInput = { file_path: '/repo/b.md', pages: '' };
    const history = [
      user('turn-parallel'), startMessage(), startTool(0, 'read-1'), startTool(1, 'read-2'),
      completeTool('read-1', firstInput), stopBlock(0), toolResult('read-1', true),
    ];
    const liveTools = render(history).filter(item => item.type === 'tool_use');
    expect(liveTools).toHaveLength(2);
    expect(liveTools[1]).toMatchObject({ toolUseId: 'read-2', status: 'running' });

    history.push(
      stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(secondInput) } }),
      completeTool('read-2', secondInput), stopBlock(1),
    );
    const completedTools = render(history).filter(item => item.type === 'tool_use');
    expect(completedTools).toEqual([
      expect.objectContaining({ id: liveTools[0]!.id, toolUseId: 'read-1', input: firstInput, status: 'error' }),
      expect.objectContaining({ id: liveTools[1]!.id, toolUseId: 'read-2', input: secondInput, status: 'running' }),
    ]);

    history.push(
      toolResult('read-2', true), startMessage(), startTool(0, 'retry-1'), startTool(1, 'retry-2'),
      completeTool('retry-1', { ...firstInput, pages: '1' }), stopBlock(0),
      completeTool('retry-2', { ...secondInput, pages: '1' }), stopBlock(1),
      toolResult('retry-2'), toolResult('retry-1'), startMessage(),
      startBlock(0, 'text'), delta(0, 'text', '你好'), complete('text', '你好'), stopBlock(0), result(),
    );
    const tools = render(history).filter(item => item.type === 'tool_use');
    expect(tools.map(item => item.toolUseId)).toEqual(['read-1', 'read-2', 'retry-1', 'retry-2']);
    expect(tools.map(item => item.status)).toEqual(['error', 'error', 'success', 'success']);
    expect(tools.map(item => item.input)).toEqual([
      firstInput, secondInput, { ...firstInput, pages: '1' }, { ...secondInput, pages: '1' },
    ]);
    expect(render(history).filter(item => item.type === 'assistant_text')).toEqual([
      expect.objectContaining({ content: '你好', streaming: false, turnId: 'turn-parallel' }),
    ]);
  });

  it('reconciles sibling tools in completed snapshots that also contain assistant text', () => {
    const secondTool = completeTool('read-2', { file_path: '/repo/b.md' });
    const messages = render([
      user('turn-snapshot'), startMessage(), startTool(0, 'read-1'), startTool(1, 'read-2'),
      completeTool('read-1', { file_path: '/repo/a.md' }), toolResult('read-1', true),
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking the other file' }, ...secondTool.message.content] } },
      toolResult('read-2'), result(),
    ]);
    expect(messages.filter(item => item.type === 'tool_use').map(item => item.toolUseId)).toEqual(['read-1', 'read-2']);
    expect(messages.filter(item => item.type === 'tool_use').map(item => item.status)).toEqual(['error', 'success']);
    expect(messages.filter(item => item.type === 'assistant_text')).toEqual([
      expect.objectContaining({ content: 'Checking the other file', streaming: false }),
    ]);
  });

  it.each([true, false])('keeps the terminal tool status when its completed block arrives after a result (error: %s)', (isError) => {
    const input = { file_path: '/repo/a.md' };
    const history = [
      user('turn-delayed'), startMessage(), startTool(0, 'read-1'), toolResult('read-1', isError),
    ];
    const tool = render(history).find(item => item.type === 'tool_use')!;
    history.push(completeTool('read-1', input), stopBlock(0), result());
    expect(render(history).filter(item => item.type === 'tool_use')).toEqual([
      expect.objectContaining({ id: tool.id, toolUseId: 'read-1', input, status: isError ? 'error' : 'success', duration: tool.duration }),
    ]);
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
