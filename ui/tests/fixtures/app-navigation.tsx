import React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsView } from '../../src/renderer-react/components/settings-view';
import { AppsPanel } from '../../src/renderer-react/components/apps-panel';
import { getAppPrimaryEntry, getAppSettingsEntries } from '../../src/renderer-react/lib/app-navigation';
import type { StoredApp } from '../../src/renderer-react/types';
import '../../src/renderer-react/globals.css';

const config = await fetch('/navigation-fixture-config').then(response => response.json());
const makeApp = (id: string, title: string, group: 'tools' | 'integrations' | 'apps') => ({
  id, name: id, displayName: title, title, description: 'App 配置页面', category: 'automation',
  hasUi: true, enabled: true, currentVersion: '1.0.0', updatedAt: 0, keywords: [id === 'computer' ? 'Cua' : 'robot'],
  navigation: { location: 'settings', viewId: 'configuration' },
  contributes: { views: [{ id: 'configuration', title, route: '#/settings' }],
    settings: [{ id: 'preferences', title, viewId: 'configuration', group }] },
}) as StoredApp;
let opens: any[] = [], closes: string[] = [];
(window as any).navigationEvidence = { opens, closes };
(window as any).agentDesktop = {
  getAppAuthoring: async () => ({ available: true, reason: null }), onAppsChanged: () => () => {},
  onAppInstallProgress: () => () => {}, getAppInstallProgress: async () => [],
  getManagedRuntimeStatus: async () => ({ runtimes: {} }),
  openEmbeddedApp: async (input: any) => {
    opens.push(input);
    return { ok: true, embedId: `embed-${opens.length}`, url: `${location.origin}/navigation-page?app=${input.name}`,
      preload: config.preload, app: { id: input.name, name: input.name, displayName: input.name } };
  },
  closeEmbeddedApp: async ({ embedId }: any) => { closes.push(embedId); return { ok: true }; },
};

function Fixture() {
  const preferences = makeApp('preferences', '个性化助手', 'apps');
  preferences.contributes!.views!.push({ id: 'appearance', title: '外观偏好', route: '#/appearance' });
  preferences.contributes!.settings![0].title = '常规设置';
  preferences.contributes!.settings!.push({ id: 'appearance', title: '外观偏好', viewId: 'appearance', group: 'apps' });
  const [apps, setApps] = React.useState([
    makeApp('feishu', '飞书', 'integrations'), makeApp('computer', '电脑操控', 'tools'), makeApp('browser', '网页操控', 'tools'),
    { ...makeApp('sequential-thinking', '分步思考', 'tools'), category: 'ai', toolScope: 'global', keywords: ['Sequential Thinking', '推理'] },
    preferences, makeApp('library', '资料助手', 'apps'),
    { ...makeApp('disabled', '已停用应用', 'apps'), enabled: false },
    { ...makeApp('operational', '操作类应用', 'apps'), navigation: { location: 'more', viewId: 'home' } },
    { ...makeApp('legacy', '旧版应用', 'apps'), navigation: undefined },
    { ...makeApp('invalid', '无效应用', 'apps'), packageStatus: 'invalid' },
    { ...makeApp('unauthorized', '未授权应用', 'apps'), contributes: {
      views: [{ id: 'configuration', title: '设置', route: '#/settings', permission: 'app:view' }],
      settings: [{ id: 'preferences', title: '设置', viewId: 'configuration', group: 'apps' }],
    } },
  ] as StoredApp[]);
  const [view, setView] = React.useState('settings');
  const [initialId, setInitialId] = React.useState<string | null>('app:feishu/preferences');
  const [settings, setSettings] = React.useState(config.settings);
  React.useEffect(() => { (window as any).navigationFixture = {
    update: (id: string, patch: Partial<StoredApp>) => setApps(previous => previous.map(app => app.id === id ? { ...app, ...patch } : app)),
    remove: (id: string) => setApps(previous => previous.filter(app => app.id !== id)),
  }; }, []);
  return <main className="h-screen overflow-hidden">
    {view === 'settings' ? <SettingsView apps={apps} settingsDraft={settings} setSettingsDraft={setSettings}
      settingsNotice="" autoSaveSettings={async () => {}} autoSaveImageSettings={async () => {}}
      themeMode="light" setThemeMode={() => {}} cssThemeId="default" setCssThemeId={() => {}}
      onToolDisplayModeChange={() => {}} onAppearancePreview={() => {}} onAppearanceCommit={() => {}} initialAppSettingId={initialId}
      onOpenAppManagement={() => setView('apps')} />
      : <AppsPanel apps={apps} versionsByApp={{}} onLaunch={(name, options) => {
        const app = apps.find(item => item.name === name)!;
        const entry = getAppPrimaryEntry(app);
        if (entry?.location === 'settings' || options?.settings) {
          setInitialId(getAppSettingsEntries([app])[0].id); setView('settings');
        }
      }} onDelete={() => {}} onIterate={() => {}} onLoadVersions={() => {}} onRollback={() => {}} onRefresh={async () => {}} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
