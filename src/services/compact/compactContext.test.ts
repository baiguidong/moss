import { expect, test } from 'bun:test';
import { buildPostCompactMessages } from './compact';
import { getPostCompactBoundaryId } from './compactContext';
import { fromSDKCompactMetadata, toSDKCompactMetadata } from '../../utils/messages/mappers';
import { createCompactBoundaryMessage, createUserMessage, createAssistantMessage } from '../../utils/messages';

test('all compaction paths preserve the snapshot and SDK round trip without changing model messages', () => {
  const summary = createUserMessage({ content: 'exact summary', isCompactSummary: true });
  const kept = createAssistantMessage({ content: 'retained reply' });
  const result = { boundaryMarker: createCompactBoundaryMessage('manual', 123), summaryMessages: [summary],
    messagesToKeep: [kept], attachments: [], hookResults: [] } as any;
  const messages = buildPostCompactMessages(result);
  const metadata = (messages[0] as any).compactMetadata;
  expect(getPostCompactBoundaryId(messages)).toBe(result.boundaryMarker.uuid);
  expect(getPostCompactBoundaryId([...messages, createAssistantMessage({ content: 'new reply' })])).toBe('');
  expect(getPostCompactBoundaryId([createCompactBoundaryMessage('manual', 123)])).toBe('');
  expect(metadata.context.entries.map((entry: any) => entry.kind)).toEqual(['summary', 'preserved']);
  expect(metadata.context.entries[0].content).toBe('exact summary');
  expect(messages.slice(1)).toEqual([summary, kept]);
  const wire = toSDKCompactMetadata(metadata);
  expect(fromSDKCompactMetadata(wire)).toEqual(metadata);
  summary.message.content = 'later mutation';
  expect(metadata.context.entries[0].content).toBe('exact summary');
  expect(JSON.parse(JSON.stringify(messages[0])).compactMetadata.context).toEqual(metadata.context);
});
