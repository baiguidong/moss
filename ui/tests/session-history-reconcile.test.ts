import { describe, expect, it } from 'bun:test';
import {
  mergeInterruptedSessionHistory,
  shouldAdoptSessionHistory,
} from '../src/shared/session-history-reconcile.mjs';

const user = (text: string) => ({ type: 'user', prompt: text });
const assistant = (text: string, uuid?: string) => ({
  type: 'assistant',
  ...(uuid ? { uuid } : {}),
  message: { content: [{ type: 'text', text }] },
});

describe('session history reconciliation', () => {
  it('accepts source history when no canonical history exists', () => {
    expect(shouldAdoptSessionHistory([], [user('hello'), assistant('hi')])).toBe(true);
  });

  it('accepts an append-only extension of the current history', () => {
    const current = [user('first'), assistant('done', 'answer-1')];
    const candidate = [...current, user('second'), assistant('done again', 'answer-2')];
    expect(shouldAdoptSessionHistory(current, candidate)).toBe(true);
  });

  it('rejects a shorter transcript that would remove existing messages', () => {
    const current = [
      user('original question'),
      assistant('original answer', 'answer-1'),
      user('scheduled check'),
      assistant('finished', 'answer-2'),
    ];
    const candidate = [user('scheduled check'), assistant('finished', 'answer-2')];
    expect(shouldAdoptSessionHistory(current, candidate)).toBe(false);
  });

  it('rejects same-length history with changed content', () => {
    const current = [user('keep this'), assistant('stable')];
    const candidate = [user('different'), assistant('stable')];
    expect(shouldAdoptSessionHistory(current, candidate)).toBe(false);
  });

  it('merges an interrupted transcript after the latest persisted user prompt', () => {
    const current = [
      user('publish this'),
      user('publish this'),
      user('publish this'),
    ];
    const candidate = [
      {
        type: 'user',
        uuid: 'runtime-user-1',
        message: { content: 'publish this' },
      },
      assistant('starting upload', 'answer-1'),
      {
        type: 'assistant',
        uuid: 'tool-1',
        message: { content: [{ type: 'tool_use', name: 'Write' }] },
      },
    ];

    expect(mergeInterruptedSessionHistory(current, candidate)).toEqual([
      ...current,
      candidate[1],
      candidate[2],
    ]);
  });

  it('keeps persisted history when an orphan transcript belongs to another prompt', () => {
    const current = [user('keep this')];
    const candidate = [user('different'), assistant('unrelated')];

    expect(mergeInterruptedSessionHistory(current, candidate)).toEqual(current);
  });
});
