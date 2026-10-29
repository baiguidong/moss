import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AppsPanel } from '@/components/apps-panel';
import { AppDetailsView } from '@/components/app-details-view';
import { authorizeAppConnector } from '@/lib/connector-auth-flow';
import type { StoredApp } from '@/types';
import '@/globals.css';

const app = {
  id: 'moss.baidu-netdisk', name: 'moss.baidu-netdisk', title: '百度网盘', displayName: '百度网盘',
  enabled: true, currentVersion: '1.0.0', updatedAt: Date.now(), grants: ['connector:use'],
  permissions: ['connector:use'],
  declaredSkills: [{ id: 'connector-help', title: '连接器技能', description: '查看工具使用方法', path: 'SKILL.md', cli: 'cli.mjs' }],
  discovery: { kind: 'tool', group: 'online', authMethods: ['browser'] },
  connectorApp: { id: 'baidu-netdisk', capabilities: ['mcp'],
    connection: { id: 'baidu-netdisk', name: '百度网盘', connected: true, hasMcp: true, hasRemoteMcp: true, authMode: 'server-side' } },
} as StoredApp;
const configuredApp = { ...app, connectorApp: { ...app.connectorApp!, connection: { ...app.connectorApp!.connection!,
  credentialsConfigured: true, configuredFields: ['token'], credentialSchema: { fields: [{ key: 'token', label: '访问令牌', type: 'password' as const }] } } },
  mcpServices: [{ appId: app.id!, instanceId: 'default', name: 'baidu-netdisk', revision: '1', status: 'unchecked' as const, tools: [] }] };
const calls: any[] = [];
const fixture = { activeSessionId: 'esp32-project', calls, created: 0, currentApp: configuredApp as StoredApp, failDelete: false, failRollback: false, pauseSave: false, finishSave: null as (() => void) | null, selectApp: (_app: StoredApp) => {} };
(window as any).__authorization = fixture;
(window as any).agentDesktop = {
  onAppInstallProgress: () => () => {}, getAppInstallProgress: async () => [],
  appDiscovery: async () => ({ sections: { installed: 'tool', marketplace: 'tool' } }),
  connectorApp: async (payload: any) => {
    calls.push(['connector', payload]);
    if (payload.action === 'credentials' && fixture.pauseSave) await new Promise<void>(resolve => { fixture.finishSave = resolve; });
    return { connector: fixture.currentApp.connectorApp!.connection, ...(payload.action === 'auth' ? { auth: { status: 'authorization_url_opened' } } : {}) };
  },
  shell: { openExternal: async (url: string) => { calls.push(['external', url]); } },
  getAppAuthoring: async () => ({ available: true }), onAppsChanged: () => () => {},
  listAppVersions: async () => ['1.0.0', '0.9.0'].map(version => ({ id: version, version, createdAt: 1700000000000, reason: '测试版本', isCurrent: fixture.currentApp.currentVersion === version })),
  getAppInstanceLogs: async (payload: any) => { calls.push(['logs', payload]); return [{ timestamp: 1700000000000, level: 'info', message: 'fixture service ready' }]; },
  restartAppInstance: async (payload: any) => { calls.push(['restart', payload]); },
  updateAppInstance: async (payload: any) => { calls.push(['instance', payload]); },
  clearAppInstanceCredentials: async (payload: any) => { calls.push(['clear-credentials', payload]); },
  setAppEnabled: async (payload: any) => { calls.push(['enabled', payload]); fixture.currentApp = { ...fixture.currentApp, enabled: payload.enabled }; },
  setAppInstanceEnabled: async (payload: any) => { calls.push(['instance-enabled', payload]); },
  setAppGrants: async (payload: any) => { calls.push(['grants', payload]); fixture.currentApp = { ...fixture.currentApp, grants: payload.grants }; },
  setAppToolScope: async (payload: any) => { calls.push(['scope', payload]); fixture.currentApp = { ...fixture.currentApp, toolScope: payload.scope, toolLoading: payload.loading }; },
  appMarketplace: { list: async () => ({ apps: [], fetchedAt: Date.now(), generatedAt: Date.now(), cached: false }) },
  setConnectorAuthStatus: async (payload: any) => { calls.push(['status', payload]); },
  readAppSkill: async () => ({ id: 'connector-help', title: '连接器技能', content: '# 连接器技能\n通过主会话使用工具。' }),
  inspectAppMcpTools: async (payload: any) => { calls.push(['inspect', payload]); },
};
const authorize = (app: StoredApp) => authorizeAppConnector({
  app, api: window.agentDesktop,
  createSession: async title => {
    fixture.activeSessionId = `authorization-${++fixture.created}`;
    calls.push(['create', { title, sessionId: fixture.activeSessionId }]);
    return fixture.activeSessionId;
  },
});
const loadVersions = (name: string) => window.agentDesktop.listAppVersions({ name });
function Fixture() {
  const [details, setDetails] = React.useState(false);
  const [selectedApp, setSelectedApp] = React.useState<StoredApp>(configuredApp);
  const refresh = async () => { setSelectedApp({ ...fixture.currentApp }); };
  fixture.selectApp = next => { fixture.currentApp = next; setSelectedApp(next); setDetails(true); };
  return <main className="h-screen bg-background text-foreground">{details
    ? <AppDetailsView key={selectedApp.id} app={selectedApp} onAuthorize={authorize} onRefresh={refresh} onBack={() => setDetails(false)} onTry={() => { calls.push(['try', selectedApp.id]); }}
      onLoadVersions={loadVersions}
      onRollback={async (name, versionId) => { calls.push(['rollback', { name, versionId }]); if (fixture.failRollback) throw new Error('测试回滚失败'); fixture.currentApp = { ...fixture.currentApp, currentVersion: versionId }; await refresh(); }}
      onDelete={async (name, options) => { calls.push(['delete', { name, ...options }]); if (fixture.failDelete) throw new Error('测试卸载失败'); setDetails(false); }}
      onIterate={async name => { calls.push(['iterate', name]); }} />
    : <AppsPanel initialTab="installed" apps={[app]} onLaunch={() => { fixture.currentApp = configuredApp; setSelectedApp(configuredApp); setDetails(true); }} onRefresh={async () => {}} />}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
