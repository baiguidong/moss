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
    agentTeamsEnabled: true,
    bypassPermissions: false,
    model: 'gpt-5.5',
    maxTurns: 100,
    language: 'chinese',
    appendSystemPrompt: '',
    thinkingMode: 'adaptive',
    thinkingBudgetTokens: 16_000,
    url: '',
    apiKey: 'text-model-secret',
    webSearch: {
      mode: 'auto',
      tavilyConfigured: true,
      braveConfigured: false,
      nativeCapability: {
        status: 'supported',
        format: 'structured',
        checkedAt: 1,
        reasonCode: null,
      },
      activeProvider: 'tavily',
    },
    image: { provider: 'minimax', url: '', apiKey: '', model: '' },
    appearance: {
      themeMode: 'system',
      cssThemeId: 'default',
      toolDisplayMode: 'expanded',
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
      onToolDisplayModeChange={() => {}}
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
  expect(html).toContain('Agent Teams 智能体团队');
  expect(html).toContain('aria-label="启用 Agent Teams"');
  expect(html).toContain('aria-label="回复语言"');
  expect(html).toContain('aria-label="网页搜索方式"');
  expect(html).toContain('当前生效：Tavily');
  expect(html).toContain('已检测到当前 endpoint 原生搜索可用');
  expect(html).toContain('aria-label="重新检测原生搜索"');
  expect(html).toContain('<option value="chinese" selected="">中文</option>');
  expect(html).toContain('type="password"');
  expect(html).not.toContain('固定会话按邮件线程继承纯文本结论');
  expect(html).not.toContain('通过浏览器登录 Moss Server');
  expect(html).not.toContain('飞书');
  expect(html).not.toContain('App Secret');
});
