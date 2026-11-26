import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SettingsView } from '../src/renderer-react/components/settings-view';
import { normalizeDesktopSettings } from '../src/desktop-settings.mjs';
import type { DesktopSettings } from '../src/renderer-react/types';

function renderSettings(initialSection: 'basic-info' | 'memory', enabled?: boolean) {
  const settings = normalizeDesktopSettings(enabled === undefined ? {} : {
    sessionMemory: { enabled, compactEnabled: true },
  }) as DesktopSettings;
  return renderToStaticMarkup(<SettingsView
    settingsDraft={settings}
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
    initialSection={initialSection}
  />);
}

test('memory settings omit retired summaries even when legacy settings enabled them', () => {
  for (const enabled of [undefined, true, false]) {
    const html = renderSettings('memory', enabled);
    expect(html).not.toContain('会话摘要');
    expect(html).not.toContain('由模型按需调用工具保存');
    expect(html).not.toContain('上下文压缩策略');
    expect(html).toContain('长期记忆');
    for (const removed of ['初始化 token 阈值', '更新 token 间隔', '工具调用间隔', '压缩时使用会话记忆', '压缩保留 token', '压缩保留消息']) {
      expect(html).not.toContain(removed);
    }
    const summaryToggle = html.match(/<input[^>]*aria-label="会话摘要"[^>]*>/)?.[0];
    expect(summaryToggle).toBeUndefined();
  }
});

test('general settings offer both context compaction strategies', () => {
  const html = renderSettings('basic-info');
  expect(html).toContain('上下文压缩策略');
  expect(html).toContain('主动压缩（推荐）');
  expect(html).toContain('超限后压缩');
});
