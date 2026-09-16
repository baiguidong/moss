import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AssistantMessage } from '../src/renderer-react/components/chat/assistant-message';
import { UserMessage } from '../src/renderer-react/components/chat/user-message';
import { PreviewDrawer } from '../src/renderer-react/components/preview-drawer';
import type { WorkspacePreviewData } from '../src/renderer-react/types';

const messageListSource = readFileSync(
  new URL('../src/renderer-react/components/chat/message-list.tsx', import.meta.url),
  'utf8',
);

test('chat messages use adjustable density variables without reserving an action row', () => {
  const userHtml = renderToStaticMarkup(
    <UserMessage message={{
      id: 'user-1',
      type: 'user_text',
      role: 'user',
      content: '你好',
    }} />,
  );
  const assistantHtml = renderToStaticMarkup(
    <AssistantMessage message={{
      id: 'assistant-1',
      type: 'assistant_text',
      role: 'assistant',
      content: '你好，我是 Moss。',
    }} />,
  );

  expect(userHtml).toContain('var(--chat-message-spacing, 10px)');
  expect(userHtml).toContain('var(--chat-font-size, 14px)');
  expect(userHtml).toContain('var(--chat-bubble-padding-y, 8px)');
  expect(userHtml).toContain('absolute top-0');
  expect(userHtml).not.toContain('mb-5');
  expect(assistantHtml).toContain('var(--chat-line-height, 1.55)');
  expect(assistantHtml).toContain('rounded-[20px]');
  expect(assistantHtml).toContain('rounded-tl-[8px]');
  expect(assistantHtml).toContain('px-4 py-3');
  expect(assistantHtml).not.toContain('leading-7');
});

test('chat history does not render message timestamps', () => {
  expect(messageListSource).not.toContain('TimeSeparator');
  expect(messageListSource).not.toContain('formatSeparatorTime');
});

test('preview header uses two compact rows and keeps long tab names scrollable', () => {
  const file: WorkspacePreviewData = {
    path: '/tmp/very-long-preview-file-name-that-must-remain-scrollable.jpeg',
    relativePath: 'very-long-preview-file-name-that-must-remain-scrollable.jpeg',
    content: '',
    contentType: 'image',
    mimeType: 'image/jpeg',
    size: 354_304,
    truncated: false,
  };
  const html = renderToStaticMarkup(
    <PreviewDrawer
      visible
      tabs={[file]}
      activePath={file.path}
      onActivate={() => {}}
      onUpdateTab={() => {}}
      onCloseTab={() => {}}
      onCloseOthers={() => {}}
      onCloseAll={() => {}}
      onCloseDrawer={() => {}}
      standalone
    />,
  );

  expect(html.match(/data-preview-header-row=/g)).toHaveLength(2);
  expect(html).toContain('aria-label="预览标签"');
  expect(html).toContain('very-long-preview-file-name-that-must-remain-scrollable.jpeg');
  expect(html).toContain('overflow-x-auto');
  expect(html).not.toContain('文件预览');
  expect(html).not.toContain('346 KB');
  expect(html).not.toContain('>Image<');
});
