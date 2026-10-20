import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AssistantMessage } from '../src/renderer-react/components/chat/assistant-message';
import { AssistantOutputFileCard } from '../src/renderer-react/components/chat/assistant-output-file-card';
import { UserMessage } from '../src/renderer-react/components/chat/user-message';
import { UserAvatarContext } from '../src/renderer-react/components/user-avatar';
import { PreviewDrawer } from '../src/renderer-react/components/preview-drawer';
import type { WorkspacePreviewData } from '../src/renderer-react/types';

const messageListSource = readFileSync(
  new URL('../src/renderer-react/components/chat/message-list.tsx', import.meta.url),
  'utf8',
);

test('chat messages use aligned avatars and keep actions below Moss replies', () => {
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
  expect(userHtml).not.toContain('src="./build/icon.png"');
  expect(userHtml).toContain('aria-label="默认用户头像"');
  expect(userHtml).toContain('h-7 w-7 shrink-0 self-start');
  expect(userHtml).not.toContain('复制消息');
  expect(userHtml).not.toContain('mb-5');
  expect(assistantHtml).toContain('var(--chat-line-height, 1.55)');
  expect(assistantHtml).toContain('data-message-body="assistant"');
  expect(assistantHtml).not.toContain('rounded-tl-[8px]');
  expect(assistantHtml).not.toContain('max-w-[72%]');
  expect(assistantHtml).toContain('h-7 w-7 shrink-0 self-start rounded-sm object-contain');
  expect(assistantHtml).toContain('复制回复');
  expect(assistantHtml).toContain('assistant-message-actions');
  expect(assistantHtml).not.toContain('absolute top-0');
  expect(assistantHtml).not.toContain('leading-7');
});

test('user messages display the configured avatar', () => {
  const avatar = 'data:image/png;base64,aGVsbG8=';
  const markup = renderToStaticMarkup(
    <UserAvatarContext.Provider value={avatar}>
      <UserMessage message={{ id: 'user', type: 'user_text', role: 'user', content: '你好' }} />
    </UserAvatarContext.Provider>,
  );
  expect(markup).toContain(`src="${avatar}"`);
  expect(markup).not.toContain('默认用户头像');
  expect(markup).not.toContain('./build/icon.png');
});

test('user file attachments render as Moss cards across file formats', () => {
  const html = renderToStaticMarkup(
    <UserMessage message={{
      id: 'user-files', type: 'user_text', role: 'user', content: '整理这些资料',
      attachments: [
        { kind: 'file', path: '/tmp/ISO 9001证书.pdf' },
        { kind: 'file', path: '/tmp/资质汇总.csv' },
        { kind: 'file', path: '/tmp/原始附件.xyz' },
      ],
    }} />,
  );
  expect(html.match(/data-file-attachment=/g)).toHaveLength(3);
  expect(html).toContain('>PDF</span>');
  expect(html.match(/data-pdf-icon="true"/g)).toHaveLength(1);
  expect(html).toContain('>CSV</span>');
  expect(html).toContain('>XYZ</span>');
  expect(html).toContain('rounded-xl border border-border/70 bg-card shadow-sm');
  expect(html).toContain('整理这些资料');
});

test('generated PDF files use the same recognizable PDF icon', () => {
  const html = renderToStaticMarkup(<AssistantOutputFileCard
    file={{ path: '/tmp/report.pdf', name: 'report.pdf', subtitle: 'report.pdf', type: 'PDF', operation: 'create', toolUseId: 'write-1', sourcePaths: [] }}
    sessionId="session-1" workspace="/tmp"
  />);
  expect(html).toContain('data-pdf-icon="true"');
  expect(html).toContain('>PDF</text>');
});

test('conversation edge navigation uses icon-only directional controls', () => {
  expect(messageListSource).toContain('ArrowUpToLine');
  expect(messageListSource).toContain('ArrowDownToLine');
  expect(messageListSource).toContain('aria-label="回到顶部"');
  expect(messageListSource).toContain('aria-label="回到底部"');
  expect(messageListSource).not.toContain('              回到顶部');
  expect(messageListSource).not.toContain('              回到底部');
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
