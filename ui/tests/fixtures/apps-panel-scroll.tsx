import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AppsPanel } from '@/components/apps-panel';
import { AppSidebar } from '@/components/app-sidebar';
import { getAppCategory } from '@/lib/app-categories';
import type { StoredApp } from '@/types';
import '@/globals.css';

let storedApps = Array.from({ length: 24 }, (_, index) => ({
  id: `scroll.app-${index}`,
  name: `scroll.app-${index}`,
  displayName: `滚动测试 App ${index + 1}`,
  category: ['communication', 'knowledge', 'automation', 'ai', 'development', 'diagnostics'][index % 6],
  keywords: index === 2 ? ['Chrome', '网页'] : [],
  description: '检查启用和停用 App 后，列表顶部与底部都能完整显示。',
  enabled: true,
  hasUi: true,
  currentVersion: '1.0.0',
  updatedAt: 1_700_000_000_000,
})) as StoredApp[];

// Keep the test isolated from installed Apps and their real Desktop API.
(window as any).agentDesktop = {
  onAppInstallProgress: () => () => {},
  getAppInstallProgress: async () => [],
  setAppEnabled: async ({ appId, enabled }: { appId: string; enabled: boolean }) => {
    storedApps = storedApps.map(app => app.id === appId ? { ...app, enabled } : app);
  },
  appMarketplace: {
    list: async () => ({
      hostApiVersion: '3.3.0', fetchedAt: Date.now(), generatedAt: new Date().toISOString(),
      apps: storedApps.map(app => ({
        ...app, summary: app.description, categories: [getAppCategory(app.category).label],
        latestVersion: '1.0.0', hostCompatible: true, platformCompatible: true,
        latest: { version: '1.0.0', hostApi: '^3.0.0', permissions: [], artifact: { size: 1024, signed: true } },
      })),
    }),
  },
};

function Fixture() {
  const [apps, setApps] = React.useState(storedApps);
  const [launched, setLaunched] = React.useState('');
  return (
    // Match App.tsx's fixed-height shell and positioned, clipped content ancestor.
    <div className="app-shell flex h-screen w-full flex-col overflow-hidden">
      <div data-window-chrome className="h-9 shrink-0">Moss</div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-52 shrink-0 overflow-hidden">
          <AppSidebar apps={apps} sessions={[]} activeSessionId={null} activeView="apps" appsCount={apps.length}
            projectsCount={0} themeMode="light" collapsed={false} searchQuery=""
            onChangeView={() => {}} onChangeTheme={() => {}} onSelectSession={() => {}} onLaunchApp={setLaunched}
            onNewSession={() => {}} onDeleteSession={() => {}} onRenameSession={() => {}} onTogglePin={() => {}} onSearchChange={() => {}} />
        </aside>
        <output data-launched hidden>{launched}</output>
        <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <AppsPanel
            apps={apps}
            versionsByApp={{}}
            onLaunch={() => {}}
            onDelete={() => {}}
            onIterate={() => {}}
            onLoadVersions={() => {}}
            onRollback={() => {}}
            onRefresh={async () => { setApps([...storedApps]); }}
          />
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
