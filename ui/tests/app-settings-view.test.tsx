import { expect, test } from 'bun:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs';
import { resolveAppSettingsView, validateAppViewState } from '../src/apps/app-view-binding.mjs';
import { getAppPrimaryEntry, getAppUiEntry, getAppWorkspacePages, getVisibleAppSettingsEntries } from '../src/renderer-react/lib/app-navigation';
import { AppWorkspaceView } from '../src/renderer-react/components/app-workspace-view';
import { AppDetailsView } from '../src/renderer-react/components/app-details-view';
import type { StoredApp } from '../src/renderer-react/types';

const raw = { schemaVersion: 2, id: 'example.settings', version: '1.0.0', displayName: 'Example', hostApi: '^3.22.0',
  permissions: ['app:settings', 'app:view'], ui: { entry: 'index.html' }, navigation: { location: 'details' },
  contributes: { views: [{ id: 'connections', title: 'Connections', route: '#/connections', permission: 'app:view' }],
    settings: [{ id: 'manage', title: '连接管理', group: 'integrations', viewId: 'connections', permission: 'app:settings', presentation: { width: 'wide' } }] } };
const installation = { enabled: true, activeVersion: '1.0.0', grants: raw.permissions };
const input = { settingId: 'manage', version: '1.0.0' };

test('declared details preserve layout hints and require hosts that understand the contract', () => {
  const manifest = validateAppManifest(raw);
  expect(manifest.contributes.settings[0].presentation).toEqual({ width: 'wide' });
  for (const hostApi of ['^3.21.0', '>=3.0.0']) expect(() => validateAppManifest({ ...raw, hostApi })).toThrow();
  expect(() => validateAppManifest({ ...raw, navigation: { location: 'details', viewId: 'connections' } })).toThrow();
  expect(() => validateAppManifest({ ...raw, contributes: { ...raw.contributes, settings: [{ ...raw.contributes.settings[0], presentation: { width: 'arbitrary' } }] } })).toThrow();
});

test('Host resolves only declared routes and rejects stale versions, disabled Apps, or either missing grant', () => {
  expect(resolveAppSettingsView(raw, installation, { ...input, route: '#/injected' })).toEqual({ ...input, route: '#/connections' });
  for (const grants of [[], ['app:view'], ['app:settings']]) expect(() => resolveAppSettingsView(raw, { ...installation, grants }, input)).toThrow();
  expect(() => resolveAppSettingsView(raw, { ...installation, enabled: false }, input)).toThrow();
  expect(() => resolveAppSettingsView(raw, { ...installation, activeVersion: '2.0.0' }, input)).toThrow();
  expect(() => resolveAppSettingsView(raw, installation, { ...input, settingId: 'missing' })).toThrow();
  expect(() => resolveAppSettingsView(raw, installation, { ...input, version: undefined })).toThrow();
  expect(resolveAppSettingsView(raw, installation, {})).toBeNull();
  expect(validateAppViewState({ dirty: true, busy: false, embedId: 'injected' })).toEqual({ dirty: true, busy: false });
  expect(() => validateAppViewState({ dirty: 'true', busy: false })).toThrow();
});

test('custom UI has one header launch entry without embedding or individual setting launch rows', () => {
  const app = { ...raw, id: raw.id, name: raw.id, title: raw.displayName, currentVersion: raw.version, enabled: true,
    hasUi: true, grants: raw.permissions } as unknown as StoredApp;
  expect(getAppPrimaryEntry(app)?.location).toBe('info');
  expect(getVisibleAppSettingsEntries([app])).toEqual([]);
  const html = renderToStaticMarkup(<AppDetailsView app={app} onBack={() => {}} onTry={() => {}} onOpenApp={() => {}} onRefresh={async () => {}} />);
  expect(html).toContain('data-app-ui-open="example.settings"');
  expect(html).not.toContain('data-app-view-setting');
  expect(html).not.toContain('连接管理');
  expect(html.match(/<header[\s\S]*?<\/header>/)?.[0]).toMatch(/打开[\s\S]*试用/);
  expect(html).not.toContain('<webview');
  expect(html).not.toContain('<iframe');
});

test('settings remain openable while a configured Backend instance is disabled', () => {
  const app = { ...raw, name: raw.id, currentVersion: raw.version, enabled: true, hasUi: true, hasBackend: true,
    instances: [{ enabled: false }], grants: raw.permissions } as unknown as StoredApp;
  const html = renderToStaticMarkup(<AppDetailsView app={app} onBack={() => {}} onTry={() => {}} onOpenApp={() => {}} onRefresh={async () => {}} />);
  const row = html.match(/<button[^>]*data-app-ui-open="example.settings"[^>]*>/)?.[0];
  expect(row).toBeDefined(); expect(row).not.toContain('disabled=');
});


test('UI launch follows manifest routes across App types and never treats built-in MCP as custom UI', () => {
  const app = { ...raw, name: raw.id, currentVersion: raw.version, enabled: true, hasUi: true, grants: raw.permissions } as unknown as StoredApp;
  expect(getAppUiEntry(app)).toEqual({ route: '#/connections', unavailableReason: null });
  for (const patch of [{ uiBuiltin: 'mcp' }, { hasUi: false }, { navigation: { location: 'none' } }]) {
    expect(getAppUiEntry({ ...app, ...patch } as StoredApp)).toBeNull();
    const html = renderToStaticMarkup(<AppDetailsView app={{ ...app, ...patch } as StoredApp} onBack={() => {}} onTry={() => {}} onOpenApp={() => {}} onRefresh={async () => {}} />);
    expect(html).not.toContain('data-app-ui-open');
  }
  for (const location of ['more', 'settings'] as const) {
    expect(getAppUiEntry({ ...app, navigation: { location, viewId: 'connections' } })?.route).toBe('#/connections');
  }
  expect(getAppUiEntry({ ...app, navigation: undefined, contributes: undefined })?.route).toBe('');
  for (const patch of [{ enabled: false }, { packageStatus: 'invalid' }, { grants: ['app:view'] }, { grants: ['app:settings'] }]) {
    expect(getAppUiEntry({ ...app, ...patch } as StoredApp)?.unavailableReason).toBeTruthy();
  }
});


test('workspace keeps declared page order, page permissions and version; invalid routes cannot fall back', () => {
  const app = { ...raw, name: raw.id, currentVersion: raw.version, enabled: true, hasUi: true, grants: raw.permissions,
    contributes: { views: [...raw.contributes.views, { id: 'policy', title: '策略', route: '#/policy', permission: 'app:policy' }],
      settings: [{ ...raw.contributes.settings[0], order: 200 }, { id: 'policy', title: '策略', viewId: 'policy', group: 'apps' }] },
  } as unknown as StoredApp;
  expect(getAppWorkspacePages(app).map(page => page.settingId)).toEqual(['manage', 'policy']);
  expect(getAppWorkspacePages(app)[0]).toMatchObject({ version: '1.0.0', route: '#/connections' });
  expect(getAppUiEntry(app)?.route).toBe('#/connections');
  const render = (route: string) => renderToStaticMarkup(<AppWorkspaceView app={app} route={route} onBack={() => {}} onNavigate={() => {}} />);
  const html = render('#/connections');
  expect(html).toContain('data-app-workspace-page="connections" aria-current="page"');
  expect(html.match(/<button[^>]*data-app-workspace-page="policy"[^>]*>/)?.[0]).toContain('disabled=');
  for (const route of ['#/unknown', '#/policy']) {
    const unavailable = render(route);
    expect(unavailable).toContain('role="alert"');
    expect(unavailable).not.toContain('正在打开 App');
  }
});
