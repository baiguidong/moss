import type { AppSettingsGroup } from '../../../../packages/app-sdk/src/index.mjs';
import type { StoredApp } from '../types';
import { supportsHostFeature } from './host-environment';

export const APP_SETTINGS_GROUPS: Record<AppSettingsGroup, string> = {
  integrations: '连接与集成', tools: '工具', apps: '其他应用设置',
};

export type AppSettingsEntry = {
  id: string;
  appId: string;
  appName: string;
  appTitle: string;
  appIcon?: string;
  title: string;
  group: AppSettingsGroup;
  viewId: string;
  settingId: string;
  route: string;
  order: number;
  keywords: string[];
  unavailableReason: string | null;
  version: string;
};

export function usesBuiltinMcpUi(app: StoredApp) {
  return app.uiBuiltin === 'mcp' || (app as StoredApp & { manifest?: { ui?: { builtin?: string } } }).manifest?.ui?.builtin === 'mcp';
}

/** Reserved route injected by older @moss/app-settings bundles. */
export function isAppSharedSettingsRoute(route: string) {
  return route.split('?', 1)[0] === '#/moss-settings';
}

export function appPageUnavailableReason(app: StoredApp, ...permissions: Array<string | undefined>) {
  if (!supportsHostFeature('embeddedApps')) return '此 Host 尚未提供 App 页面。';
  if (app.packageStatus === 'incompatible') return '此 App 与当前 Moss 不兼容，请在应用管理中更新版本。';
  if (app.packageStatus === 'invalid') return '此 App 安装包不可用，请在应用管理中重新安装。';
  if (!app.enabled) return '此 App 已停用，请先在应用管理中启用。';
  if (permissions.some(permission => permission && !app.grants?.includes(permission))) return '此页面尚未授权，请在应用管理中授予所需权限。';
  return null;
}

export function getAppSettingsEntries(apps: StoredApp[]): AppSettingsEntry[] {
  return apps.flatMap(app => {
    if (!app.hasUi || app.navigation?.location === 'none') return [];
    const appId = app.id || app.name;
    return (app.contributes?.settings || []).flatMap(setting => {
      if (!setting.viewId) return [];
      const view = app.contributes?.views?.find(item => item.id === setting.viewId);
      if (!view || isAppSharedSettingsRoute(view.route || '')) return [];
      return [{
        id: `app:${encodeURIComponent(appId)}/${encodeURIComponent(setting.id)}`,
        appId, appName: app.name, appTitle: app.displayName || app.title || app.name, appIcon: app.icon,
        title: setting.title, group: setting.group || 'apps', viewId: view.id, settingId: setting.id,
        // Built-in MCP configuration is rendered by Core in plugin details.
        route: usesBuiltinMcpUi(app) ? '#/settings' : view.route || '#/', order: setting.order || 0,
        keywords: app.keywords || [],
        unavailableReason: appPageUnavailableReason(app, setting.permission, view.permission),
        version: app.currentVersion || app.currentVersionId || '',
      }];
    });
  }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
}

export function getVisibleAppSettingsEntries(apps: StoredApp[]): AppSettingsEntry[] {
  return getAppSettingsEntries(apps.filter(app => app.enabled && app.navigation?.location === 'settings' && !usesBuiltinMcpUi(app)))
    .filter(entry => !entry.unavailableReason);
}

/** Resolve the actual App UI separately from its Core details entry. */
export function getAppUiEntry(app: StoredApp) {
  if (!app.hasUi || usesBuiltinMcpUi(app) || app.navigation?.location === 'none') return null;
  if (app.navigation?.location === 'details') {
    const entries = getAppWorkspacePages(app);
    const entry = entries.find(item => !item.unavailableReason) || entries[0];
    return entry ? { route: entry.route, unavailableReason: entry.unavailableReason } : null;
  }
  const entry = getAppPrimaryEntry(app);
  return entry && entry.location !== 'info' ? entry : null;
}

/** Page order inside one App follows its declaration, not global Settings ranking. */
export function getAppWorkspacePages(app: StoredApp) {
  const entries = getAppSettingsEntries([app]);
  return (app.contributes?.settings || []).flatMap(setting => {
    const entry = entries.find(item => item.settingId === setting.id);
    return entry ? [entry] : [];
  });
}

export function getAppPrimaryEntry(app: StoredApp) {
  if (!app.hasUi || usesBuiltinMcpUi(app) || app.navigation?.location === 'details') return { location: 'info' as const, route: '', unavailableReason: null };
  if (app.navigation?.location === 'none') return null;
  if (app.navigation?.location === 'settings') {
    const primary = app.contributes?.views?.find(view => view.id === app.navigation?.viewId);
    if (primary && isAppSharedSettingsRoute(primary.route || '')) return { location: 'info' as const, route: '', unavailableReason: null };
    const entry = getAppSettingsEntries([app]).find(item => item.viewId === app.navigation?.viewId);
    return entry ? { location: 'settings' as const, route: entry.route, settingsId: entry.id, unavailableReason: entry.unavailableReason } : null;
  }
  const views = (app.contributes?.views || []).filter(view => !isAppSharedSettingsRoute(view.route || ''));
  const view = app.navigation
    ? views.find(item => item.id === app.navigation?.viewId)
    : [...views].filter(item => !item.permission || app.grants?.includes(item.permission))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id))[0];
  // Only legacy Apps without any view declarations can fall back to their root page.
  if (!view && (app.navigation || views.length)) return null;
  return { location: 'more' as const, route: view?.route || '', unavailableReason: appPageUnavailableReason(app, view?.permission) };
}
