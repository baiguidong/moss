import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AppsPanel } from '@/components/apps-panel';
import { authorizeAppConnector } from '@/lib/connector-auth-flow';
import type { StoredApp } from '@/types';
import '@/globals.css';

const app = {
  id: 'moss.baidu-netdisk', name: 'moss.baidu-netdisk', title: '百度网盘', displayName: '百度网盘',
  enabled: true, currentVersion: '1.0.0', updatedAt: Date.now(), grants: ['connector:use'],
  discovery: { kind: 'tool', group: 'online', authMethods: ['browser'] },
  connectorApp: { id: 'baidu-netdisk', capabilities: ['mcp'],
    connection: { id: 'baidu-netdisk', name: '百度网盘', connected: true, hasMcp: true, hasRemoteMcp: true, authMode: 'server-side' } },
} as StoredApp;
const calls: any[] = [];
const fixture = { activeSessionId: 'esp32-project', calls, created: 0 };
(window as any).__authorization = fixture;
(window as any).agentDesktop = {
  onAppInstallProgress: () => () => {}, getAppInstallProgress: async () => [],
  appDiscovery: async () => ({ sections: { installed: 'tool', marketplace: 'tool' } }),
  connectorApp: async (payload: any) => {
    calls.push(['connector', payload]);
    return { connector: app.connectorApp!.connection, ...(payload.action === 'auth' ? { auth: { status: 'authorization_url_opened' } } : {}) };
  },
  setConnectorAuthStatus: async (payload: any) => { calls.push(['status', payload]); },
};
const authorize = (app: StoredApp) => authorizeAppConnector({
  app, api: window.agentDesktop,
  createSession: async title => {
    fixture.activeSessionId = `authorization-${++fixture.created}`;
    calls.push(['create', { title, sessionId: fixture.activeSessionId }]);
    return fixture.activeSessionId;
  },
});
createRoot(document.getElementById('root')!).render(<AppsPanel apps={[app]} versionsByApp={{}}
  onAuthorize={authorize} onLaunch={() => {}} onDelete={() => {}} onIterate={() => {}}
  onLoadVersions={() => {}} onRollback={() => {}} onRefresh={async () => {}} />);
