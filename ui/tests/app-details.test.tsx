import { test, expect } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs';
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs';
import { registerAppRuntimeIpc } from '../src/apps/app-runtime-ipc.mjs';
import { AppDetailsView } from '../src/renderer-react/components/app-details-view';
import { AppsPanel } from '../src/renderer-react/components/apps-panel';
import { getAppPrimaryEntry } from '../src/renderer-react/lib/app-navigation';
import { getSidebarMoreApps } from '../src/renderer-react/components/app-sidebar';
import type { StoredApp } from '../src/renderer-react/types';

const base = { id: 'test.info', name: 'test.info', title: '可视化', displayName: '可视化', description: '主会话中的交互演示',
  hasUi: false, hasBackend: true, navigation: { location: 'none' }, toolScope: 'global', enabled: true, currentVersion: '1.0.0',
  publisher: { id: 'moss', name: 'Moss' }, overview: { examples: ['用滑块解释复利'] },
  declaredSkills: [{ id: 'visualize', title: '可视化创作', description: '交互图表', path: 'SKILL.md', cli: 'cli.mjs' }],
} as StoredApp;

test('information remains openable without an App UI, while disabled or incompatible', () => {
  for (const patch of [{}, { enabled: false }, { packageStatus: 'invalid' }, { packageStatus: 'incompatible' }] as Partial<StoredApp>[]) {
    const app = { ...base, ...patch };
    expect(getAppPrimaryEntry(app)).toMatchObject({ location: 'info', unavailableReason: null });
    expect(getSidebarMoreApps([app])).toEqual([]);
    const html = renderToStaticMarkup(<AppsPanel initialTab="installed" apps={[app]} onLaunch={() => {}} onRefresh={async () => {}} />);
    const open = html.match(/<button[^>]*data-app-open="test.info"[^>]*>[\s\S]*?<\/button>/)?.[0];
    expect(open).toContain('打开'); expect(open).not.toContain('disabled=');
    const details = renderToStaticMarkup(<AppDetailsView app={app} onBack={() => {}} onTry={() => {}} onRefresh={async () => {}} />);
    expect(details).toContain('可视化创作'); expect(details).toContain('工具使用范围'); expect(details).not.toContain('<iframe');
  }
});

test('legacy business settings remain accessible from details without duplicating shared management', () => {
  const app = { ...base, hasUi: true, navigation: { location: 'more', viewId: 'home' },
    contributes: {
      views: [{ id: 'home', title: '工作区', route: '#/' },
        { id: 'moss-settings', title: '通用设置', route: '#/moss-settings' },
        { id: 'engine', title: '检索引擎', route: '#/engine', permission: 'engine:manage' }],
      settings: [{ id: 'shared', title: '通用设置', group: 'apps', viewId: 'moss-settings' },
        { id: 'engine', title: '检索引擎', group: 'apps', viewId: 'engine' }],
    },
  } as StoredApp;
  for (const granted of [true, false]) {
    const html = renderToStaticMarkup(<AppDetailsView app={{ ...app, grants: granted ? ['engine:manage'] : [] }} onBack={() => {}} onTry={() => {}} onOpenApp={() => {}} onRefresh={async () => {}} />);
    expect(html).toContain('data-app-ui-open="test.info"');
    expect(html).not.toContain('通用设置');
    expect(html).toContain('检索引擎');
    const button = html.match(/<button[^>]*data-app-setting="app:test.info\/engine"[^>]*>/)?.[0];
    expect(button).toBeDefined();
    expect(button!.includes('disabled=')).toBe(!granted);
  }
});

test('overview survives normalization and rejects invalid or oversized display content', () => {
  const raw = { schemaVersion: 2, id: 'test.info', version: '1.0.0', displayName: '可视化', hostApi: '^3.21.0',
    permissions: [], ui: { entry: 'index.html' }, overview: base.overview };
  expect(validateAppManifest(raw).overview).toEqual(base.overview);
  for (const overview of [{ examples: [42] }, { examples: ['x'.repeat(1001)] }, { examples: Array(7).fill('x') }, { description: 'x'.repeat(4001) }]) {
    expect(() => validateAppManifest({ ...raw, overview })).toThrow();
  }
});

test('settings and tool sections are visible by default, match basic information and omit empty content', () => {
  const render = (patch: Partial<StoredApp>) => renderToStaticMarkup(<AppDetailsView app={{ ...base, ...patch }} onBack={() => {}} onTry={() => {}} onRefresh={async () => {}} />);
  const html = render({ permissions: ['local-files:pick'], grants: ['local-files:pick'], agentTools: [{ id: 'visualize_create', name: 'visualize_create', title: '创建可视化', description: '生成交互演示', effect: 'write' }] });
  expect(html).toContain('aria-label="应用设置"');
  expect(html).toContain('aria-label="工具"');
  expect(html).toContain('来源：可视化 · App');
  expect(html).toContain('aria-label="选择本机文件"');
  expect(html).not.toContain('<details');
  expect(html).not.toContain('运行管理');
  expect(html).not.toMatch(/<button[^>]*aria-label="应用设置"/);
  expect([...html.matchAll(/data-app-details-section="([^"]+)"/g)].map(match => match[1])).toEqual(['基本信息', '应用设置', '技能', '工具']);
  expect(html.match(/<header[\s\S]*?<\/header>/)?.[0]).toContain('data-app-management-menu');
  expect(html.match(/class="divide-y divide-border\/50 text-sm"/g)).toHaveLength(3);
  const empty = render({ permissions: [], agentTools: [], contributes: {}, declaredSkills: [] });
  expect(empty).not.toContain('aria-label="应用设置"');
  expect(empty).not.toContain('aria-label="资源与展示能力"');
  expect(empty).not.toContain('aria-label="工具"');
  expect([...empty.matchAll(/data-app-details-section="([^"]+)"/g)].map(match => match[1])).toEqual(['基本信息']);
});

test('MCP details use package presentation and expose service management without connecting eagerly', () => {
  const app = { ...base, id: 'moss.dbx', name: 'moss.dbx', displayName: 'DBX MCP', title: 'DBX MCP', hasUi: true,
    uiBuiltin: 'mcp', declaredSkills: [], contributes: {}, overview: undefined,
    mcpPresentation: { headline: '在对话中使用 DBX 数据库工具', examples: ['列出 DBX 中允许 AI 使用的数据库连接'] },
  } as StoredApp;
  const html = renderToStaticMarkup(<AppDetailsView app={app} onBack={() => {}} onTry={() => {}} onRefresh={async () => {}} />);
  expect(html).toContain('列出 DBX 中允许 AI 使用的数据库连接');
  expect(html).toContain('aria-label="MCP 服务"');
  expect(html).not.toContain('aria-label="工具"');
  expect(html).not.toContain('aria-label="技能"');
  expect(html).not.toContain('<webview');
  expect(html).not.toContain('data-app-capabilities');
});

test('any configuration MCP App shows cached tool names and descriptions directly, including while disabled', () => {
  for (const enabled of [true, false]) {
    const app = { ...base, id: 'example.files', name: 'example.files', displayName: 'Files', hasBackend: false,
      hasUi: true, uiBuiltin: 'mcp', enabled, overview: undefined, declaredSkills: [], instances: [],
      mcpServices: [{ appId: 'example.files', instanceId: 'files-default', name: 'files', status: 'unchecked',
        revision: 'cached', catalogSource: 'cache', tools: [{ name: 'read_document', description: '读取文档内容', disabled: false }] }],
    } as StoredApp;
    const html = renderToStaticMarkup(<AppDetailsView app={app} onBack={() => {}} onTry={() => {}} onRefresh={async () => {}} />);
    expect(html).toContain('read_document');
    expect(html).toContain('读取文档内容');
    expect(html).toContain('aria-label="搜索工具"');
    expect(html.match(/aria-label="工具使用范围"/g)).toHaveLength(1);
    expect(html).not.toContain('<webview');
    expect(html).not.toContain('<iframe');
  }
});

test('mixed App details separate services and tools and append declared resource capabilities', () => {
  const app = { ...base, permissions: ['mcp:read'], grants: ['mcp:read'],
    contributes: { resourceProviders: [{ id: 'charts', title: '图表作品', listAction: 'charts.list', resolveAction: 'charts.resolve' }], widgets: [{ id: 'status', title: '任务状态', placement: 'status' }] },
    agentTools: [{ id: 'create_chart', title: '创建图表', description: '生成图表', effect: 'write' }],
    mcpServices: [{ appId: base.id, instanceId: 'default', name: 'data', revision: '1', status: 'unchecked',
      tools: [{ name: 'query_data', description: '查询数据', disabled: false }] }],
  } as StoredApp;
  const html = renderToStaticMarkup(<AppDetailsView app={app} onBack={() => {}} onTry={() => {}} onRefresh={async () => {}} />);
  expect([...html.matchAll(/data-app-details-section="([^"]+)"/g)].map(match => match[1])).toEqual(['基本信息', '应用设置', '技能', 'MCP 服务', '工具', '资源与展示能力']);
  const services = html.match(/<section aria-label="MCP 服务"[\s\S]*?<\/section>/)![0];
  expect(services).toContain('data');
  expect(services).not.toContain('query_data');
  const tools = html.match(/<section aria-label="工具"[\s\S]*?<\/section>/)![0];
  expect(tools).toContain('create_chart');
  expect(tools).toContain('query_data');
  expect(tools).toContain('来源：可视化 · data · MCP');
  expect(html).toContain('图表作品');
  expect(html).toContain('任务状态');
  expect(html).not.toContain('charts.resolve');
});

test('information APIs read only declared bounded skills and persist scope without launching a backend', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-app-details-'));
  const runtime = new AppRuntimeHost({ rootDir: root });
  const packageRoot = path.join(root, 'package'); await fs.mkdir(packageRoot);
  const manifest: any = { id: base.id, version: '1.0.0', toolScope: 'global', contributes: {
    skills: base.declaredSkills, tools: [{ id: 'create', action: 'create' }] } };
  runtime.getActivePackage = async () => ({ manifest, root: packageRoot }) as any;
  await runtime.state.initialize();
  await runtime.installations.upsert(base.id!, { enabled: true, activeVersion: '1.0.0', grants: [] });
  const handlers = new Map<string, Function>(), events: any[] = [];
  registerAppRuntimeIpc({ ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn) }, getRuntime: () => runtime, emitChanged: async (value: any) => { events.push(value); } });
  const read = (skillId = 'visualize') => handlers.get('app:read-skill')!({}, { appId: base.id, skillId });
  const scope = (value: any) => handlers.get('app:set-tool-scope')!({}, { appId: base.id, scope: value });
  try {
    await fs.writeFile(path.join(packageRoot, 'SKILL.md'), '# 测试技能\n说明');
    expect((await read()).content).toBe('# 测试技能\n说明');
    await expect(read('../SKILL.md')).rejects.toThrow('未提供');
    await fs.writeFile(path.join(packageRoot, 'SKILL.md'), 'x'.repeat(256 * 1024 + 1));
    await expect(read()).rejects.toThrow('256 KiB');
    await fs.unlink(path.join(packageRoot, 'SKILL.md'));
    await fs.writeFile(path.join(root, 'outside.md'), 'outside');
    await fs.symlink(path.join(root, 'outside.md'), path.join(packageRoot, 'SKILL.md'));
    await expect(read()).rejects.toThrow('超出');
    expect((await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [] })).tools).toHaveLength(1);
    await scope('session');
    expect((await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [] })).tools).toHaveLength(0);
    await scope('global');
    expect((await runtime.listContributions({ kinds: ['tools'], selectedAppIds: [] })).tools).toHaveLength(1);
    expect(new AppRuntimeHost({ rootDir: root }).getToolScope(base.id!, 'session')).toBe('global');
    await scope(null); expect(runtime.toolScopes.get(base.id!)).toBeUndefined();
    await expect(scope(undefined)).rejects.toThrow('无效');
    await expect(scope('invalid')).rejects.toThrow('无效');
    manifest.nativeAdapter = {}; await expect(scope('global')).rejects.toThrow('固定'); delete manifest.nativeAdapter;
    manifest.connectorApp = {}; await expect(scope('global')).rejects.toThrow('固定');
    expect(events).toHaveLength(3);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
