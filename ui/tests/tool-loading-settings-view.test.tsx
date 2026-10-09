import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppToolSettingsTable, SettingsView, ToolLoadingSettingsTable } from '../src/renderer-react/components/settings-view';
import { DEFAULT_MOSS_TOOL_LOADING } from '../src/tool-loading-settings.mjs';
import { normalizeDesktopSettings } from '../src/desktop-settings.mjs';
import type { DesktopSettings, StoredApp } from '../src/renderer-react/types';

test('tool loading settings renders grouped resident and deferred radio choices', () => {
  const html = renderToStaticMarkup(
    <ToolLoadingSettingsTable
      value={{ ...DEFAULT_MOSS_TOOL_LOADING, app_build: 'always' }}
      onChange={() => {}}
      featureEnabled={{ computerUse: true }}
    />,
  );

  expect(html).toContain('工具');
  expect(html).toContain('分组');
  expect(html).toContain('简短说明');
  expect(html).toContain('常驻');
  expect(html).toContain('按需');
  expect(html).toContain('关闭');
  expect(html).toContain('浏览器');
  expect(html).toContain('App 管理');
  expect(html).toContain('连接器');
  expect(html).toContain('图片');
  expect(html).not.toContain('工作流');
  for (const name of ['WorkflowRun', 'WorkflowCreate', 'WorkflowEdit', 'WorkflowManage']) {
    expect(html).not.toContain(name);
  }
  expect(html).toContain('moss_browser_open');
  for (const name of ['browser_snapshot', 'browser_click', 'browser_type', 'browser_press', 'browser_scroll', 'browser_wait', 'browser_reload']) {
    expect(html).not.toContain(name);
  }
  expect(html).toContain('rowSpan="1"');
  expect(html).toContain('rowSpan="7"');
  expect(html.match(/>内置浏览器</g)).toHaveLength(1);
  expect(html.match(/>App 管理</g)).toHaveLength(1);
  expect(html.match(/type="radio"/g)).toHaveLength(39);
  expect(html).toMatch(/aria-label="computer_use 常驻"[^>]*checked=""[^>]*value="always"/);
  expect(html).toMatch(/aria-label="app_build 常驻"[^>]*checked=""[^>]*value="always"/);
  expect(html).toMatch(/aria-label="image_generate 按需"[^>]*checked=""[^>]*value="deferred"/);
});

const toolApps = [
  {
    id: 'example.catalog', name: 'example.catalog', displayName: '应用目录', enabled: true, grants: [],
    agentTools: [
      { id: 'search', title: '查询目录', description: '查找目录中的条目', effect: 'read' },
      { id: 'delete', title: '删除条目', description: '删除指定目录条目', effect: 'destructive', permission: 'catalog:write' },
    ],
  },
  {
    id: 'example.notes', name: 'example.notes', displayName: '笔记', enabled: false,
    agentTools: [{ id: 'search', title: '搜索笔记', description: '按关键词查找笔记', effect: 'read' }],
  },
  {
    id: 'moss.http-client', name: 'moss.http-client', displayName: 'HTTP 调试', enabled: true,
    backend: { lifecycle: 'on-demand', actions: [{ name: 'request.send' }] }, agentTools: [],
  },
] as StoredApp[];

test('App tool groups remain visible when disabled or ungranted, without per-tool controls or UI-only actions', () => {
  const html = renderToStaticMarkup(<AppToolSettingsTable apps={toolApps} />);
  const groups = html.match(/<tbody[\s\S]*?<\/tbody>/g)!;
  expect(groups).toHaveLength(2);
  expect(groups[0]).toContain('rowSpan="2"');
  expect(groups[0]).toContain('应用目录');
  expect(groups[0]).toContain('example.catalog');
  expect(groups[0]).toContain('查找目录中的条目');
  expect(groups[0]).toContain('已注册');
  expect(groups[0]).toContain('未授权');
  expect(groups[1]).toContain('笔记');
  expect(groups[1]).toContain('App 已停用');
  expect(html.match(/>按需</g)).toHaveLength(3);
  expect(html).not.toMatch(/<(input|button|select)\b/);
  expect(html).not.toContain('HTTP 调试');
  expect(html).not.toContain('request.send');
  const empty = renderToStaticMarkup(<AppToolSettingsTable apps={[toolApps[2]]} />);
  expect(empty).toContain('已安装的 App 暂未提供 AI 工具');
});

test('Settings Tools includes the current App catalog alongside the built-in loading settings', () => {
  const html = renderToStaticMarkup(<SettingsView
    apps={toolApps}
    settingsDraft={normalizeDesktopSettings({}) as DesktopSettings}
    setSettingsDraft={() => {}}
    settingsNotice=""
    autoSaveSettings={async () => {}}
    autoSaveImageSettings={async () => {}}
    themeMode="light"
    setThemeMode={() => {}}
    cssThemeId="default"
    setCssThemeId={() => {}}
    onToolDisplayModeChange={() => {}}
    onAppearancePreview={() => {}}
    onAppearanceCommit={() => {}}
    buddyEnabled={false}
    onBuddyEnabledChange={() => {}}
    initialSection="tools"
  />);
  expect(html).not.toContain('工作流 App');
  expect(html).not.toContain('扩展与集成');
  expect(html).not.toContain('id="workflows"');
  expect(html).toContain('Moss 内置工具');
  expect(html).toContain('app_build');
  expect(html).toContain('computer_use');
  expect(html).toMatch(/aria-label="computer_use 关闭"[^>]*checked=""/);
  expect(html).toContain('App 提供的工具');
  expect(html).toContain('查询目录');
  expect(html).toContain('搜索笔记');
  expect(html).toContain('统一按需加载，随 App 启停');
});

test('Settings shows dynamically discovered MCP tools alongside static tools, including exclusions and service states', () => {
  const service = { appId: 'moss.mcp', instanceId: 'mcp-default', name: 'playwright-cdp', runtimeName: 'playwright-cdp', revision: 'v1', status: 'connected' as const,
    tools: [{ name: 'browser_click', description: 'Click an element', disabled: false }, { name: 'browser_close', description: 'Close browser', disabled: true }] }
  const app = { id: 'moss.mcp', name: 'moss.mcp', displayName: 'MCP', enabled: true, agentTools: [], mcpServices: [service] } as StoredApp
  const html = renderToStaticMarkup(<AppToolSettingsTable apps={[...toolApps, app]} />)
  expect(html).toContain('playwright-cdp')
  expect(html).toContain('browser_click')
  expect(html).toContain('browser_close')
  expect(html).toContain('已排除')
  expect(html).toContain('可用')
  expect(html).toContain('查询目录')
  expect(html).not.toContain('暂未提供 AI 工具')
  for (const [status, label] of [['unchecked', '正在加载工具'], ['disabled', '服务已停用'], ['unauthorized', '未授权'], ['needs-auth', '需要授权'], ['failed', '加载失败']] as const) {
    const pending = renderToStaticMarkup(<AppToolSettingsTable apps={[{ ...app, mcpServices: [{ ...service, status, tools: [] }] }]} />)
    expect(pending).toContain('playwright-cdp')
    expect(pending).toContain(label)
    expect(pending).not.toContain('暂未提供 AI 工具')
  }
})
