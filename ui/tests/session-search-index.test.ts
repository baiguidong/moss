import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

import {
  createSessionSearchIndex,
  extractSearchableSessionMessages,
} from '../src/session-search-index.mjs';

const indexUrl = new URL('../src/session-search-index.mjs', import.meta.url).href;

function runNodeScenario(source: string) {
  const script = `
    import { DatabaseSync } from 'node:sqlite';
    import { createSessionSearchIndex } from ${JSON.stringify(indexUrl)};
    const db = new DatabaseSync(':memory:');
    const index = createSessionSearchIndex(db);
    try { ${source} } finally { db.close(); }
  `;
  const result = spawnSync('node', ['--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe('session search index', () => {
  it('extracts visible user and assistant text with stable source ids', () => {
    expect(extractSearchableSessionMessages([
      { type: 'user', uuid: 'u1', message: { content: '查找中文消息' }, timestamp: 1 },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: '找到答案' }] }, timestamp: 2 },
      { type: 'user', uuid: 'tool-result', parent_tool_use_id: 'tool-1', message: { content: 'secret output' } },
      { type: 'user', uuid: 'synthetic', isSynthetic: true, message: { content: 'hidden prompt' } },
    ])).toEqual([
      { messageId: 'u1', role: 'user', body: '查找中文消息', timestamp: 1 },
      { messageId: 'a1', role: 'assistant', body: '找到答案', timestamp: 2 },
    ]);
  });

  it('searches Chinese message text and restricts results to visible sessions', () => {
    const result = runNodeScenario(`
      index.syncSession({
        id: 'visible', title: '普通标题', updatedAt: 10,
        history: [{ type: 'user', uuid: 'u1', prompt: '跨会话全文搜索', timestamp: 11 }],
      });
      index.syncSession({
        id: 'hidden', title: '隐藏会话', updatedAt: 20,
        history: [{ type: 'assistant', uuid: 'a2', message: { content: '跨会话全文搜索' }, timestamp: 21 }],
      });
      console.log(JSON.stringify(index.search('会话全文', { sessionIds: ['visible'] })));
    `);
    expect(result).toEqual([
      expect.objectContaining({ sessionId: 'visible', messageId: 'u1', role: 'user' }),
    ]);
  });

  it('updates and deletes a session without leaving stale matches', () => {
    const result = runNodeScenario(`
      index.syncSession({ id: 's1', title: '旧标题', updatedAt: 1, history: [] });
      const before = index.search('旧标题', { sessionIds: ['s1'] }).length;
      index.syncSession({ id: 's1', title: '新标题', updatedAt: 2, history: [] });
      const stale = index.search('旧标题', { sessionIds: ['s1'] }).length;
      index.deleteSession('s1');
      const deleted = index.search('新标题', { sessionIds: ['s1'] }).length;
      console.log(JSON.stringify({ before, stale, deleted }));
    `);
    expect(result).toEqual({ before: 1, stale: 0, deleted: 0 });
  });
});
