import * as React from 'react';
import type { AppMcpServiceTools, StoredApp } from '../types';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';

const statusLabels = {
  'app-disabled': 'App 已停用', 'instance-disabled': '实例已停用', unauthorized: '未授权',
  disabled: '服务已停用', 'credentials-missing': '需补充凭据', unchecked: '等待加载',
  authorized: '等待加载', connected: '可用', 'needs-auth': '需要授权', failed: '加载失败',
};
const needsDiscovery = (service: AppMcpServiceTools) => ['unchecked', 'authorized'].includes(service.status);

/** Each service loads independently so a slow connection never hides other Apps' tools. */
export function AppMcpToolRows({ app, service }: { app: StoredApp; service: AppMcpServiceTools }) {
  const [result, setResult] = React.useState<{ sourceStatus: AppMcpServiceTools['status']; value: AppMcpServiceTools } | null>(null);
  const [loading, setLoading] = React.useState(needsDiscovery(service));
  const [error, setError] = React.useState('');
  const live = React.useRef(true);
  const eligible = needsDiscovery(service);
  const { appId, instanceId, name, revision, status } = service;
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const load = React.useCallback(async () => {
    setLoading(true); setError('');
    try {
      const next = await window.agentDesktop.inspectAppMcpTools({ appId, instanceId, name, revision });
      if (!next || next.revision !== revision) throw new Error('连接配置已变化，请重新加载。');
      if (live.current) setResult({ sourceStatus: status, value: next });
    } catch (cause) {
      if (live.current) setError(cleanIpcErrorMessage(cause));
    } finally { if (live.current) setLoading(false); }
  }, [appId, instanceId, name, revision, status]);
  React.useEffect(() => { if (eligible && app.enabled) void load(); }, [eligible, app.enabled, load]);
  const current = result?.sourceStatus === status ? result.value : service;
  const available = ['unchecked', 'authorized', 'connected', 'failed', 'needs-auth'].includes(current.status);
  const label = !app.enabled ? 'App 已停用' : !available ? statusLabels[current.status] : loading ? '正在加载工具…' : error ? '加载失败' : statusLabels[current.status];
  const tools = current.tools;
  const serviceHeader = <th scope="rowgroup" rowSpan={Math.max(tools.length, 1)} className="border-r border-sidebar-border bg-sidebar/45 px-4 py-3 text-center align-middle text-xs font-normal">
    <span className="block break-words font-semibold text-foreground">{app.displayName || app.title || app.name}</span>
    <code className="mt-1 block break-all text-[11px] text-muted-foreground">{app.id || app.name}.{name}</code>
    <div className="mt-2 text-muted-foreground">
      <span>{current.truncated ? `仅展示前 ${tools.length} 个工具` : `${tools.length} 个工具`}</span>
      <span aria-hidden="true"> · </span><span role="status">{label}</span>
    </div>
    {available && app.enabled && <button type="button" disabled={loading} className="mt-2 text-primary disabled:opacity-50" onClick={() => void load()} aria-label={`重新加载 ${name} 工具`}>{loading ? '正在加载' : '重新加载工具'}</button>}
    {tools.length > 0 && (error || current.error) && <p role="alert" className="mt-2 break-words text-muted-foreground">{error || current.error}</p>}
  </th>;
  if (!tools.length) return <tbody className="border-b border-sidebar-border last:border-b-0"><tr className="border-t border-sidebar-border first:border-t-0">
    {serviceHeader}
    <td colSpan={4} className="px-4 py-5 text-xs text-muted-foreground">
      {error || current.error ? <p role="alert">{error || current.error}</p>
        : loading && available ? '连接后会自动展示可用工具。'
          : current.status === 'connected' ? '服务已连接，目前没有提供工具。'
            : ['needs-auth', 'unauthorized', 'credentials-missing'].includes(current.status) ? '请在 App 中完成授权或补充连接凭据。'
              : label}
    </td>
  </tr></tbody>;
  return <tbody className="border-b border-sidebar-border last:border-b-0">{tools.map((tool, index) => <tr key={tool.name} className="border-t border-sidebar-border first:border-t-0">
    {index === 0 && serviceHeader}
    <td className="break-all px-4 py-3 text-xs font-medium">{tool.name}</td>
    <td className="break-words px-4 py-3 text-xs leading-5 text-muted-foreground">{tool.description || '此工具未提供描述。'}</td>
    <td className="px-3 py-3 text-xs text-muted-foreground">按需</td>
    <td className="px-3 py-3 text-xs text-muted-foreground">{current.status !== 'connected' || !app.enabled ? label : tool.disabled ? '已排除' : '可用'}</td>
  </tr>)}</tbody>;
}
