import { describe, expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs';
import { collectManifestContributions } from '../../packages/app-runtime/src/contributions/index.mjs';
import { getAppPrimaryEntry, getAppSettingsEntries, getVisibleAppSettingsEntries, isAppSharedSettingsRoute } from '../src/renderer-react/lib/app-navigation';
import { getSidebarMoreApps } from '../src/renderer-react/components/app-sidebar';
import { SettingsView } from '../src/renderer-react/components/settings-view';
import { normalizeDesktopSettings } from '../src/desktop-settings.mjs';
import type { DesktopSettings, StoredApp } from '../src/renderer-react/types';

const base = { schemaVersion: 2, id: 'test.navigation', version: '1.0.0', displayName: '配置工具', hostApi: '^3.4.0',
  permissions: ['app:settings', 'app:view'], ui: { entry: 'index.html' },
  navigation: { location: 'settings', viewId: 'configuration' },
  contributes: { views: [{ id: 'configuration', title: 'Configuration', route: '#/settings', permission: 'app:view' }],
    settings: [{ id: 'preferences', title: '配置工具', viewId: 'configuration', group: 'tools', permission: 'app:settings' }] } };
function manifest(patch: Record<string, any> = {}) { return validateAppManifest({ ...structuredClone(base), ...patch }); }
function stored(patch: Partial<StoredApp> = {}): StoredApp {
  const m = manifest();
  return { ...m, name: m.id, title: m.displayName, hasUi: true, enabled: true, grants: m.permissions,
    currentVersion: m.version, ...patch } as StoredApp;
}

describe('App navigation contract', () => {
  test('preserves navigation and settings group in normalization and contribution projection', () => {
    const m = manifest();
    expect(m.navigation).toEqual(base.navigation);
    expect(collectManifestContributions(m, { grants: m.permissions }).settings[0].group).toBe('tools');
    expect(base.contributes.settings[0].group).toBe('tools');
  });
  test('legacy loading remains compatible, but new builds require an explicit choice', () => {
    const old = { ...base, hostApi: '^3.0.0', navigation: undefined, contributes: undefined };
    expect(validateAppManifest(old).navigation).toBeUndefined();
    expect(() => validateAppManifest(old, { requireNavigation: true })).toThrow('explicitly declare navigation');
  });
  test.each(['^3.0.0', '>=3.3.0', '^3.3.0 || ^4.0.0'])('rejects navigation on hosts that can ignore it: %s', hostApi => {
    expect(() => manifest({ hostApi })).toThrow('3.4.0');
  });
  test.each([
    { navigation: { location: 'sidebar' } },
    { navigation: { location: 'none', viewId: 'configuration' } },
    { navigation: { location: 'more', viewId: 'missing' } },
    { navigation: { location: 'settings' } },
    { navigation: { location: 'none' } },
    { navigation: { location: 'more', viewId: 'configuration' } },
    { ui: undefined },
  ])('rejects invalid navigation or duplicate operational/configuration pages: %j', patch => {
    expect(() => manifest(patch)).toThrow();
  });
  test('requires valid groups and settings references; rejects duplicate routes even with different view IDs', () => {
    for (const group of [undefined, 'advanced']) {
      const raw = structuredClone(base); raw.contributes.settings[0].group = group as any;
      expect(() => validateAppManifest(raw)).toThrow();
    }
    const raw = structuredClone(base);
    raw.contributes.views.push({ ...raw.contributes.views[0], id: 'duplicate' });
    raw.contributes.settings.push({ ...raw.contributes.settings[0], id: 'duplicate-settings', viewId: 'duplicate' });
    expect(() => validateAppManifest(raw)).toThrow('more than once');
    expect(() => manifest({ contributes: { ...base.contributes, settings: [] } })).toThrow('exactly one');
  });
  test('supports separate operational/configuration pages and background global tools', () => {
    const m = manifest({ navigation: { location: 'more', viewId: 'home' }, contributes: { ...base.contributes,
      views: [...base.contributes.views, { id: 'home', title: 'Home', route: '#/' }] } });
    expect(m.navigation?.location).toBe('more');
    const background = manifest({ ui: undefined, navigation: { location: 'none' }, contributes: undefined, toolScope: 'global',
      backend: { entry: 'backend.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'persistent', actions: [] } });
    expect(background.toolScope).toBe('global');
  });
});

describe('App navigation projection', () => {
  test('retires injected shared settings while keeping declared business settings and legacy workspaces', () => {
    const app = stored({ navigation: { location: 'more', viewId: 'home' }, contributes: {
      views: [
        { id: 'home', title: '资料', route: '#/' },
        { id: 'moss-settings', title: '通用设置', route: '#/moss-settings', order: -1000 },
        { id: 'engine', title: '检索引擎', route: '#/engine-settings', permission: 'engine:manage' },
      ],
      settings: [
        { id: 'shared-settings', title: '通用设置', viewId: 'moss-settings', group: 'apps', order: -1000 },
        { id: 'engine', title: '检索引擎', viewId: 'engine', group: 'apps' },
      ],
    } });
    expect(getAppSettingsEntries([app])).toMatchObject([{ settingId: 'engine', route: '#/engine-settings', unavailableReason: expect.any(String) }]);
    expect(getAppPrimaryEntry(app)).toMatchObject({ location: 'more', route: '#/' });
    expect(getAppPrimaryEntry({ ...app, navigation: undefined })).toMatchObject({ location: 'more', route: '#/' });
    expect(getAppPrimaryEntry({ ...app, navigation: { location: 'settings', viewId: 'moss-settings' } })).toMatchObject({ location: 'info' });
    expect(isAppSharedSettingsRoute('#/moss-settings?tab=tools')).toBe(true);
    expect(isAppSharedSettingsRoute('#/engine-settings')).toBe(false);
    expect(isAppSharedSettingsRoute('#/settings')).toBe(false);
  });

  test('More uses only explicit operational pages and never falls back from a restricted view', () => {
    const app = stored();
    expect(getSidebarMoreApps([app, stored({ navigation: { location: 'none' }, contributes: undefined })])).toEqual([]);
    const operational = stored({ navigation: { location: 'more', viewId: 'home' }, contributes: {
      views: [{ id: 'home', title: 'Home', route: '#/home', permission: 'app:view' }] } });
    expect(getSidebarMoreApps([operational])[0].route).toBe('#/home');
    expect(getSidebarMoreApps([{ ...operational, grants: [] }])).toEqual([]);
    expect(getSidebarMoreApps([{ ...operational, navigation: undefined, grants: [] }])).toEqual([]);
    expect(getSidebarMoreApps([stored({ navigation: undefined, contributes: undefined })])[0].route).toBe('');
  });
  test('settings survive stopped/crashed or unconfigured Backends; unavailable entries stay in management only', () => {
    expect(getVisibleAppSettingsEntries([stored({ runtimeStatus: { state: 'error' }, instances: [] })])[0].unavailableReason).toBeNull();
    for (const patch of [{ enabled: false }, { packageStatus: 'invalid' }, { packageStatus: 'incompatible' }, { grants: ['app:view'] }, { grants: ['app:settings'] }]) {
      expect(getAppSettingsEntries([stored(patch as Partial<StoredApp>)])[0].unavailableReason).toBeTruthy();
      expect(getVisibleAppSettingsEntries([stored(patch as Partial<StoredApp>)])).toEqual([]);
    }
    for (const navigation of [undefined, { location: 'none' }, { location: 'more', viewId: 'home' }] as const) {
      expect(getVisibleAppSettingsEntries([stored({ navigation })])).toEqual([]);
    }
    expect(getVisibleAppSettingsEntries([stored({ hasUi: false })])).toEqual([]);
    expect(getVisibleAppSettingsEntries([stored()])).toHaveLength(1);
  });
  test('IDs are scoped by App, missing groups use apps, and the primary settings page resolves explicitly', () => {
    const a = stored(); const b = stored({ id: 'another.app', name: 'another.app', navigation: undefined,
      contributes: { views: base.contributes.views, settings: [{ ...base.contributes.settings[0], group: undefined }] } });
    const entries = getAppSettingsEntries([a, b]);
    expect(new Set(entries.map(entry => entry.id)).size).toBe(2);
    expect(entries.find(entry => entry.appId === b.id)?.group).toBe('apps');
    expect(getAppPrimaryEntry(a)).toMatchObject({ location: 'settings', route: '#/settings', settingsId: 'app:test.navigation/preferences' });
  });
  test('Core-hosted MCP Apps open plugin details and keep their editor out of global settings', () => {
    const app = stored({ id: 'moss.drawio', name: 'moss.drawio', uiBuiltin: 'mcp' });
    expect(getAppSettingsEntries([app])[0].route).toBe('#/settings');
    expect(getAppPrimaryEntry(app)).toMatchObject({ location: 'info', unavailableReason: null });
    expect(getVisibleAppSettingsEntries([app])).toEqual([]);
    expect(getSidebarMoreApps([app])).toEqual([]);
    for (const patch of [{ enabled: false }, { packageStatus: 'invalid' }, { packageStatus: 'incompatible' }]) {
      expect(getAppPrimaryEntry({ ...app, ...patch } as StoredApp)).toMatchObject({ location: 'info', unavailableReason: null });
    }
  });
  test('Settings embeds only the selected App and retains navigation and recovery access', () => {
    const props = { settingsDraft: normalizeDesktopSettings({}) as DesktopSettings, setSettingsDraft: () => {}, settingsNotice: '',
      autoSaveSettings: async () => {}, autoSaveImageSettings: async () => {}, themeMode: 'light' as const, setThemeMode: () => {},
      cssThemeId: 'default', setCssThemeId: () => {}, onToolDisplayModeChange: () => {}, onAppearancePreview: () => {},
      onAppearanceCommit: () => {}, onOpenAppManagement: () => {} };
    const a = stored({ agentTools: [{ id: 'query', title: 'Query', description: '', effect: 'read' }], contributes: {
      ...base.contributes,
      views: [...base.contributes.views, { id: 'appearance', title: '外观偏好', route: '#/appearance' }],
      settings: [...base.contributes.settings, { id: 'appearance', title: '外观偏好', viewId: 'appearance', group: 'apps' }],
    } });
    const html = renderToStaticMarkup(<SettingsView {...props} apps={[a]} initialAppSettingId="app:test.navigation/preferences" />);
    expect(html).toContain('data-selected-app-setting="app:test.navigation/preferences"');
    expect(html).toContain('应用管理');
    expect(html).not.toContain('data-app-settings=');
    expect(html).toContain('data-app-setting="app:test.navigation/appearance"');
    expect(html).not.toContain('Moss 内置工具');
    expect(html).toMatch(/data-settings-nav="apps" aria-current="page"/);
    expect(html).not.toMatch(/data-settings-nav="tools" aria-current="page"/);
    expect(html).not.toContain('连接与集成');
    const tools = renderToStaticMarkup(<SettingsView {...props} apps={[a]} initialSection="tools" />);
    expect(tools).toContain('Moss 内置工具');
    expect(tools).toContain('aria-label="connector_cli_setup 常驻"');
    expect(tools).toMatch(/data-settings-nav="tools" aria-current="page"/);
    expect(tools).not.toContain('data-selected-app-setting');
    expect(tools).not.toContain('data-app-settings-group');
    const disabled = renderToStaticMarkup(<SettingsView {...props} apps={[{ ...a, enabled: false }]} initialAppSettingId="app:test.navigation/preferences" />);
    expect(disabled).not.toContain('data-selected-app-setting');
    expect(disabled).not.toContain('data-app-setting=');
    expect(disabled).not.toContain('需在应用管理中处理');
    expect(disabled).not.toContain('正在打开 App');
  });
});
