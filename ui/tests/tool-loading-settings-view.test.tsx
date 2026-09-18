import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ToolLoadingSettingsTable } from '../src/renderer-react/components/settings-view';
import { DEFAULT_MOSS_TOOL_LOADING } from '../src/tool-loading-settings.mjs';

test('tool loading settings renders grouped resident and deferred radio choices', () => {
  const html = renderToStaticMarkup(
    <ToolLoadingSettingsTable
      value={{ ...DEFAULT_MOSS_TOOL_LOADING, app_build: 'always' }}
      onChange={() => {}}
    />,
  );

  expect(html).toContain('工具');
  expect(html).toContain('简短说明');
  expect(html).toContain('常驻');
  expect(html).toContain('按需');
  expect(html).toContain('浏览器');
  expect(html).toContain('App');
  expect(html).toContain('连接器');
  expect(html).toContain('图片');
  expect(html.match(/type="radio"/g)).toHaveLength(38);
  expect(html).toMatch(/aria-label="app_build 常驻"[^>]*checked=""[^>]*value="always"/);
  expect(html).toMatch(/aria-label="image_generate 按需"[^>]*checked=""[^>]*value="deferred"/);
});
