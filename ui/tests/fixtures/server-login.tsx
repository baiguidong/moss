import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsView } from '@/components/settings-view';
import { AppSidebar } from '@/components/app-sidebar';
import { ServerLoginDialog } from '@/components/server-login-dialog';
import { useServerAuthentication } from '@/lib/server-authentication';
import { TooltipProvider } from '@/components/ui/tooltip';
import '@/globals.css';

const initial = await fetch('/login-fixture-settings').then(response => response.json());
const evidence = { calls: 0, cancels: 0, address: '', cloudCalls: 0, cloudRequiresLogin: true, cloudFailure: '',
  configure: null as null | ((url: string) => void),
  reject: null as null | ((error: Error) => void), resolve: null as null | ((value: any) => void) };
(window as any).loginEvidence = evidence;
window.agentDesktop = {
  ipcInvoke: async (channel: string) => {
    if (channel !== 'desktop:open-cloud') throw new Error('Unexpected channel');
    evidence.cloudCalls++;
    if (evidence.cloudFailure) throw new Error(evidence.cloudFailure);
    return evidence.cloudRequiresLogin ? { ok: false, reason: 'authentication-required' } : { ok: true };
  },
  authenticateRemoteServer: async ({ serverUrl }) => { evidence.address = serverUrl; evidence.calls++; return new Promise((resolve, reject) => { evidence.resolve = resolve; evidence.reject = reject; }); },
  cancelRemoteServerAuthentication: async () => { evidence.cancels++; evidence.reject?.(new Error('认证已取消。')); return { canceled: true }; },
  getManagedRuntimeStatus: async () => ({ runtimes: {} }),
  getRemoteServerIdentity: async () => ({ userName: 'Test User', userEmail: 'test@example.test' }),
} as unknown as Window['agentDesktop'];
function Fixture() {
  const [settings, setSettings] = React.useState(initial);
  const [view, setView] = React.useState<any>('chat');
  const authentication = useServerAuthentication(next => {
    evidence.cloudRequiresLogin = false;
    setSettings((previous: any) => ({ ...previous, ...next }));
  });
  React.useEffect(() => { evidence.configure = url => setSettings((previous: any) => ({ ...previous, enterpriseAccountServerUrl: url })); }, []);
  return <TooltipProvider><main className="flex h-screen">
    <aside className="w-64"><AppSidebar sessions={[]} apps={[]} activeSessionId={null} activeView={view}
      projectsCount={0} themeMode="light" collapsed={false} searchQuery="" serverConfigured={Boolean(settings.enterpriseAccountServerUrl)}
      serverAuthState={authentication.state} serverAuthError={authentication.error}
      onLoginServer={() => authentication.open(settings.enterpriseAccountServerUrl)}
      onCloudLoginRequired={resume => authentication.open(settings.enterpriseAccountServerUrl, {
        afterLogin: resume, notice: '请先登录 Moss 账号，登录后将继续连接我的云电脑。',
      })}
      onChangeView={setView} onChangeTheme={() => {}} onSelectSession={() => {}} onLaunchApp={() => {}}
      onNewSession={() => {}} onDeleteSession={() => {}} onRenameSession={() => {}} onTogglePin={() => {}} onSearchChange={() => {}} /></aside>
    <div className="flex-1"><SettingsView settingsDraft={settings} setSettingsDraft={setSettings} settingsNotice=""
      serverAuthentication={authentication} autoSaveSettings={async () => {}} autoSaveImageSettings={async () => {}}
      themeMode="light" setThemeMode={() => {}} cssThemeId="default" setCssThemeId={() => {}}
      onToolDisplayModeChange={() => {}} onAppearancePreview={() => {}} onAppearanceCommit={() => {}} /></div>
    <ServerLoginDialog authentication={authentication} />
    <output hidden data-auth-state>{authentication.state}</output>
  </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
