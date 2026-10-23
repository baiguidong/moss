import { expect, test } from 'bun:test';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { getSearchMessageId, extractSearchableSessionMessages } from '../src/shared/session-search-messages.mjs';
import { getSearchMessageId as indexMessageId, extractSearchableSessionMessages as indexMessages } from '../src/session-search-index.mjs';

test('renderer transcript bundles for browsers without importing Node-only session indexing', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../src/renderer-react/lib/agent-transcript.ts', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'esm',
    logLevel: 'silent',
  });
  expect(result.errors).toHaveLength(0);
  expect(result.outputFiles[0].text).not.toContain('node:crypto');
  expect(result.outputFiles[0].text).not.toContain('createSessionSearchIndex');
});

test('shared extraction preserves backend exports and stable transcript source IDs', () => {
  expect(indexMessageId).toBe(getSearchMessageId);
  expect(indexMessages).toBe(extractSearchableSessionMessages);
  expect(getSearchMessageId({ type: 'user', uuid: ' u1 ' })).toBe('u1');
  expect(getSearchMessageId({ type: 'assistant', id: ' a1 ' })).toBe('id:a1');
  const event = { type: 'user', prompt: '查找中文消息🙂', timestamp: '2026-10-22T00:00:00.000Z' };
  expect(getSearchMessageId({ ...event })).toBe(getSearchMessageId(event));
  expect(getSearchMessageId({ ...event, timestamp: new Date(event.timestamp) })).toBe(getSearchMessageId(event));
  expect(extractSearchableSessionMessages([event])[0].messageId).toBe(getSearchMessageId(event));
});
