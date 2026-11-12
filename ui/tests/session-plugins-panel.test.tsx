import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SessionPluginsPanel, hasSessionPlugins } from '../src/renderer-react/components/session-plugins-panel';

const session = (patch: Record<string, unknown> = {}) => ({
  id: 'session',
  history: [],
  skillIds: [],
  appIds: [],
  appServiceIds: [],
  assistantName: null,
  ...patch,
}) as any;

test('hides plugin navigation when a session has no loaded plugins', () => {
  expect(hasSessionPlugins(session(), [])).toBe(false);
  expect(hasSessionPlugins(session({ skillIds: ['skill.demo'] }), [])).toBe(true);
});

test('renders loaded expert and App plugins as cards', () => {
  const value = session({ assistantName: 'expert.demo', appIds: ['app.demo'] });
  const html = renderToStaticMarkup(<SessionPluginsPanel
    session={value}
    apps={[{ id: 'app.demo', name: 'app.demo', title: '演示 App', displayName: '演示 App', description: 'App 描述', toolSelection: 'app' } as any]}
    installedAssistants={[{ name: 'expert.demo', displayName: '演示专家', description: '专家描述', category: '研究' } as any]}
  />);

  expect(html).toContain('data-session-plugins');
  expect(html).toContain('演示专家');
  expect(html).toContain('演示 App');
  expect(html).toContain('当前会话插件');
});
