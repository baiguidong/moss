import { expect, test } from 'bun:test';
import { buildMainChatRenderMessagesFromHistory } from '../src/renderer-react/lib/agent-transcript';
import { firstMessageTitle, historyWithPendingFirstMessage } from '../src/renderer-react/lib/pending-first-message';

test('shows a submitted first message with attachments until the Host receipt arrives', () => {
  const pending = {
    id: 'pending-1',
    sessionId: 'session-1',
    prompt: '整理这些证书',
    files: [{ name: '证书.pdf', path: '/tmp/证书.pdf' }],
    submittedAt: 1000,
  };
  const optimistic = buildMainChatRenderMessagesFromHistory(
    historyWithPendingFirstMessage([], pending, 'session-1'),
  );
  expect(optimistic).toHaveLength(1);
  expect(optimistic[0]).toMatchObject({ type: 'user_text', content: pending.prompt });
  expect(optimistic[0].type === 'user_text' && optimistic[0].attachments?.[0]?.path).toBe('/tmp/证书.pdf');

  const receipt = { type: 'user', uuid: 'host-1', prompt: pending.prompt, timestamp: 2000, files: ['/workspace/证书.pdf'] };
  const canonical = buildMainChatRenderMessagesFromHistory(
    historyWithPendingFirstMessage([receipt], pending, 'session-1'),
  );
  expect(canonical).toHaveLength(1);
  expect(canonical[0].type === 'user_text' && canonical[0].attachments?.[0]?.path).toBe('/workspace/证书.pdf');
  expect(historyWithPendingFirstMessage([], pending, 'another-session')).toEqual([]);
});

test('names the session from the first line immediately', () => {
  expect(firstMessageTitle('第一行\n第二行')).toBe('第一行');
  expect(firstMessageTitle('   ')).toBeUndefined();
  expect(firstMessageTitle('a'.repeat(37))).toBe(`${'a'.repeat(36)}...`);
});
