import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownRenderer } from '../src/renderer-react/components/markdown/markdown-renderer';
import { handleMarkdownLinkClick, markdownUrlTransform } from '../src/renderer-react/lib/markdown-links';
import { parseLibraryResourceUri } from '../src/library/library-resource-uri.mjs';

const resourceId = '11112222-3333-4444-5555-666677778888';
const uri = `moss-library://resource/${resourceId}?revision=abc123&name=%E7%AE%80%E5%8E%86`;

function setup() {
  const opened: unknown[] = [];
  const external: string[] = [];
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  const host = {
    library: { openResource: async (input: { resourceId: string }) => { opened.push(input); return { ok: true }; } },
    shell: { openExternal: async (url: string) => { external.push(url); return { ok: true }; } },
  };
  return { opened, external, event, host, prevented: () => prevented };
}

describe('Markdown source links', () => {
  test('retains Library source citations in rendered conversation text', () => {
    const html = renderToStaticMarkup(<MarkdownRenderer content={`来源：[简历 PDF，第 1 页](${uri})`} />);
    expect(html).toContain(`href="${uri.replaceAll('&', '&amp;')}"`);
    expect(html).toContain('简历 PDF，第 1 页');
    expect(parseLibraryResourceUri(uri)).toMatchObject({ resourceId, revision: 'abc123', name: '简历' });
  });

  test('opens the resource through the desktop Library in any conversation', async () => {
    const state = setup();
    await handleMarkdownLinkClick(state.event, uri, state.host);
    expect(state.prevented()).toBe(true);
    expect(state.opened).toEqual([{ resourceId }]);
    expect(state.external).toEqual([]);
  });

  test('propagates unavailable-resource errors for the renderer to display', async () => {
    const state = setup();
    state.host.library.openResource = async () => { throw new Error('Library resource is unavailable.'); };
    await expect(handleMarkdownLinkClick(state.event, uri, state.host)).rejects.toThrow('Library resource is unavailable');
    expect(state.prevented()).toBe(true);
    expect(state.external).toEqual([]);
  });

  test('rejects malformed resource references before calling the host', async () => {
    for (const invalid of ['moss-library://resource/a/b', 'moss-library://source/12345678']) {
      const state = setup();
      await expect(handleMarkdownLinkClick(state.event, invalid, state.host)).rejects.toThrow('Invalid Library resource');
      expect(state.prevented()).toBe(true);
      expect(state.opened).toEqual([]);
      expect(state.external).toEqual([]);
    }
  });

  test('keeps web links working and unsafe schemes blocked', async () => {
    const state = setup();
    await handleMarkdownLinkClick(state.event, 'https://example.com', state.host);
    expect(state.prevented()).toBe(true);
    expect(state.external).toEqual(['https://example.com']);
    expect(state.opened).toEqual([]);
    expect(markdownUrlTransform('javascript:alert(1)', 'href')).toBe('');
    expect(markdownUrlTransform('data:text/html,hello', 'href')).toBe('');
    expect(markdownUrlTransform(uri, 'src')).toBe('');
    expect(markdownUrlTransform('moss-media://session/image.png', 'src')).toBe('moss-media://session/image.png');
  });
});
