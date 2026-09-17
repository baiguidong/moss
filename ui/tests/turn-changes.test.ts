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

  test('does not reuse an existing UUID when a later visible prompt was transformed', () => {
    const visibleHistory = [
      { type: 'user', uuid: 'user-1', prompt: 'first' },
      { type: 'assistant', uuid: 'answer-1', message: { content: [] } },
      { type: 'user', prompt: 'second' },
    ];
    const transcriptHistory = [
      { type: 'user', uuid: 'user-1', message: { content: 'runtime first' } },
      { type: 'assistant', uuid: 'answer-1', message: { content: [] } },
      {
        type: 'user',
        uuid: 'user-2',
        message: { content: 'selected skill instructions\n\nsecond' },
      },
    ];

    const enriched = backfillVisibleUserMessageIds(visibleHistory, transcriptHistory);
    expect(enriched[0]?.uuid).toBe('user-1');
    expect(enriched[2]?.uuid).toBe('user-2');
  });

  test('shows the net file diff when edits within a turn cancel each other', () => {
    const editResult = (toolUseId: string, originalFile: string, lines: string[]) => [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Edit' }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
        toolUseResult: {
          filePath: '/repo/a.ts',
          originalFile,
          structuredPatch: [{
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines,
          }],
        },
      },
    ];
    const history = [
      { type: 'user', uuid: 'turn-1', message: { content: 'change and restore it' } },
      ...editResult('edit-1', 'a\n', ['-a', '+b']),
      ...editResult('edit-2', 'b\n', ['-b', '+a']),
    ];

    expect(collectTurnChanges(history)).toEqual([]);
  });

  test('keeps an empty newly-created file as a real turn change', () => {
    const turns = collectTurnChanges([
      { type: 'user', uuid: 'turn-1', message: { content: 'create it' } },
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'write-1', name: 'Write' }] },
      },
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'write-1' }] },
        toolUseResult: {
          type: 'create',
          filePath: '/repo/empty.txt',
          content: '',
          originalFile: null,
          structuredPatch: [],
        },
      },
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.stats).toEqual({ filesChanged: 1, additions: 0, deletions: 0 });
  });
});
