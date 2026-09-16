import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BrowserPanel } from '../src/renderer-react/components/browser-panel';
import { TaskPanel } from '../src/renderer-react/components/task-panel';

test('task panel only exposes files and browser views', () => {
  const html = renderToStaticMarkup(
    <TaskPanel
      collapsed={false}
      searchQuery=""
      onSearchChange={() => {}}
      onRefresh={() => {}}
      onOpenWorkspace={() => {}}
      treeItems={[]}
      expandedPaths={new Set()}
      selectedFilePath={null}
      onFocusFile={() => {}}
      onToggleFolder={() => {}}
      onSelectFile={() => {}}
    />,
  );

  expect(html).toContain('文件');
  expect(html).toContain('浏览器');
  expect(html).not.toContain('概览');
  expect(html).not.toContain('变更');
  expect(html).not.toContain('预览');
  expect(html).not.toContain('保存到资料库');
});

test('browser toolbar exposes a fullscreen command', () => {
  const html = renderToStaticMarkup(<BrowserPanel sessionId="test-session" />);
  expect(html).toContain('moss-no-drag');
  expect(html).toContain('aria-label="在系统浏览器中打开"');
  expect(html).toContain('aria-label="全屏"');
});
