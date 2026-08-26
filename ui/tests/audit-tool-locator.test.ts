import { describe, expect, it } from 'bun:test';
import {
  buildRenderModel,
  findToolRenderItemIndex,
} from '@/components/chat/message-list';
import type { TranscriptRenderMessage } from '@/lib/agent-transcript';

function tool(
  id: string,
  toolName: string,
  parentToolUseId?: string,
): TranscriptRenderMessage {
  return {
    id: `message-${id}`,
    timestamp: new Date('2026-08-26T00:00:00.000Z'),
    type: 'tool_use',
    role: 'assistant',
    toolUseId: id,
    parentToolUseId,
    toolName,
    displayName: toolName,
    input: {},
    status: 'success',
  };
}

describe('audit tool locator', () => {
  it('finds the render item containing a top-level tool call', () => {
    const model = buildRenderModel([
      tool('read-1', 'Read'),
      { id: 'answer', timestamp: new Date(), type: 'assistant_text', role: 'assistant', content: 'done' },
    ]);

    expect(findToolRenderItemIndex(model.renderItems, model.childToolCallsByParent, 'read-1')).toBe(0);
  });

  it('locates a nested tool call through its parent tool group', () => {
    const model = buildRenderModel([
      tool('agent-1', 'Agent'),
      tool('edit-1', 'Edit', 'agent-1'),
    ]);

    expect(findToolRenderItemIndex(model.renderItems, model.childToolCallsByParent, 'edit-1')).toBe(0);
    expect(findToolRenderItemIndex(model.renderItems, model.childToolCallsByParent, 'missing')).toBe(-1);
  });
});
