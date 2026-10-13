import type { AppSettingsGroup } from '../../../../packages/app-sdk/src/index.mjs';
import type { StoredApp } from '../types';

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
  route: string;
  order: number;
  keywords: string[];
  unavailableReason: string | null;
  version: string;
};

export function appPageUnavailableReason(app: StoredApp, ...permissions: Array<string | undefined>) {
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
      const view = app.contributes?.views?.find(item => item.id === setting.viewId);
      if (!view) return [];
      return [{
        id: `app:${encodeURIComponent(appId)}/${encodeURIComponent(setting.id)}`,
        appId, appName: app.name, appTitle: app.displayName || app.title || app.name, appIcon: app.icon,
        title: setting.title, group: setting.group || 'apps', viewId: view.id,
        route: view.route || '#/', order: setting.order || 0,
        keywords: app.keywords || [],
        unavailableReason: appPageUnavailableReason(app, setting.permission, view.permission),
        version: app.currentVersion || app.currentVersionId || '',
      }];
    });
  }).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title, 'zh-CN') || a.id.localeCompare(b.id));
}

export function getVisibleAppSettingsEntries(apps: StoredApp[]): AppSettingsEntry[] {
  return getAppSettingsEntries(apps.filter(app => app.enabled && app.navigation?.location === 'settings'))
    .filter(entry => !entry.unavailableReason);
}

export function getAppToolbarSettingsEntry(app: StoredApp): AppSettingsEntry | undefined {
  // MCP tools can be discovered after connection, so use the declared capability.
  const hasTools = Boolean(app.agentTools?.length || app.contributes?.tools?.length
    || app.permissions?.some(permission => permission === 'mcp:connect' || permission === 'mcp:manage'));
  return hasTools ? getAppSettingsEntries([app])[0] : undefined;
}

export function getAppPrimaryEntry(app: StoredApp) {
  if (!app.hasUi || app.navigation?.location === 'none') return null;
  if (app.navigation?.location === 'settings') {
    const entry = getAppSettingsEntries([app]).find(item => item.viewId === app.navigation?.viewId);
    return entry ? { location: 'settings' as const, route: entry.route, settingsId: entry.id, unavailableReason: entry.unavailableReason } : null;
  }
  const views = app.contributes?.views || [];
  const view = app.navigation
    ? views.find(item => item.id === app.navigation?.viewId)
    : [...views].filter(item => !item.permission || app.grants?.includes(item.permission))
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.id.localeCompare(b.id))[0];
  // Only legacy Apps without any view declarations can fall back to their root page.
  if (!view && (app.navigation || views.length)) return null;
  return { location: 'more' as const, route: view?.route || '', unavailableReason: appPageUnavailableReason(app, view?.permission) };
}
