import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppSidebar } from '../src/renderer-react/components/app-sidebar';

function renderSidebar({
  libraryEnabled = false,
  remoteEnabled = false,
  agentMailEnabled = false,
  sessions = [],
}: {
  libraryEnabled?: boolean;
  remoteEnabled?: boolean;
  agentMailEnabled?: boolean;
  sessions?: any[];
} = {}) {
  return renderToStaticMarkup(
    <AppSidebar
      sessions={sessions}
      apps={[]}
      activeSessionId={null}
      activeView="chat"
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

describe('app sidebar Library entry', () => {
  test('hides the entry while Library is disabled', () => {
    expect(renderSidebar()).not.toContain('title="资料库"');
  });

  test('shows the entry while Library is enabled', () => {
    expect(renderSidebar({ libraryEnabled: true })).toContain('title="资料库"');
  });
});

describe('app sidebar collaborative mailbox entry', () => {
  test('stays hidden unless cloud mode and the mailbox are enabled', () => {
    expect(renderSidebar({ agentMailEnabled: true })).not.toContain('title="协作邮箱"');
    expect(renderSidebar({ remoteEnabled: true })).not.toContain('title="协作邮箱"');
  });

  test('appears when cloud mode and the mailbox are enabled', () => {
    expect(renderSidebar({ remoteEnabled: true, agentMailEnabled: true }))
      .toContain('title="协作邮箱"');
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
