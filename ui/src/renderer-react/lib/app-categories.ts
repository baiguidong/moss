import { getAppDiscovery, getAppKind, getAppToolCapabilities } from '../../../../packages/app-sdk/src/discovery.mjs';
import type { AppDiscovery } from '../../../../packages/app-sdk/src/index.mjs';
import { APP_CATEGORIES, getAppCategory, getAppCategoryForApp } from '../../../../packages/app-sdk/src/categories.mjs';

export { APP_CATEGORIES, getAppCategory, getAppCategoryForApp };

type DiscoverableApp = {
  id?: string; name?: string; displayName?: string; title?: string;
  description?: string; summary?: string; category?: string;
  keywords?: string[]; categories?: string[]; featured?: boolean;
  discovery?: AppDiscovery | { group: 'unknown' };
};

const title = (app: DiscoverableApp) => app.displayName || app.title || app.name || app.id || '';

export function filterApps<T extends DiscoverableApp>(apps: T[], query: string, category = 'all', options: { kind?: string; group?: string; capability?: string } = {}): T[] {
  const terms = query.trim().toLocaleLowerCase('zh-CN').split(/\s+/).filter(Boolean);
  return apps.filter(app => {
    const group = getAppCategoryForApp(app);
    const discovery = getAppDiscovery(app);
    const kind = getAppKind(app);
    const capabilities = getAppToolCapabilities(app);
    if (options.kind && options.kind !== 'all' && kind !== options.kind) return false;
    if (options.capability && options.capability !== 'all' && !capabilities.includes(options.capability as 'mcp' | 'cli' | 'skills')) return false;
    if (options.group && options.group !== 'all' && discovery.group !== options.group) return false;
    if (category !== 'all' && group.id !== category) return false;
    const searchable = [title(app), app.id, app.name, app.description, app.summary, group.id, group.label,
      kind === 'tool' ? '工具' : kind === 'app' ? '应用' : '', discovery.group === 'online' ? '在线' : discovery.group === 'local' ? '本地' : '', ...capabilities,
      ...(app.keywords || []), ...(app.categories || [])].join(' ').toLocaleLowerCase('zh-CN');
    return terms.every(term => searchable.includes(term));
  });
}

export function groupApps<T extends DiscoverableApp>(apps: T[]) {
  const buckets = new Map<string, T[]>();
  for (const app of apps) {
    const id = getAppCategoryForApp(app).id;
    const items = buckets.get(id) || [];
    items.push(app);
    buckets.set(id, items);
  }
  return APP_CATEGORIES.filter(category => buckets.has(category.id)).map(category => ({
    ...category,
    apps: buckets.get(category.id)!.sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured))
      || title(a).localeCompare(title(b), 'zh-CN', { numeric: true })
      || (a.id || a.name || '').localeCompare(b.id || b.name || '')),
  }));
}
