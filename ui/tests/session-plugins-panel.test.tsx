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

test('keeps the plugin surface available for ordinary sessions with built-in tools', () => {
  expect(hasSessionPlugins(session(), [])).toBe(true);
  expect(hasSessionPlugins(session({ agentMode: 'remote-direct' }), [])).toBe(false);
  expect(hasSessionPlugins(session({ skillIds: ['skill.demo'] }), [])).toBe(true);
});

test('renders loaded expert and App plugins as cards', () => {
  const value = session({ assistantName: 'expert.demo', appIds: ['app.demo'] });
  const html = renderToStaticMarkup(<SessionPluginsPanel
    session={value}
    apps={[{ id: 'app.demo', name: 'app.demo', title: '演示 App', displayName: '演示 App', description: 'App 描述', toolSelection: 'app' } as any]}
    installedAssistants={[{ name: 'expert.demo', displayName: '演示专家', description: '专家描述', category: '研究' } as any]}
    initialCatalog={{ tools: [], skills: [], experts: [{ id: 'expert.demo', name: 'expert.demo', displayName: '演示专家', description: '专家描述' }], apps: [{ id: 'app.demo', displayName: '演示 App', description: 'App 描述' }] }}
  />);

  expect(html).toContain('data-session-plugins');
  expect(html).toContain('演示专家');
  expect(html).toContain('演示 App');
  expect(html).toContain('>专家</h2>');
  expect(html).toContain('>App</h2>');
});

test('renders the model resource snapshot in a responsive tool card grid', () => {
  const value = session({
    history: [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'nested_search' }] } }],
    appIds: ['app.demo'],
  });
  const html = renderToStaticMarkup(<SessionPluginsPanel
    session={value}
    apps={[{
      id: 'app.demo', name: 'app.demo', title: '演示 App', displayName: '演示 App', enabled: true, toolSelection: 'app',
      agentTools: [{ id: 'native-search', title: '本地搜索', description: '搜索内容', effect: 'read' }],
      mcpServices: [{ serviceId: 'mcp', appId: 'app.demo', instanceId: 'i', name: '服务', runtimeName: 'service', revision: '1', status: 'connected', tools: [{ name: 'remote_search', description: '远程搜索', disabled: false }] }],
    } as any]}
    installedAssistants={[]}
    initialCatalog={{ tools: [{ id: 'native-search', name: 'native-search', title: '本地搜索', description: '搜索内容', source: 'app' }, { id: 'remote-search', name: 'remote_search', title: 'remote_search', description: '远程搜索', source: 'mcp' }, { id: 'nested', name: 'nested_search', title: 'nested_search', description: '会话工具', source: 'built-in' }], skills: [], apps: [{ id: 'app.demo', displayName: '演示 App' }] }}
  />);

  expect(html).toContain('本地搜索');
  expect(html).toContain('remote_search');
  expect(html).toContain('nested_search');
  expect(html).toContain('grid-template-columns:repeat(auto-fill');
});

test('renders the model resource snapshot for skills', () => {
  const html = renderToStaticMarkup(<SessionPluginsPanel
    session={session()}
    apps={[]}
    installedAssistants={[]}
    initialCatalog={{ tools: [], skills: [{ id: 'writing-helper', name: 'writing-helper', displayName: 'writing-helper', source: 'installed' }] }}
  />);

  expect(html).toContain('writing-helper');
  expect(html).toContain('>技能</h2>');
});
