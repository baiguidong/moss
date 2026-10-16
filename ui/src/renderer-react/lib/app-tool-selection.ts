import * as React from 'react';
import type { StoredApp } from '@/types';
import { filterApps, groupApps } from '@/lib/app-categories';
import { getAppToolServices, parseAppServiceKey, type AppToolService } from '../../../../packages/app-sdk/src/tool-services.mjs';
export { getAppToolServices, parseAppServiceKey };

export const AppToolSelectionContext = React.createContext<{
  apps: StoredApp[];
  selectedIds: string[];
  selectedServiceIds?: string[];
  enabled: boolean;
  pending: boolean;
  nextTurn: boolean;
  toggle: (id: string) => void;
  toggleService?: (id: string) => void;
  setServices?: (appId: string, ids: string[]) => void;
  openManager: () => void;
}>({ apps: [], selectedIds: [], enabled: false, pending: false, nextTurn: false, toggle: () => {}, openManager: () => {} });

export const toolAppId = (app: StoredApp) => app.id || app.name;
export const toolAppTitle = (app: StoredApp) => app.displayName || app.title || app.name;
export function hasAppTools(app: StoredApp) {
  return Boolean(app.contributes?.skills?.length || app.agentTools?.length || app.mcpServices?.length);
}
export function canSelectToolApp(app: StoredApp) {
  if (app.toolSelection === 'services') return getAppToolServices(app).some(service => service.available);
  return Boolean(app.enabled && (app.contributes?.skills?.length || app.agentTools?.some(tool => !tool.permission || app.grants?.includes(tool.permission)) ||
    app.mcpServices?.some(service =>
      // Tools are discovered lazily; an unchecked service is not an empty one.
      ['unchecked', 'authorized'].includes(service.status) ||
      (service.status === 'connected' && service.tools.some(tool => !tool.disabled)))));
}

export type ToolPickerItem = {
  id: string; app: StoredApp; service?: AppToolService; title: string; description: string;
  selected: boolean; available: boolean; expandable: boolean;
};

export function getToolPickerItems(apps: StoredApp[], query: string, selectedIds: string[] = [], selectedServiceIds: string[] = [], parentId?: string | null, category = 'all'): ToolPickerItem[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (...values: string[]) => terms.every(term => values.join(' ').toLocaleLowerCase().includes(term));
  const result: ToolPickerItem[] = [];
  for (const app of groupApps(filterApps(apps, '', category)).flatMap(group => group.apps)) {
    const appId = toolAppId(app);
    if (parentId && parentId !== appId) continue;
    const services = getAppToolServices(app);
    for (const id of selectedServiceIds) {
      const ref = parseAppServiceKey(id);
      if (ref?.appId === appId && !services.some(service => service.id === id)) services.push({ id, ...ref, title: '已移除的服务', description: ref.serviceId, available: false, toolCount: 0, status: 'removed' });
    }
    const selectedCount = services.filter(service => selectedServiceIds.includes(service.id)).length;
    const expandable = app.toolSelection === 'services';
    if (!parentId && (canSelectToolApp(app) || selectedIds.includes(appId) || selectedCount > 0)
      && filterApps([app], query).length) result.push({ id: appId, app, title: toolAppTitle(app),
        description: expandable ? `已选 ${selectedCount} / ${services.length} 个服务 · ${app.description || '选择具体服务'}` : toolAppDescription(app),
        selected: selectedIds.includes(appId), available: canSelectToolApp(app), expandable });
    if (expandable && (parentId || terms.length)) for (const service of services) {
      const selected = selectedServiceIds.includes(service.id);
      if (!service.available && !selected) continue;
      if (!matches(service.title, service.description, toolAppTitle(app), app.description || '')) continue;
      const state = !service.available ? '不可用' : ['unchecked', 'authorized'].includes(service.status) ? '工具待发现' : `${service.toolCount} 个工具`;
      result.push({ id: service.id, app, service, title: service.title,
        description: `${toolAppTitle(app)} · ${state}${service.description ? ` · ${service.description}` : ''}`,
        selected, available: service.available, expandable: false });
    }
  }
  return result;
}
export function toolAppDescription(app: StoredApp) {
  const services = app.mcpServices || [];
  const count = (app.agentTools?.length || 0) + services.reduce((n, service) => n + service.tools.filter(tool => !tool.disabled).length, 0);
  const waiting = services.some(service => ['unchecked', 'authorized'].includes(service.status));
  const unavailable = !canSelectToolApp(app);
  const needsGrant = app.agentTools?.some(tool => tool.permission && !app.grants?.includes(tool.permission)) || services.some(service => service.status === 'unauthorized');
  const status = !app.enabled ? 'App 已停用'
    : unavailable ? needsGrant ? '工具需要授权' : '工具服务已停用或未配置'
    : waiting ? 'MCP 工具数量待发现' : app.contributes?.skills?.length ? `${app.contributes.skills.length} 个 CLI skill${count ? ` · ${count} 个工具` : ''}` : `${count} 个工具`;
  return `${app.toolScope === 'global' ? '全局' : '指定'} · ${status}${app.description ? ` · ${app.description}` : ''}`;
}
export function filterToolApps(apps: StoredApp[], query: string, selectedIds: string[] = [], category = 'all') {
  return groupApps(filterApps(apps.filter(app => canSelectToolApp(app) || selectedIds.includes(toolAppId(app))), query, category))
    .flatMap(group => group.apps);
}
