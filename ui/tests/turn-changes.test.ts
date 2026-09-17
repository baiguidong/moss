import { describe, expect, test } from 'bun:test';
import {
  backfillVisibleUserMessageIds,
  collectTurnChanges,
  truncateHistoryBeforeUserMessage,
} from '../src/shared/turn-changes.mjs';

describe('turn changes', () => {
  test('groups sequential edits by the user message that started the turn', () => {
    const history = [
      { type: 'user', uuid: 'turn-1', message: { content: 'change it' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Edit' }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1' }] },
        toolUseResult: {
          filePath: '/repo/a.ts',
          structuredPatch: [{
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 2,
            lines: ['-old', '+new', '+more'],
          }],
        },
      },
      { type: 'user', uuid: 'turn-2', message: { content: 'create it' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tool-2', name: 'Write' }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tool-2' }] },
        toolUseResult: { filePath: '/repo/b.ts', type: 'create', content: 'one\ntwo\n' },
      },
    ];

    expect(collectTurnChanges(history)).toEqual([
      {
        userMessageId: 'turn-1',
        files: [expect.objectContaining({
          filePath: '/repo/a.ts',
          additions: 2,
          deletions: 1,
        })],
        stats: { filesChanged: 1, additions: 2, deletions: 1 },
        hasUnverifiedChanges: false,
      },
      {
        userMessageId: 'turn-2',
        files: [expect.objectContaining({
          filePath: '/repo/b.ts',
          isNewFile: true,
          additions: 2,
          deletions: 0,
        })],
        stats: { filesChanged: 1, additions: 2, deletions: 0 },
        hasUnverifiedChanges: false,
      },
    ]);
  });

  test('marks bash turns as potentially incomplete and truncates at the selected turn', () => {
    const history = [
      { type: 'user', uuid: 'keep', message: { content: 'first' } },
      { type: 'assistant', uuid: 'answer-1', message: { content: [] } },
      { type: 'user', uuid: 'remove', message: { content: 'second' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'bash-1', name: 'Bash' }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'bash-1' }] },
        toolUseResult: {
          filePath: '/repo/a.ts',
          structuredPatch: [{
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: ['-a', '+b'],
          }],
        },
      },
    ];

    expect(collectTurnChanges(history)[0]?.hasUnverifiedChanges).toBe(true);
    expect(truncateHistoryBeforeUserMessage(history, 'remove')).toEqual(history.slice(0, 2));
    expect(truncateHistoryBeforeUserMessage(history, 'missing')).toBeNull();
  });

  test('backfills desktop-visible user events with transcript UUIDs', () => {
    const visibleHistory = [
      { type: 'user', prompt: 'first', timestamp: 1 },
      { type: 'assistant', uuid: 'answer-1', message: { content: [] } },
      { type: 'user', prompt: 'second', timestamp: 2 },
    ];
    const transcriptHistory = [
      { type: 'user', uuid: 'user-1', message: { content: 'first' } },
      { type: 'assistant', uuid: 'answer-1', message: { content: [] } },
      { type: 'user', uuid: 'user-2', message: { content: 'second' } },
    ];

    const enriched = backfillVisibleUserMessageIds(visibleHistory, transcriptHistory);
    expect(enriched[0]?.uuid).toBe('user-1');
    expect(enriched[2]?.uuid).toBe('user-2');
    expect(visibleHistory[0]?.uuid).toBeUndefined();
  });
});
