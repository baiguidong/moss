import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TurnChangeCard } from '../src/renderer-react/components/chat/turn-change-card';

test('turn change card presents compact diff stats and a guarded rewind action', () => {
  const html = renderToStaticMarkup(
    <TurnChangeCard
      sessionId="session-1"
      rewindSupported
      change={{
        userMessageId: 'turn-1',
        files: [{
          filePath: '/repo/src/example.ts',
          isNewFile: false,
          additions: 3,
          deletions: 1,
          structuredPatch: [{
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 3,
            lines: ['-old', '+new', '+next', '+last'],
          }],
        }],
        stats: { filesChanged: 1, additions: 3, deletions: 1 },
        hasUnverifiedChanges: false,
      }}
    />,
  );

  expect(html).toContain('本轮改动 1 个文件');
  expect(html).toContain('+3');
  expect(html).toContain('-1');
  expect(html).toContain('撤销本轮');
  expect(html).toContain('撤销到这一轮开始之前');
});
