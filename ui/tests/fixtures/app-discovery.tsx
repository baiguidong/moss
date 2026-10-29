import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AppsPanel } from '@/components/apps-panel';
import { EMPTY_APP_PREFERENCES } from '@/lib/app-discovery';
import type { StoredApp } from '@/types';
import '@/globals.css';
let preferences = structuredClone(EMPTY_APP_PREFERENCES);
const definitions = [
  ['moss.filesystem', '文件管理', 'local', 'none', '浏览、搜索和管理本地文件。'],
  ['moss.excel', 'Excel 表格', 'local', 'none', '读取表格、计算公式与整理数据。'],
  ['moss.database', '数据库', 'local', 'credentials', '连接本地或远程数据库，查询数据。'],
  ['moss.feishu-cli', '飞书工具', 'online', 'browser', '通过浏览器登录飞书，访问文档与业务工具。'],
  ['moss.tencent-map', '腾讯地图', 'online', 'api-key', '配置 API Key 后查询地图、路线和地理位置。'],
  ['moss.yunke-cli', '云客 CRM', 'online', 'browser', '使用 CLI 访问在线 CRM 服务。'],
  ['example.unknown', '自定义应用', 'unknown', '', '可在全部应用中找到未分类的应用。'],
];
const allApps = definitions.map(([id, title, group, auth, description]) => ({
  id, name: id, displayName: title, description, category: id === 'moss.filesystem' ? 'files' : ['moss.excel', 'moss.database'].includes(id) ? 'data' : id === 'moss.tencent-map' ? 'life' : id === 'moss.yunke-cli' ? 'sales' : group === 'online' ? 'communication' : 'other',
  ...(group !== 'unknown' ? { discovery: { group, kind: id === 'moss.database' ? 'app' : 'tool',
    capabilities: id === 'moss.database' ? [] : ['moss.feishu-cli', 'moss.yunke-cli'].includes(id) ? ['cli', 'skills'] : ['mcp'], authMethods: [auth] } } : {}),
  enabled: true, hasUi: group === 'local', currentVersion: '1.0.0', updatedAt: Date.now(),
  permissions: group === 'online' ? ['connector:use'] : [], grants: group === 'online' ? ['connector:use'] : [],
  ...(group === 'online' ? { connectorApp: { id: id === 'moss.feishu-cli' ? 'feishu' : id === 'moss.tencent-map' ? 'tencent-map' : 'yunke-cli', capabilities: id === 'moss.tencent-map' ? ['mcp'] : ['cli', 'skills'], connection: {
    id: id === 'moss.feishu-cli' ? 'feishu' : id === 'moss.tencent-map' ? 'tencent-map' : 'yunke-cli', name: title, enabled: true, connected: auth === 'browser', credentialsConfigured: false,
    hasMcp: id === 'moss.tencent-map', hasRemoteMcp: id === 'moss.tencent-map', hasCli: id !== 'moss.tencent-map', credentialSchema: auth === 'api-key' ? { fields: [{ key: 'key', type: 'password', label: 'API Key', required: true }] } : null,
  } } } : {}),
})) as StoredApp[];
let storedApps = new URLSearchParams(location.search).has('empty') ? [] : allApps.slice(0, 5);
const builtins = new URLSearchParams(location.search).has('builtins') ? [
  ['moss.visualize', '可视化', '创建和修改交互图表与演示。'],
  ['moss.document', '文档创作', '创作、修改和转换文档。'],
  ['moss.pdf', 'PDF 创作', '创建和整理 PDF，提取文字并检查页面。'],
  ['moss.spreadsheets', '表格', '创建和修改 Excel 表格，计算公式。'],
  ['moss.presentations', '演示文稿', '创建、预览和导出演示文稿。'],
  ['moss.templates', '模板', '保存模板并在会话中复用。'],
  ['moss.app-builder', '应用构建', '创建、预览和迭代自己的 App。'],
].map(([id, displayName, description]) => ({ id, displayName, description, version: '0.1.0', error: null })) : [];
const builtinApp = (item: typeof builtins[number]) => ({ ...item, name: item.id, title: item.displayName, builtin: true, enabled: true, currentVersion: '0.1.0' }) as StoredApp;
if (builtins.length) storedApps = [allApps[0], ...builtins.filter(item => item.id !== 'moss.pdf').map(builtinApp)];
const restores = { calls: [] as string[], mode: 'fail', finish: () => {} };
(window as any).__restores = restores;
(window as any).__opened = [];
const entries = allApps.map(app => ({
  ...app, summary: app.description, latestVersion: '1.0.0',
  platformCompatible: true, hostCompatible: true, categories: [], publisher: { name: 'Moss', id: 'moss' },
  latest: { version: '1.0.0', hostApi: '^3.15.0', permissions: app.permissions, platformCompatible: true, hostCompatible: true, artifact: { size: 1024, signed: true } },
}));
const marketInstalls: any[] = [];
(window as any).__marketInstalls = marketInstalls;
(window as any).agentDesktop = {
  listBuiltinApps: async () => builtins.map(item => ({ ...item, installed: storedApps.some(app => app.id === item.id) })),
  restoreBuiltinApp: async ({ id }: { id: string }) => {
    restores.calls.push(id);
    if (restores.mode === 'fail') return { ok: false, error: '测试恢复失败' };
    if (restores.mode === 'pending') await new Promise<void>(resolve => { restores.finish = resolve; });
    storedApps.push(builtinApp(builtins.find(item => item.id === id)!));
    return { ok: true };
  },
  onAppInstallProgress: () => () => {}, getAppInstallProgress: async () => [],
  appDiscovery: async (input: any) => {
    if (input.action === 'section') (preferences.sections as any)[input.surface] = input.section;
    return structuredClone(preferences);
  },
  setAppEnabled: async ({ appId, enabled }: any) => { storedApps = storedApps.map(app => app.id === appId ? { ...app, enabled } : app); },
  installAppArchive: async () => { (window as any).__archiveImports = ((window as any).__archiveImports || 0) + 1; return { ok: false, canceled: true }; },
  connectorApp: async ({ appId }: any) => ({ connector: storedApps.find(app => app.id === appId)?.connectorApp?.connection }),
  appMarketplace: {
    list: async () => ({ apps: entries, fetchedAt: Date.now(), generatedAt: new Date().toISOString(), hostApiVersion: '3.15.0' }),
    getDetails: async ({ appId }: any) => { const entry = entries.find(app => app.id === appId)!; return { ...entry, versions: [entry.latest, { ...entry.latest, version: '0.9.0' }] }; },
    install: async (payload: any) => { marketInstalls.push(payload); if (!payload.acceptPermissions) return { requiresPermissionApproval: true, permissions: ['connector:use'] }; storedApps.push({ ...allApps.find(app => app.id === payload.appId)!, currentVersion: payload.version }); return { ok: true }; },
  },
};
function Fixture() {
  const [apps, setApps] = React.useState(storedApps);
  return <main className="h-screen overflow-hidden"><AppsPanel apps={apps} onLaunch={name => (window as any).__opened.push(name)} onRefresh={async () => setApps([...storedApps])} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
