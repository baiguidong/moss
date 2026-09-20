import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { BrowserPanel } from '../src/renderer-react/components/browser-panel';
import { TaskPanel } from '../src/renderer-react/components/task-panel';

test('task panel keeps files and browser views without restoring removed tabs', () => {
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

test('task panel shows session tasks below the files tab', () => {
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
      sessionTasks={[
        {
          id: '1',
          subject: '实现任务展示',
          description: '',
          status: 'in_progress',
          activeForm: '正在实现任务展示',
          owner: 'moss',
          blockedBy: [],
        },
        {
          id: '2',
          subject: '补充测试',
          description: '',
          status: 'pending',
          blockedBy: ['1'],
        },
      ]}
    />,
  );

  expect(html).toContain('会话任务');
  expect(html).toContain('2 项');
  expect(html).toContain('正在实现任务展示');
  expect(html).toContain('实现任务展示');
  expect(html).toContain('@moss');
  expect(html).toContain('阻塞于 #1');
});

test('browser toolbar exposes a fullscreen command', () => {
  const html = renderToStaticMarkup(<BrowserPanel sessionId="test-session" />);
  expect(html).toContain('moss-no-drag');
  expect(html).toContain('aria-label="在系统浏览器中打开"');
  expect(html).toContain('aria-label="全屏"');
});
