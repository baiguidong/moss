import * as React from 'react';
import { LoaderCircle, KeyRound, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InstalledConnector, StoredApp } from '@/types';

const matches = (condition: { field: string; equals: string[] } | undefined, values: Record<string, string>) => !condition || condition.equals.includes(values[condition.field] || '');

export function canAuthenticateConnector(connector: InstalledConnector | null | undefined) {
  if (!connector?.hasMcp || connector.hasRemoteMcp === false) return false;
  return connector.authMode?.toLowerCase() !== 'none';
}

export function AppConnectorSettings({ app, onChanged }: { app: StoredApp; onChanged: () => Promise<unknown> }) {
  const appId = app.id || app.name;
  const [connector, setConnector] = React.useState<InstalledConnector | null>(app.connectorApp?.connection || null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const apply = React.useCallback((value: InstalledConnector) => {
    setConnector(value);
    setValues(Object.fromEntries((value.credentialSchema?.fields || []).map(field => [field.key, field.type === 'password' ? '' : value.configuredValues?.[field.key] || field.defaultValue || ''])));
  }, []);
  React.useEffect(() => {
    let active = true;
    void window.agentDesktop.connectorApp({ appId }).then(result => { if (active) apply(result.connector); }).catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [appId, apply]);
  React.useEffect(() => { if (app.connectorApp?.connection) apply(app.connectorApp.connection); }, [app.connectorApp?.connection, apply]);
  const run = async (action: 'status' | 'refresh' | 'setup' | 'auth' | 'credentials' | 'provision') => {
    setBusy(action); setError(''); setNotice('');
    try {
      const result = await window.agentDesktop.connectorApp({ appId, action, ...(action === 'credentials' ? { values } : {}) });
      apply(result.connector);
      if (result.auth?.status === 'authorization_url_opened') setNotice('授权页面已打开，完成后可刷新状态。');
      else if (!['status', 'refresh'].includes(action)) setNotice(result.connector.connected ? '已就绪，可在会话中选择此应用。' : '配置已保存，请完成所需登录。');
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };
  if (!connector) return <div className="py-3 text-xs text-muted-foreground">{error || '正在读取服务配置…'}</div>;
  const schema = connector.credentialSchema;
  const allowed = app.enabled && app.grants?.includes('connector:use');
  const status = !app.enabled ? '已停用' : !allowed ? '尚未授权应用能力' : connector.connected ? '已就绪'
    : schema && !connector.credentialsConfigured ? '待配置' : connector.setupStatus === 'authenticating' ? '等待登录' : '待连接';
  return <div className="space-y-3" data-app-connector={appId}>
    <div className="flex items-center gap-2 text-xs font-medium"><KeyRound className="h-3.5 w-3.5" />认证与连接</div>
    <div className="flex items-center gap-2 text-xs"><span className="font-medium">{status}</span>
      <Button size="sm" variant="ghost" className="ml-auto h-7" disabled={Boolean(busy)} onClick={() => void run('refresh')}><RefreshCw className="h-3.5 w-3.5" />刷新状态</Button>
    </div>
    {schema && <form className="space-y-3" onSubmit={event => { event.preventDefault(); void run('credentials'); }}>
      {schema.fields.filter(field => matches(field.visibleWhen, values)).map(field => {
        const required = (field.requiredWhen ? matches(field.requiredWhen, values) : field.required) && !connector.configuredFields?.includes(field.key);
        return <label key={field.key} className="block space-y-1 text-xs"><span>{field.label}{required ? ' *' : ''}</span>
          {field.type === 'select' ? <select value={values[field.key] || ''} required={required} disabled={!allowed || Boolean(busy)} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} className="h-8 w-full rounded-md border border-input bg-background px-2">
            <option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select> : <Input type={field.type === 'password' ? 'password' : 'text'} value={values[field.key] || ''} required={required} autoComplete="off" disabled={!allowed || Boolean(busy)}
            placeholder={connector.configuredFields?.includes(field.key) && field.type === 'password' ? '已配置，留空保留' : field.placeholder} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} className="h-8 text-xs" />}
          {field.description && <span className="block leading-5 text-muted-foreground">{field.description}</span>}
        </label>;
      })}
      <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" disabled={!allowed || Boolean(busy)}><KeyRound className="h-3.5 w-3.5" />保存配置</Button>
        {schema.provision && <Button type="button" size="sm" variant="outline" disabled={!allowed || Boolean(busy)} onClick={() => void run('provision')}>{schema.provision.label || '创建凭据'}</Button>}
        {schema.docUrl && <Button type="button" size="sm" variant="ghost" onClick={() => void window.agentDesktop.shell.openExternal(schema.docUrl!)}>配置说明</Button>}
      </div>
    </form>}
    <div className="flex flex-wrap gap-2">
      {(connector.hasCli || connector.requiresCliSetup) && <Button size="sm" disabled={!allowed || Boolean(busy) || Boolean(schema && !connector.credentialsConfigured)} onClick={() => void run('setup')}>安装 / 登录 CLI</Button>}
      {canAuthenticateConnector(connector) && <Button size="sm" variant="outline" disabled={!allowed || Boolean(busy) || Boolean(schema && !connector.credentialsConfigured)} onClick={() => void run('auth')}>{connector.connected ? '重新授权' : '连接 / 授权'}</Button>}
    </div>
    {busy && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />{busy === 'setup' ? '正在检查 CLI 并完成登录，请按授权页面提示操作…' : '正在处理…'}</p>}
    {notice && <p role="status" className="text-xs text-muted-foreground">{notice}</p>}
    {error && <p role="alert" className="break-words text-xs text-destructive">{error}</p>}
  </div>;
}
