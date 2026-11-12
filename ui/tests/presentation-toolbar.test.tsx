import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PresentationToolbar } from '../src/renderer-react/components/presentation/presentation-panel';

const state = {
  visible: true,
  activeId: 'workspace',
  activeOrigin: 'manual',
  autoFollow: true,
  pinnedId: null,
  dirty: false,
  openedIds: [],
  back: [],
  turnId: null,
};

function snapshot(resources: any[] = []) {
  return { sessionId: 'session', epoch: 'epoch', version: 1, state, resources } as any;
}

test('keeps empty result and browser views available from the ellipsis menu', () => {
  const html = renderToStaticMarkup(<PresentationToolbar snapshot={snapshot()} action={() => {}} />);

  expect(html).toContain('aria-label="工作区"');
  expect(html).not.toContain('aria-label="结果"');
  expect(html).not.toContain('aria-label="浏览器"');
  expect(html).toContain('aria-label="更多右侧视图"');
});

test('promotes views with content into the main tab row', () => {
  const html = renderToStaticMarkup(<PresentationToolbar snapshot={snapshot([
    {
      id: 'report',
      kind: 'file',
      title: '报告',
      revision: '1',
      source: { type: 'file', path: '/tmp/report.md' },
      capabilities: { preview: true, edit: false, popout: false },
      isResult: true,
    },
    {
      id: 'browser-tab',
      kind: 'browser',
      title: '浏览器',
      revision: '1',
      source: { type: 'browser-tab', tabId: 'tab' },
      availability: 'ready',
      capabilities: { preview: true, edit: false, popout: false },
    },
  ])} action={() => {}} />);

  expect(html).toContain('aria-label="结果 1 项"');
  expect(html).toContain('aria-label="浏览器"');
  expect(html).not.toContain('aria-label="更多右侧视图"');
});
