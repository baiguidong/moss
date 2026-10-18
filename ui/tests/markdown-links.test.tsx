import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownRenderer } from '../src/renderer-react/components/markdown/markdown-renderer';
import { fileLinkLabel, handleMarkdownLinkClick, markdownUrlTransform } from '../src/renderer-react/lib/markdown-links';
import { remarkFileReferences } from '../src/renderer-react/lib/remark-file-references';
import { isAppResourceUri } from '../src/shared/app-resource-uri.mjs';
const uri = 'example-notes://document/11112222?revision=abc&name=Notes';
function setup() {
  const opened: string[] = [], external: string[] = [];
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  const host = {
    openAppResource: async (input: string) => { opened.push(input); return { opened: true }; },
    shell: { openExternal: async (url: string) => { external.push(url); return { ok: true }; } },
  };
  return { opened, external, event, host, prevented: () => prevented };
}
describe('Markdown App resource links', () => {
  test('retains custom citations in rendered conversation text', () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={`来源：[笔记](${uri})`} />);
    expect(html).toContain(`href="${uri.replaceAll('&', '&amp;')}"`);
  });
  test('opens references using an App provider in any conversation', async () => {
    const state = setup(); await handleMarkdownLinkClick(state.event, uri, state.host);
    expect(state.prevented()).toBe(true); expect(state.opened).toEqual([uri]); expect(state.external).toEqual([]);
  });
  test('propagates unavailable-provider errors', async () => {
    const state = setup(); state.host.openAppResource = async () => { throw new Error('App unavailable'); };
    await expect(handleMarkdownLinkClick(state.event, uri, state.host)).rejects.toThrow('App unavailable');
    expect(state.external).toEqual([]);
  });
  test('keeps web and media links, blocks executable and image resource URIs', async () => {
    const state = setup(); await handleMarkdownLinkClick(state.event, 'https://example.com', state.host);
    expect(state.external).toEqual(['https://example.com']); expect(state.opened).toEqual([]);
    for (const unsafe of ['javascript:alert(1)', 'javascript://example.com', 'data:text/html,hello', 'file:///tmp/test']) expect(isAppResourceUri(unsafe)).toBe(false);
    expect(markdownUrlTransform('javascript:alert(1)', 'href')).toBe('');
    expect(markdownUrlTransform('data:text/html,hello', 'href')).toBe('');
    expect(markdownUrlTransform(uri, 'src')).toBe('');
    expect(markdownUrlTransform('moss-media://session/image.png', 'src')).toBe('moss-media://session/image.png');
  });
});

test('long workspace labels render as visible filename links and keep the original target', () => {
  const file = '/Users/bgd/.moss/sessions/session/workspace/joke_write.txt';
  const html = renderToStaticMarkup(<MarkdownRenderer content={`[${file}](${file}:1)`} sessionId="session" />);
  expect(html).toContain(`href="${file}:1"`);
  expect(html).toContain('>joke_write.txt</a>');
  expect(html).toContain('underline underline-offset');
  expect(fileLinkLabel('/x/report.txt', '业务报告')).toBeNull();
});

test('bare path candidates do not alter web links, existing links or code blocks', () => {
  const text = (value: string) => ({ type: 'text', value });
  const tree = { type: 'root', children: [
    { type: 'paragraph', children: [text('路径：/tmp/joke.txt。 https://example.com/f.txt'), { type: 'link', url: '/tmp/a', children: [text('/tmp/a')] }, { type: 'inlineCode', value: '/tmp/b' }] },
    { type: 'code', value: '/tmp/c' },
  ] };
  remarkFileReferences()(tree);
  const children = tree.children[0].children as any[];
  expect(children.filter(item => item.type === 'link').map(item => item.url)).toEqual(['/tmp/joke.txt', '/tmp/a']);
  expect(children.find(item => item.url === '/tmp/a').children).toEqual([text('/tmp/a')]);
  expect(children.some(item => item.value?.includes('https://example.com/f.txt'))).toBe(true);
  expect(tree.children[1]).toEqual({ type: 'code', value: '/tmp/c' });
});

test('local file navigation retains the owning session and line suffix', async () => {
  const opened: any[] = [];
  const host = { ...setup().host, presentation: { open: async (input: any) => { opened.push(input); return { ok: true }; } } } as any;
  const event = { preventDefault() {} };
  await handleMarkdownLinkClick(event, '/tmp/joke.txt:1', host, 'owning-session');
  expect(opened).toEqual([{ sessionId: 'owning-session', input: { items: [{ path: '/tmp/joke.txt:1' }] } }]);
  await expect(handleMarkdownLinkClick(event, '/tmp/joke.txt', host)).rejects.toThrow('所属会话');
});
