import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SettingsView } from '../src/renderer-react/components/settings-view';
import type { DesktopSettings } from '../src/renderer-react/types';

test('desktop settings binds Agent Mail session mode and shows the OAuth user', () => {
  const settings = {
    agentMode: 'local',
    localEnabled: true,
    remoteEnabled: true,
    bypassPermissions: false,
    model: 'gpt-5.5',
    maxTurns: 100,
    appendSystemPrompt: '',
    thinkingMode: 'adaptive',
    thinkingBudgetTokens: 16_000,
    url: '',
    apiKey: 'text-model-secret',
    image: { provider: 'minimax', url: '', apiKey: '', model: '' },
    appearance: {
      themeMode: 'system',
      cssThemeId: 'default',
      autoCollapseToolCalls: false,
      chatFontSize: 14,
      chatLineHeight: 1.55,
      chatMessageSpacing: 10,
    },
    agentMail: { enabled: true, sessionMode: 'fixed' },
    remoteDirect: {
      serverUrl: '',
      credentialMode: 'password',
      userName: 'Moss User',
      userEmail: '',
      userPassword: '',
      apiKey: '',
      workspace: '',
    },
    remoteDirectServerUrl: 'https://moss.example.com',
    remoteDirectCredentialMode: 'password',
    remoteDirectUserName: 'Moss User',
    remoteDirectUserEmail: '',
    remoteDirectUserPassword: '',
    remoteDirectApiKey: 'moss-api-key',
    remoteDirectWorkspace: '',
    settingsPath: '',
    settingsExists: true,
    settingsLoaded: true,
    settingsParseError: '',
  } as DesktopSettings;

  const html = renderToStaticMarkup(
    <SettingsView
      settingsDraft={settings}
      setSettingsDraft={() => {}}
      settingsNotice=""
      autoSaveSettings={async () => {}}
      autoSaveImageSettings={async () => {}}
      themeMode="system"
      setThemeMode={() => {}}
      cssThemeId="default"
      setCssThemeId={() => {}}
      onAutoCollapseToolCallsChange={() => {}}
      onAppearancePreview={() => {}}
      onAppearanceCommit={() => {}}
      buddyEnabled={false}
      onBuddyEnabledChange={() => {}}
    />,
  );

  expect(html).not.toContain('回复会话');
  expect(html).toContain('固定会话');
  expect(html).toContain('新会话');
  expect(html).toContain('aria-label="协作邮箱会话模式"');
  expect(html).toContain('Moss User');
  expect(html).toContain('type="password"');
  expect(html).not.toContain('固定会话按邮件线程继承纯文本结论');
  expect(html).not.toContain('通过浏览器登录 Moss Server');
});
