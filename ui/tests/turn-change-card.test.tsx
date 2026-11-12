import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnChangeCard } from '../src/renderer-react/components/chat/turn-change-card';

test('unavailable and stale payloads do not render a change card', () => {
  for (const coverage of ['unavailable', undefined] as const) {
    const html = renderToStaticMarkup(<TurnChangeCard sessionId="session" rewindSupported initiallyExpanded change={{
      userMessageId: 'user', coverage, stats: { filesChanged: 1, additions: 4, deletions: 0 }, hasUnverifiedChanges: true,
      files: [{ filePath: '/workspace/old-write.txt', isNewFile: true, structuredPatch: [], additions: 4, deletions: 0 }],
    }} />);
    expect(html).toBe('');
  }
});

test('a confirmed unchanged turn renders no comparison, rewind button or observation note', () => {
  const html = renderToStaticMarkup(<TurnChangeCard sessionId="session" rewindSupported initiallyExpanded change={{
    userMessageId: 'greeting', observationId: 'read-only-turn', coverage: 'complete', files: [],
    stats: { filesChanged: 0, additions: 0, deletions: 0 }, hasUnverifiedChanges: false,
    observationNote: '统计本轮期间的文件变化，也可能包含外部程序修改',
  }} />);
  expect(html).toBe('');
});

test('zero known files with incomplete coverage does not render a change card', () => {
  for (const coverage of ['partial', 'unavailable'] as const) {
    const html = renderToStaticMarkup(<TurnChangeCard sessionId="session" rewindSupported={false} change={{
      userMessageId: 'user', coverage, files: [], stats: { filesChanged: 0, additions: 0, deletions: 0 },
      hasUnverifiedChanges: true, observationNote: '部分文件无法核实',
    }} />);
    expect(html).toBe('');
  }
});

test('a real file change with zero line counts still renders its comparison', () => {
  const html = renderToStaticMarkup(<TurnChangeCard sessionId="session" rewindSupported change={{
    userMessageId: 'user', coverage: 'complete', stats: { filesChanged: 1, additions: 0, deletions: 0 }, hasUnverifiedChanges: false,
    files: [{ filePath: '/workspace/image.png', isNewFile: true, binary: true, verified: true, status: 'added', structuredPatch: [], additions: 0, deletions: 0 }],
  }} />);
  expect(html).toContain('本轮改动 1 个文件');
});

test('complete and partial observations identify the extent of the confirmed total', () => {
  for (const coverage of ['complete', 'partial'] as const) {
    const files = [{ filePath: '/workspace/a.txt', isNewFile: true, structuredPatch: [], additions: 12, deletions: 0 }];
    const html = renderToStaticMarkup(<TurnChangeCard sessionId="session" rewindSupported change={{
      userMessageId: 'user', coverage, stats: { filesChanged: 1, additions: 12, deletions: 0 }, hasUnverifiedChanges: coverage !== 'complete', files,
    }} />);
    expect(html).toContain(coverage === 'complete' ? '本轮改动 1 个文件' : '已确认变化 1 个文件');
    expect(html).toContain('+12');
  }
});
