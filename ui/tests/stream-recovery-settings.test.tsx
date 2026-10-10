import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDesktopSettingsStore, normalizeDesktopSettings } from '../src/desktop-settings.mjs';
import { SettingsView } from '../src/renderer-react/components/settings-view';
import type { DesktopSettings } from '../src/renderer-react/types';
import { normalizeAdvancedSettings } from '../../packages/direct-connect-protocol/src/index';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('existing settings keep recovery enabled even when streaming tools are enabled', () => {
  const legacy = { moss_streaming_tool_execution: true };
  expect(normalizeDesktopSettings({ advanced: legacy }).advanced).toMatchObject({
    ...legacy, moss_disable_nonstreaming_fallback: false,
  });
  expect(normalizeAdvancedSettings(legacy)).toMatchObject({
    ...legacy, moss_disable_nonstreaming_fallback: false,
  });
});

test('persists the recovery opt-out independently across updates and restarts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-recovery-settings-'));
  roots.push(root);
  const settingsPath = path.join(root, 'settings.json');
  let store = createDesktopSettingsStore({ settingsPath });
  expect(store.value.advanced.moss_disable_nonstreaming_fallback).toBe(false);
  store.save({ advanced: { moss_streaming_tool_execution: true } });
  expect(store.value.advanced.moss_disable_nonstreaming_fallback).toBe(false);
  store.save({ advanced: { moss_disable_nonstreaming_fallback: true } });
  expect(store.value.advanced.moss_streaming_tool_execution).toBe(true);
  store = createDesktopSettingsStore({ settingsPath });
  expect(store.value.advanced.moss_disable_nonstreaming_fallback).toBe(true);
  store.save({ advanced: { moss_streaming_tool_execution: false } });
  expect(store.value.advanced.moss_disable_nonstreaming_fallback).toBe(true);
  store.save({ advanced: { moss_disable_nonstreaming_fallback: false } });
  expect(createDesktopSettingsStore({ settingsPath }).value.advanced).toMatchObject({
    moss_streaming_tool_execution: false, moss_disable_nonstreaming_fallback: false,
  });
});

test.each([false, true])('shows independent recovery and streaming controls (recovery disabled: %s)', disabled => {
  const html = renderToStaticMarkup(<SettingsView
    settingsDraft={normalizeDesktopSettings({ advanced: {
      moss_streaming_tool_execution: !disabled,
      moss_disable_nonstreaming_fallback: disabled,
    } }) as DesktopSettings}
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
    initialSection="tool-performance"
  />);
  const recoveryToggle = html.match(/<input[^>]*aria-label="禁止失败恢复"[^>]*>/)?.[0];
  const streamingToggle = html.match(/<input[^>]*aria-label="流式工具执行"[^>]*>/)?.[0];
  expect(recoveryToggle).toBeDefined();
  expect(streamingToggle).toBeDefined();
  expect(recoveryToggle!.includes('checked=""')).toBe(disabled);
  expect(streamingToggle!.includes('checked=""')).toBe(!disabled);
});
