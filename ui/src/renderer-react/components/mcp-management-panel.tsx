import * as React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, RefreshCw } from 'lucide-react';
import type { McpCatalog, McpHostInputMap, McpHostOutputMap } from '../../../../packages/app-sdk/src/mcp/index.mjs';
import type { AppMcpServiceTools, StoredApp } from '@/types';
import { Button } from '@/components/ui/button';
import { AppDetailsEntry, AppDetailsSection } from '@/components/app-details-section';
import type { AppDetailsMcpTool } from '@/components/app-details-tools';
import { McpConnectionEditor } from '@/components/mcp-connection-editor';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { usesBuiltinMcpUi } from '@/lib/app-navigation';
import { hasMcpCatalog } from '@/lib/app-capabilities';

type Method = 'servers.list' | 'servers.save' | 'servers.inspect' | 'auth.start' | 'auth.clear';
export type McpManagementRequest = <M extends Method>(method: M, input: McpHostInputMap[M]) => Promise<McpHostOutputMap[M]>;
type Props = {
  app: StoredApp; settingsOpen?: boolean; settingsBusy?: boolean; settingsPanelId: string; settingsContainer: HTMLElement | null; unavailableReason?: string | null;
  onOpenSettings(): void; onSettingsClosed(): void; onSettingsBusyChange(busy: boolean): void; onRefresh(): Promise<unknown>;
  children(tools: AppDetailsMcpTool[]): React.ReactNode;
};
const statusLabels: Record<AppMcpServiceTools['status'], string> = {
  'app-disabled': 'App 已停用', 'instance-disabled': '实例已停用', unauthorized: '未授权',
  disabled: '服务已停用', 'credentials-missing': '需补充凭据', unchecked: '使用时连接',
  authorized: '使用时连接', connected: '检查通过', 'needs-auth': '需要授权', failed: '连接失败',
};
const serviceKey = (service: AppMcpServiceTools) => `${service.instanceId}/${service.name}/${service.revision}`;
const serviceTools = (services: AppMcpServiceTools[]): AppDetailsMcpTool[] => services.flatMap(service => service.tools.map(tool => ({
  ...tool, instanceId: service.instanceId, server: service.name,
  status: service.catalogStale ? '目录待刷新' : service.status === 'connected' ? '可用' : statusLabels[service.status],
})));

/** Core separates service management from the App's combined native/MCP tool list. */
export function McpManagementPanel(props: Props) {
  return usesBuiltinMcpUi(props.app) ? <ConfiguredMcpPanel {...props} /> : <AppOwnedMcpPanel {...props} />;
}

/** App-owned services use the catalog already supplied by the Host; inspect only on click. */
function AppOwnedMcpPanel({ app, settingsOpen, settingsBusy, settingsPanelId, settingsContainer, onOpenSettings, onSettingsBusyChange, unavailableReason, onRefresh, children }: Props) {
  const services = app.mcpServices || [];
  const [selected, setSelected] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const working = React.useRef(new Set<string>()), alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; onSettingsBusyChange(false); }; }, [onSettingsBusyChange]);
  const inspect = async (service: AppMcpServiceTools) => {
    const key = serviceKey(service);
    if (working.current.has(key)) return;
    working.current.add(key); setBusy(value => ({ ...value, [key]: true })); setErrors(value => ({ ...value, [key]: '' })); onSettingsBusyChange(true);
    try {
      const { appId, instanceId, name, revision } = service;
      await window.agentDesktop.inspectAppMcpTools({ appId, instanceId, name, revision });
      if (alive.current) await onRefresh();
    } catch (cause) { if (alive.current) setErrors(value => ({ ...value, [key]: cleanIpcErrorMessage(cause) })); }
    finally { working.current.delete(key); if (alive.current) { setBusy(value => ({ ...value, [key]: false })); onSettingsBusyChange(false); } }
  };
  const active = services.find(service => `${service.instanceId}/${service.name}` === selected);
  const canInspect = (service: AppMcpServiceTools) => !unavailableReason && app.enabled && ['unchecked', 'authorized', 'connected', 'failed', 'needs-auth'].includes(service.status);
  return <div className="space-y-8" data-mcp-management>
    {services.length > 0 && <AppDetailsSection title="MCP 服务" count={services.length}>
      {unavailableReason && <p className="py-4 text-sm text-muted-foreground">{unavailableReason}</p>}
      <div className="space-y-1 py-2">
        {services.map(service => {
          const key = serviceKey(service);
          const expanded = settingsOpen && selected === `${service.instanceId}/${service.name}`;
          return <AppDetailsEntry key={key} title={service.name} trailing={<span className="text-xs text-muted-foreground">{busy[key] ? '正在检查' : statusLabels[service.status]}</span>}
            description={hasMcpCatalog(service) ? `${service.tools.length} 个工具${service.truncated ? ' · 仅展示部分工具' : ''}` : '首次使用或检查服务后显示工具。'}
            disabled={settingsBusy} aria-expanded={Boolean(expanded)} aria-controls={expanded ? settingsPanelId : undefined}
            onClick={() => { setSelected(`${service.instanceId}/${service.name}`); onOpenSettings(); }} />;
        })}
      </div>
    </AppDetailsSection>}
    {children(serviceTools(services))}
    {settingsOpen && settingsContainer && active && createPortal(<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="break-all text-sm font-medium">{active.name}</h3><span role="status" className="text-xs text-muted-foreground">{busy[serviceKey(active)] ? '正在检查' : statusLabels[active.status]}</span></div>
      <Button variant="outline" size="sm" data-mcp-inspect disabled={busy[serviceKey(active)] || !canInspect(active)} aria-label={`检查 ${active.name} 服务`} onClick={() => void inspect(active)}>{busy[serviceKey(active)] ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}检查服务</Button>
      {(errors[serviceKey(active)] || active.error || unavailableReason) && <p role="alert" className="break-words text-sm text-destructive">{errors[serviceKey(active)] || active.error || unavailableReason}</p>}
    </div>, settingsContainer)}
  </div>;
}

/** Configuration-only Apps use Core's connection editor, never an App view. */
function ConfiguredMcpPanel({ app, settingsOpen = false, settingsBusy, settingsPanelId, settingsContainer, unavailableReason, onOpenSettings, onSettingsClosed, onSettingsBusyChange, onRefresh, children }: Props) {
  // Configuration-only Apps have no Backend instances in the public App list.
  const appId = app.id || app.name, instanceId = app.mcpServices?.[0]?.instanceId || app.instances?.[0]?.id;
  const version = app.currentVersion || app.currentVersionId || '';
  const [catalog, setCatalog] = React.useState<McpCatalog | null>(null);
  const [busy, setBusy] = React.useState(!unavailableReason), [error, setError] = React.useState('');
  const request = React.useCallback<McpManagementRequest>((method, input) => {
    if (!instanceId) return Promise.reject(new Error('服务实例尚未就绪，请重新打开详情页。'));
    return window.agentDesktop.manageAppMcp({ appId, instanceId, version, method, input });
  }, [appId, instanceId, version]);
  React.useEffect(() => {
    let canceled = false;
    setCatalog(null); setBusy(!unavailableReason); setError('');
    if (!unavailableReason) void request('servers.list', {}).then(result => { if (!canceled) setCatalog(result); })
      .catch(cause => { if (!canceled) setError(cleanIpcErrorMessage(cause)); })
      .finally(() => { if (!canceled) setBusy(false); });
    return () => { canceled = true; };
  }, [request, unavailableReason]);
  const enabled = catalog?.servers.filter(server => server.enabled) || [];
  const failed = error || enabled.find(server => server.check?.state === 'failed')?.check?.error;
  const checked = enabled.length > 0 && enabled.every(server => server.check?.state === 'connected');
  const label = unavailableReason || (busy ? '正在读取状态' : failed ? '检查失败' : !catalog ? '状态不可用' : !enabled.length ? '服务已停用' : enabled.some(server => server.credentialsMissing) ? '需补充凭据' : enabled.some(server => server.check?.state === 'needs-auth') ? '需要授权' : checked ? '检查通过' : '使用时连接');
  const cached = (app.mcpServices || []).filter(service => service.instanceId === instanceId);
  const serviceNames = (catalog?.servers || cached).map(service => service.name).join('、') || app.displayName || app.title || app.name;
  const allTools = catalog ? catalog.servers.flatMap(server => {
    const cache = cached.find(service => service.name === server.name);
    const tools = server.check?.state === 'connected' ? server.check.tools : cache?.tools || server.check?.tools || [];
    const status = !server.enabled ? '服务已停用' : server.credentialsMissing ? '需补充凭据' : server.check?.state === 'connected' ? '检查通过' : server.check?.state === 'needs-auth' ? '需要授权' : server.check?.state === 'failed' ? '连接失败' : '使用时连接';
    return tools.map(tool => ({ ...tool, instanceId, server: server.name, disabled: tool.disabled || server.config.disabledTools?.includes(tool.name), status: status === '检查通过' ? '可用' : status }));
  }) : serviceTools(cached);
  const canManage = Boolean(app.grants?.includes('mcp:manage')), canConnect = Boolean(app.grants?.includes('mcp:connect'));
  return <div className="space-y-8" data-mcp-management>
    <AppDetailsSection title="MCP 服务" count={catalog?.servers.length ?? cached.length}>
      <div aria-label="MCP 连接状态" aria-busy={busy}>
        <div className="space-y-1 py-2">
          <AppDetailsEntry title={serviceNames} data-mcp-settings aria-label={`${serviceNames} 连接设置`} aria-expanded={settingsOpen} aria-controls={settingsOpen ? settingsPanelId : undefined}
            disabled={busy || settingsBusy || !catalog || Boolean(unavailableReason)} onClick={onOpenSettings}
            trailing={<span role="status" data-mcp-status className={`flex items-center gap-2 text-xs ${failed ? 'text-destructive' : checked ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{label}</span>} />
        </div>
        {failed && <p role="alert" className="break-words pb-4 text-sm text-destructive">{failed}</p>}
      </div>
    </AppDetailsSection>
    {children(allTools)}
    {settingsOpen && settingsContainer && createPortal(
      unavailableReason ? <p role="status" className="p-5 text-sm text-muted-foreground">{unavailableReason}</p>
        : catalog ? <McpConnectionEditor catalog={catalog} request={request} canManage={canManage} canInspect={canConnect} canAuthenticate={Boolean(app.grants?.includes('mcp:auth'))} onClose={onSettingsClosed} onBusyChange={onSettingsBusyChange} onSaved={next => { setCatalog(next); void onRefresh(); }} />
          : <p role={error ? 'alert' : 'status'} className="p-5 text-sm text-muted-foreground">{error || '正在读取连接设置…'}</p>, settingsContainer)}
  </div>;
}
