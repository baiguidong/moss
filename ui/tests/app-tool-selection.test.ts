import { describe, expect, test } from 'bun:test';
import { canSelectToolApp, filterToolApps, toolAppDescription, getToolPickerItems } from '../src/renderer-react/lib/app-tool-selection';
import type { AppMcpServiceTools, StoredApp } from '../src/renderer-react/types';

const tool = { id: 'search', title: '搜索', description: '查找', effect: 'read' as const };
const app = (id: string, overrides: Partial<StoredApp> = {}) => ({
  id, name: id, title: id, enabled: true, agentTools: [tool], ...overrides,
}) as StoredApp;
const service = (status: AppMcpServiceTools['status'], disabled?: boolean) => ({
  status, tools: disabled === undefined ? [] : [{ name: 'search', description: '', disabled }],
}) as AppMcpServiceTools;

describe('selectable tool Apps', () => {
  test('filters disabled, tool-less and unauthorized Apps from suggestions and search', () => {
    const apps = [
      app('enabled'), app('disabled', { enabled: false }),
      app('ui-only', { agentTools: [], hasUi: true }),
      app('denied', { agentTools: [{ ...tool, permission: 'files.read' }] }),
      app('granted', { agentTools: [{ ...tool, permission: 'files.read' }], grants: ['files.read'] }),
      app('partial', { agentTools: [tool, { ...tool, id: 'write', permission: 'files.write' }] }),
    ];
    expect(filterToolApps(apps, '').map(app => app.id)).toEqual(['enabled', 'granted', 'partial']);
    expect(filterToolApps(apps, 'disabled')).toEqual([]);
    // The resource manager can still retain unavailable selections for removal.
    expect(filterToolApps(apps, 'disabled', ['disabled']).map(app => app.id)).toEqual(['disabled']);
  });

  test('keeps lazy MCP discovery but requires usable tools once connected', () => {
    for (const status of ['unchecked', 'authorized'] as const) {
      expect(canSelectToolApp(app('mcp', { agentTools: [], mcpServices: [service(status)] }))).toBe(true);
    }
    expect(canSelectToolApp(app('mcp', { agentTools: [], mcpServices: [service('connected', false)] }))).toBe(true);
    expect(canSelectToolApp(app('mcp', { agentTools: [], mcpServices: [service('connected')] }))).toBe(false);
    expect(canSelectToolApp(app('mcp', { agentTools: [], mcpServices: [service('connected', true)] }))).toBe(false);
    for (const status of ['app-disabled', 'instance-disabled', 'unauthorized', 'disabled', 'credentials-missing', 'needs-auth', 'failed'] as const) {
      expect(canSelectToolApp(app('mcp', { agentTools: [], mcpServices: [service(status, false)] }))).toBe(false);
    }
    expect(canSelectToolApp(app('mixed', { agentTools: [], mcpServices: [service('failed'), service('connected', false)] }))).toBe(true);
    expect(canSelectToolApp(app('native', { mcpServices: [service('failed')] }))).toBe(true);
    expect(canSelectToolApp(app('disabled', { enabled: false, mcpServices: [service('unchecked')] }))).toBe(false);
  });
});

test('CLI skill apps are discoverable and selectable without native or MCP tools', () => {
  const cli = app('cli', { agentTools: [], contributes: { skills: [{ id: 'convert', title: 'Convert', description: 'Document conversion', path: 'SKILL.md', cli: 'cli.mjs' }] } });
  expect(canSelectToolApp(cli)).toBe(true);
  expect(filterToolApps([cli], '').map(value => value.id)).toEqual(['cli']);
  expect(canSelectToolApp({ ...cli, enabled: false })).toBe(false);
});

test('cached MCP counts stay visible in App and service pickers without changing authorization', () => {
  const cached = { ...service('unchecked', false), appId: 'mcp', instanceId: 'one', name: 'docs', serviceId: 'mcp/one/docs', catalogSource: 'cache' as const, checkedAt: 10 };
  const value = app('mcp', { agentTools: [], mcpServices: [cached] });
  expect(toolAppDescription(value)).toContain('1 个工具');
  expect(toolAppDescription(value)).not.toContain('连接时加载');
  const items = getToolPickerItems([{ ...value, toolSelection: 'services' }], '', [], [], 'mcp');
  expect(items[0].description).toContain('1 个工具');
  expect(items[0].available).toBe(true);
  expect(canSelectToolApp({ ...value, mcpServices: [{ ...cached, status: 'unauthorized' }] })).toBe(false);
  expect(toolAppDescription({ ...value, mcpServices: [service('unchecked')] })).toContain('连接时加载工具');
});
