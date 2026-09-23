import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppSidebar, getSidebarMoreApps, getSidebarMoreViews } from '../src/renderer-react/components/app-sidebar';
import type { StoredApp } from '../src/renderer-react/types';

function renderSidebar({
  libraryEnabled = false,
  workflowsEnabled = false,
  remoteEnabled = false,
  agentMailEnabled = false,
  sessions = [],
  apps = [],
  activeView = 'chat',
  collapsed = false,
}: {
  libraryEnabled?: boolean;
  workflowsEnabled?: boolean;
  remoteEnabled?: boolean;
  agentMailEnabled?: boolean;
  sessions?: any[];
  apps?: any[];
  activeView?: 'chat' | 'overview' | 'skills' | 'experts' | 'connectors';
  collapsed?: boolean;
} = {}) {
  return renderToStaticMarkup(
    <AppSidebar
      sessions={sessions}
      apps={apps}
      activeSessionId={null}
      activeView={activeView}
      appsCount={0}
      projectsCount={0}
      themeMode="system"
      collapsed={collapsed}
      searchQuery=""
      libraryEnabled={libraryEnabled}
      workflowsEnabled={workflowsEnabled}
      remoteEnabled={remoteEnabled}
      agentMailEnabled={agentMailEnabled}
      onChangeView={() => {}}
      onChangeTheme={() => {}}
      onSelectSession={() => {}}
      onLaunchApp={() => {}}
      onNewSession={() => {}}
      onDeleteSession={() => {}}
      onRenameSession={() => {}}
      onTogglePin={() => {}}
      onSearchChange={() => {}}
    />,
  );
}

describe('app sidebar more menu', () => {
  test('keeps secondary destinations behind one compact trigger', () => {
    const html = renderSidebar({ libraryEnabled: true, workflowsEnabled: true, remoteEnabled: true, agentMailEnabled: true });
    expect(html).toContain('title="更多"');
    expect(html).not.toContain('title="资料库"');
    expect(html).not.toContain('title="协作邮箱"');
    expect(html).not.toContain('title="即时消息"');
    expect(html).not.toContain('title="审计中心"');
    expect(html).not.toContain('title="定时任务"');
    expect(html).not.toContain('title="工作流"');
  });

  test('builds menu entries from feature availability', () => {
    expect(getSidebarMoreViews({ libraryEnabled: false, workflowsEnabled: false, remoteEnabled: false, agentMailEnabled: false }))
      .toEqual(['overview', 'audit', 'cron']);
    expect(getSidebarMoreViews({ libraryEnabled: true, workflowsEnabled: true, remoteEnabled: true, agentMailEnabled: true }))
      .toEqual(['overview', 'library', 'workflows', 'mail', 'audit', 'cron']);
  });

  test('stays hidden unless cloud mode and the mailbox are enabled', () => {
    expect(getSidebarMoreViews({ libraryEnabled: false, workflowsEnabled: false, remoteEnabled: false, agentMailEnabled: true })).not.toContain('mail');
    expect(getSidebarMoreViews({ libraryEnabled: false, workflowsEnabled: false, remoteEnabled: true, agentMailEnabled: false })).not.toContain('mail');
  });

  test('shows the localized workflow destination only when enabled', () => {
    expect(getSidebarMoreViews({ libraryEnabled: false, workflowsEnabled: false, remoteEnabled: false, agentMailEnabled: false }))
      .not.toContain('workflows');
    expect(getSidebarMoreViews({ libraryEnabled: false, workflowsEnabled: true, remoteEnabled: false, agentMailEnabled: false }))
      .toContain('workflows');
    expect(renderSidebar({ workflowsEnabled: true })).not.toContain('title="Workflows"');
  });

  test('applies the same dependency to collaborative mailbox sessions', () => {
    const mailSession = {
      id: 'mail-session',
      title: '邮件处理会话',
      preview: 'preview',
      time: '刚刚',
      workspaceLabel: 'Moss',
      busy: false,
      sessionKind: 'agent-mail',
    };
    expect(renderSidebar({ sessions: [mailSession] })).not.toContain('邮件处理会话');
    expect(renderSidebar({
      remoteEnabled: true,
      agentMailEnabled: true,
      sessions: [mailSession],
    })).toContain('邮件处理会话');
  });
});

describe('app sidebar resource navigation', () => {
  const app = { id: 'example.app', name: 'example.app', displayName: 'Example', enabled: true, hasUi: true } as StoredApp;

  test('adds enabled UI Apps without requiring view declarations', () => {
    expect(getSidebarMoreApps([app])).toEqual([
      { id: 'example.app', name: 'example.app', title: 'Example', route: '' },
    ]);
  });

  test('hides disabled, unavailable and Backend-only Apps from More', () => {
    expect(getSidebarMoreApps([
      { ...app, enabled: false },
      { ...app, hasUi: false },
      { ...app, packageStatus: 'invalid' },
      { ...app, packageStatus: 'incompatible' },
    ])).toEqual([]);
    expect(getSidebarMoreApps([{ ...app, runtimeStatus: { state: 'stopped' } }])).toHaveLength(1);
  });

  test('creates one entry per App and opens its first authorized view by order', () => {
    const configured = {
      ...app,
      contributes: { views: [
        { id: 'second', title: 'Second', route: '#/second', order: 10 },
        { id: 'restricted', title: 'Restricted', route: '#/admin', order: -10, permission: 'admin:read' },
        { id: 'home', title: 'Home', route: '#/home', order: 0 },
      ] },
    };
    expect(getSidebarMoreApps([configured])).toEqual([
      { id: app.id, name: app.name, title: 'Example', route: '#/home' },
    ]);
    expect(getSidebarMoreApps([{ ...configured, grants: ['admin:read'] }])[0].route).toBe('#/admin');
  });

  test('ignores legacy view placement and never adds bottom App shortcuts', () => {
    for (const location of ['more', 'sidebar', 'hidden']) {
      const legacy = { ...app, contributes: { views: [{ id: 'home', title: 'Home', route: '#/home', location }] } };
      expect(getSidebarMoreApps([legacy])[0].route).toBe('#/home');
      for (const collapsed of [false, true]) {
        const html = renderSidebar({ apps: [legacy], collapsed });
        expect(html).toContain('title="更多"');
        expect(html).not.toContain('title="Example"');
        expect(html).not.toContain('data-app-view=');
        expect(html).not.toContain('data-app-id=');
      }
    }
  });

  test('shows one combined resource entry instead of separate entries', () => {
    const html = renderSidebar();
    expect(html).toContain('title="技能·专家·连接器"');
    expect(html.match(/data-resource-nav-separator/g)).toHaveLength(2);
    expect(html).toContain('text-[8px]');
    expect(html).not.toContain('title="技能"');
    expect(html).not.toContain('title="专家"');
  });

  test('highlights the combined entry for each resource view', () => {
    for (const activeView of ['skills', 'experts', 'connectors'] as const) {
      const html = renderSidebar({ activeView });
      expect(html).toMatch(/class="[^"]*bg-secondary[^"]*"[^>]*title="技能·专家·连接器"/);
    }
  });
});

describe('app sidebar child sessions', () => {
  test('keeps child sessions collapsed by default', () => {
    const sessions = [
      {
        id: 'parent-session',
        title: '主会话',
        preview: 'preview',
        time: '刚刚',
        workspaceLabel: 'Moss',
        busy: false,
      },
      {
        id: 'child-session',
        title: '子会话标题',
        preview: 'preview',
        time: '刚刚',
        workspaceLabel: 'Moss',
        busy: false,
        isSubAgent: true,
        parentSessionId: 'parent-session',
      },
    ];
    const html = renderSidebar({ sessions });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('展开“主会话”的 1 个子会话');
    expect(html).not.toContain('lucide-bot');
    expect(html).not.toContain('子会话标题');
  });
});

describe('app sidebar session controls', () => {
  const localSession = {
    id: 'local-session',
    title: '本地会话标题',
    preview: 'preview',
    time: '刚刚',
    workspaceLabel: 'Moss',
    busy: false,
    agentMode: 'local',
  };
  const remoteSession = {
    ...localSession,
    id: 'remote-session',
    title: '云端会话标题',
    agentMode: 'remote-direct',
  };

  test('shows local and cloud history together with distinct icons', () => {
    const html = renderSidebar({
      remoteEnabled: true,
      sessions: [localSession, remoteSession],
    });
    expect(html).toContain('本地会话标题');
    expect(html).toContain('云端会话标题');
    expect(html).toContain('aria-label="本地会话"');
    expect(html).toContain('aria-label="云端会话"');
    expect(html).not.toContain('aria-label="会话模式"');
  });

  test('puts the existing session menu behind a right-side ellipsis', () => {
    const html = renderSidebar({ sessions: [localSession] });
    expect(html).toContain('aria-label="打开“本地会话标题”的会话设置"');
    expect(html).toContain('lucide-ellipsis');
  });

  test('keeps search in the top row and removes the duplicate sidebar collapse button', () => {
    const expandedHtml = renderSidebar({ sessions: [localSession] });
    const collapsedHtml = renderSidebar({ sessions: [localSession], collapsed: true });
    expect(expandedHtml.indexOf('title="搜索会话"')).toBeLessThan(expandedHtml.indexOf('title="新会话"'));
    expect(collapsedHtml).toContain('title="搜索会话"');
    expect(expandedHtml).not.toContain('title="收起侧栏"');
    expect(collapsedHtml).not.toContain('title="展开侧栏"');
  });
});
