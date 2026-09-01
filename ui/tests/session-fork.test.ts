import { describe, expect, it } from 'bun:test';
import {
  cloneSessionTranscriptJsonl,
  getUniqueForkTitle,
} from '../src/shared/session-fork.mjs';

describe('desktop session fork', () => {
  it('creates a collision-free title', () => {
    expect(getUniqueForkTitle('Research', [
      'Research (Fork)',
      'Research (Fork 2)',
    ])).toBe('Research (Fork 3)');
  });

  it('copies only main-thread resumable transcript state', () => {
    const raw = [
      { type: 'mode', sessionId: 'source', mode: 'normal' },
      { type: 'user', uuid: 'u1', sessionId: 'source', slug: 'shared-plan', isSidechain: false, message: { content: 'hello' } },
      { type: 'assistant', uuid: 'a1', sessionId: 'source', isSidechain: false, message: { content: [] } },
      { type: 'assistant', uuid: 'worker', sessionId: 'source', isSidechain: true, agentId: 'agent-1', message: { content: [] } },
      { type: 'content-replacement', sessionId: 'source', replacements: [{ toolUseId: 'tool-1' }] },
      { type: 'content-replacement', sessionId: 'source', agentId: 'agent-1', replacements: [] },
      { type: 'worktree-state', sessionId: 'source', worktreeSession: { sessionId: 'source' } },
      { type: 'custom-title', sessionId: 'source', customTitle: 'Old title' },
    ].map(entry => JSON.stringify(entry)).join('\n');

    const result = cloneSessionTranscriptJsonl(raw, {
      sourceSessionId: 'source',
      targetSessionId: 'target',
      title: 'Research (Fork)',
    });
    const entries = result.trim().split('\n').map(line => JSON.parse(line));

    expect(entries.map(entry => entry.type)).toEqual([
      'mode',
      'user',
      'assistant',
      'content-replacement',
      'custom-title',
    ]);
    expect(entries.every(entry => entry.sessionId === 'target')).toBe(true);
    expect(entries[1].forkedFrom).toEqual({ sessionId: 'source', messageUuid: 'u1' });
    expect(entries[1].slug).toBeUndefined();
    expect(entries.at(-1)?.customTitle).toBe('Research (Fork)');
  });
});
