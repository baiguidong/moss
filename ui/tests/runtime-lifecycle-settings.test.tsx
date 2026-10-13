import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_RUNTIME_LIFECYCLE, normalizeRuntimeLifecycle } from '../src/runtime-lifecycle-settings.mjs';
import { createDesktopSettingsStore, normalizeDesktopSettings } from '../src/desktop-settings.mjs';
import { RuntimeLifecycleSettingsRows } from '../src/renderer-react/components/settings-view';

test('lifecycle defaults, partial updates, bounds, and persisted reload use the same policy', () => {
  expect(normalizeDesktopSettings({}).runtimeLifecycle).toEqual({ sessionIdleMinutes: 60, maxSessionRuntimes: 15, mcpIdleMinutes: 60 });
  const previous = { sessionIdleMinutes: 120, maxSessionRuntimes: 20, mcpIdleMinutes: 90 };
  expect(normalizeRuntimeLifecycle({ sessionIdleMinutes: 0, maxSessionRuntimes: Infinity, mcpIdleMinutes: -1 }, previous)).toEqual(previous);
  expect(normalizeRuntimeLifecycle({ maxSessionRuntimes: 2 }, previous)).toEqual({ ...previous, maxSessionRuntimes: 2 });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-lifecycle-settings-'));
  try {
    const settingsPath = path.join(root, 'settings.json'), store = createDesktopSettingsStore({ settingsPath });
    store.save({ ...store.value, runtimeLifecycle: previous });
    const reloaded = createDesktopSettingsStore({ settingsPath });
    expect(reloaded.getPayload().runtimeLifecycle).toEqual(previous);
    reloaded.save({ ...reloaded.value, runtimeLifecycle: { maxSessionRuntimes: 12 } });
    expect(createDesktopSettingsStore({ settingsPath }).value.runtimeLifecycle).toEqual({ ...previous, maxSessionRuntimes: 12 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('settings expose the requested defaults and explain automatic recovery and state retention', () => {
  const html = renderToStaticMarkup(<RuntimeLifecycleSettingsRows value={DEFAULT_RUNTIME_LIFECYCLE} onChange={() => {}} />);
  expect(html).toContain('会话运行时空闲回收'); expect(html).toContain('最多保留会话运行时'); expect(html).toContain('MCP 服务空闲回收');
  expect(html).toContain('value="60"'); expect(html).toContain('value="15"');
  expect(html).toContain('下次发送消息自动恢复'); expect(html).toContain('未声明可安全重启');
});
