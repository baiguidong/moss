import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownRenderer } from '../src/renderer-react/components/markdown/markdown-renderer';
import { handleMarkdownLinkClick, markdownUrlTransform } from '../src/renderer-react/lib/markdown-links';
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
