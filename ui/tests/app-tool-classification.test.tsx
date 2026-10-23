import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getAppCatalogDiscovery, getAppKind, getAppToolCapabilities, normalizeAppDiscovery } from '../../packages/app-sdk/src/discovery.mjs';
import { filterApps } from '../src/renderer-react/lib/app-categories';
import { AppDiscoveryFilter } from '../src/renderer-react/components/app-discovery-filter';
import { AppDiscoveryBadges } from '../src/renderer-react/components/app-discovery-badges';

describe('application and composable tool classification', () => {
  const apps = [
    { id: 'example.online-ui', ui: { entry: 'index.html' }, discovery: { group: 'online' as const } },
    { id: 'example.local-mcp', ui: { builtin: 'mcp' }, mcpApp: {}, discovery: { group: 'local' as const } },
    { id: 'example.hybrid', connectorApp: { capabilities: ['mcp', 'cli', 'skills'] }, discovery: { group: 'online' as const } },
    { id: 'example.skills', connectorApp: { capabilities: ['skills'] } },
    { id: 'example.unknown' },
  ];

  test('keeps delivery shape independent of service location and MCP builtin settings', () => {
    expect(apps.map(getAppKind)).toEqual(['app', 'tool', 'tool', 'tool', 'app']);
    expect(getAppKind({ id: 'moss.filesystem', hasUi: true })).toBe('tool');
    expect(getAppKind({ id: 'example.custom-mcp', mcpApp: {}, ui: { entry: 'custom.html' } })).toBe('app');
    expect(getAppToolCapabilities(apps[2])).toEqual(['mcp', 'cli', 'skills']);
    expect(getAppCatalogDiscovery(apps[0])).toEqual({ group: 'online', kind: 'app' });
    expect(getAppCatalogDiscovery(apps[1])).toEqual({ group: 'local', kind: 'tool', capabilities: ['mcp'] });
  });

  test('filters without duplicating hybrid tools and keeps unknown entries in applications', () => {
    expect(filterApps(apps, '', 'all', { kind: 'app' }).map(app => app.id)).toEqual(['example.online-ui', 'example.unknown']);
    expect(filterApps(apps, '', 'all', { kind: 'tool', capability: 'mcp' }).map(app => app.id)).toEqual(['example.local-mcp', 'example.hybrid']);
    expect(filterApps(apps, '', 'all', { kind: 'tool', capability: 'cli', group: 'online' }).map(app => app.id)).toEqual(['example.hybrid']);
    expect(filterApps(apps, 'skills').map(app => app.id)).toEqual(['example.hybrid', 'example.skills']);
    expect(filterApps(apps, '')).toHaveLength(5);
  });

  test('normalizes catalog-only metadata and ignores malformed capability declarations', () => {
    expect(normalizeAppDiscovery({ group: 'unknown', kind: 'app' })).toEqual({ group: 'unknown', kind: 'app' });
    expect(normalizeAppDiscovery({ group: 'online', kind: 'tool', capabilities: ['cli', 'mcp', 'cli', 'other'] })).toEqual({ group: 'online', kind: 'tool', capabilities: ['mcp', 'cli'] });
    expect(normalizeAppDiscovery({ group: 'local', capabilities: {} })).toEqual({ group: 'local' });
  });

  test('renders only the main section selector and search with informative badges', () => {
    const markup = renderToStaticMarkup(<AppDiscoveryFilter value="tool" onChange={() => {}} query="" onQuery={() => {}} />);
    expect(markup).toContain('value="app"');
    expect(markup).toContain('value="tool"');
    expect(markup).not.toContain('value="all"');
    expect(markup.match(/<select/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="搜索应用"');
    expect(markup).not.toContain('全部能力');
    expect(markup).not.toContain('aria-label="工具能力"');
    expect(markup).not.toContain('aria-label="服务位置"');
    expect(markup).not.toContain('本地应用');
    const badges = renderToStaticMarkup(<AppDiscoveryBadges app={apps[2]} />);
    for (const label of ['工具', 'MCP', 'CLI', 'Skills', '在线']) expect(badges).toContain(label);
  });
});
