import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppSidebar, getSidebarMoreViews } from '../src/renderer-react/components/app-sidebar';

function renderSidebar({
  libraryEnabled = false,
  remoteEnabled = false,
  agentMailEnabled = false,
  sessions = [],
  activeView = 'chat',
}: {
  libraryEnabled?: boolean;
  remoteEnabled?: boolean;
  agentMailEnabled?: boolean;
  sessions?: any[];
  activeView?: 'chat' | 'skills' | 'experts' | 'connectors';
} = {}) {
  return renderToStaticMarkup(
    <AppSidebar
      sessions={sessions}
      apps={[]}
      activeSessionId={null}
      activeView={activeView}
      appsCount={0}
      projectsCount={0}
      themeMode="system"
      collapsed={false}
      searchQuery=""
      libraryEnabled={libraryEnabled}
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
      onToggleCollapse={() => {}}
      onSearchChange={() => {}}
    />,
  );
}

describe('app sidebar more menu', () => {
  test('keeps secondary destinations behind one compact trigger', () => {
    const html = renderSidebar({ libraryEnabled: true, remoteEnabled: true, agentMailEnabled: true });
    expect(html).toContain('title="更多"');
    expect(html).not.toContain('title="资料库"');
    expect(html).not.toContain('title="协作邮箱"');
    expect(html).not.toContain('title="即时消息"');
    expect(html).not.toContain('title="审计中心"');
    expect(html).not.toContain('title="定时任务"');
  });

  test('builds menu entries from feature availability', () => {
    expect(getSidebarMoreViews({ libraryEnabled: false, remoteEnabled: false, agentMailEnabled: false }))
      .toEqual(['openim', 'audit', 'cron']);
    expect(getSidebarMoreViews({ libraryEnabled: true, remoteEnabled: true, agentMailEnabled: true }))
      .toEqual(['library', 'mail', 'openim', 'audit', 'cron']);
  });

  test('stays hidden unless cloud mode and the mailbox are enabled', () => {
    expect(getSidebarMoreViews({ libraryEnabled: false, remoteEnabled: false, agentMailEnabled: true })).not.toContain('mail');
    expect(getSidebarMoreViews({ libraryEnabled: false, remoteEnabled: true, agentMailEnabled: false })).not.toContain('mail');
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
    expect(html).not.toContain('子会话标题');
  });
});
