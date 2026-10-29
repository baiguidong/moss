import * as React from 'react';
import { ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppDetailsSection } from '@/components/app-details-section';
import type { InstalledConnector, StoredApp } from '@/types';

const matches = (condition: { field: string; equals: string[] } | undefined, values: Record<string, string>) => !condition || condition.equals.includes(values[condition.field] || '');

export function canAuthenticateConnector(connector: InstalledConnector | null | undefined) {
  if (!connector?.hasMcp || connector.hasRemoteMcp === false) return false;
  return connector.authMode?.toLowerCase() !== 'none';
}

export function AppConnectorSettings({ app, onChanged, onAuthorize, onBusyChange, panel = false }: {
  panel?: boolean;
  app: StoredApp; onChanged: () => Promise<unknown>;
  onAuthorize?: (app: StoredApp) => ReturnType<Window['agentDesktop']['connectorApp']>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const appId = app.id || app.name;
  const formId = React.useId();
  const [connector, setConnector] = React.useState<InstalledConnector | null>(app.connectorApp?.connection || null);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  React.useEffect(() => { onBusyChange?.(Boolean(busy)); }, [busy, onBusyChange]);
  React.useEffect(() => () => { onBusyChange?.(false); }, [onBusyChange]);
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
      if (action === 'auth' && !onAuthorize) throw new Error('授权入口暂不可用，请重新打开 Apps。');
      const result = action === 'auth'
        ? await onAuthorize!(app)
        : await window.agentDesktop.connectorApp({ appId, action, ...(action === 'credentials' ? { values } : {}) });
      apply(result.connector);
      if (result.auth?.status === 'authorization_url_opened') setNotice('授权页面已打开，完成后可刷新状态。');
      else if (!['status', 'refresh'].includes(action)) setNotice(result.connector.connected ? '已就绪，可在会话中选择此应用。' : '配置已保存，请完成所需登录。');
      await onChanged();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(''); }
  };
  if (!connector) return <div className={panel ? 'p-5' : 'py-3'}>
    <p role={error ? 'alert' : 'status'} className="text-sm text-muted-foreground">{error || '正在读取服务配置…'}</p>
    {error && <Button variant="outline" className="mt-3" disabled={Boolean(busy)} onClick={() => void run('status')}>重新读取</Button>}
  </div>;
  const schema = connector.credentialSchema;
  const allowed = app.enabled && app.grants?.includes('connector:use');
  const status = !app.enabled ? '已停用' : !allowed ? '尚未授权应用能力' : connector.connected ? '已就绪'
    : schema && !connector.credentialsConfigured ? '待配置' : connector.setupStatus === 'authenticating' ? '等待登录' : '待连接';
  const hasSetup = connector.hasCli || connector.requiresCliSetup;
  const hasAuth = canAuthenticateConnector(connector);
  return <div className={`flex min-w-0 flex-col ${panel ? 'min-h-0 flex-1' : ''}`} data-app-connector={appId}>
    <div className={`space-y-6 ${panel ? 'min-h-0 flex-1 overflow-y-auto p-5' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4 text-sm">
        <div className="flex items-center gap-3"><span className="text-muted-foreground">连接状态</span><span className="inline-flex items-center gap-2 font-medium"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${allowed && connector.connected ? 'bg-emerald-500' : 'bg-muted-foreground/50'}`} />{status}</span></div>
        <Button size="sm" variant="ghost" className="shrink-0 rounded-full" disabled={Boolean(busy)} onClick={() => void run('refresh')}><RefreshCw className={`h-4 w-4 ${busy === 'refresh' ? 'animate-spin' : ''}`} />刷新状态</Button>
      </div>
      {schema && <AppDetailsSection title="凭据配置">
        <form id={formId} aria-label="凭据配置" className="space-y-5 pt-5" onSubmit={event => { event.preventDefault(); void run('credentials'); }}>
          {schema.fields.filter(field => matches(field.visibleWhen, values)).map(field => {
            const required = (field.requiredWhen ? matches(field.requiredWhen, values) : field.required) && !connector.configuredFields?.includes(field.key);
            const descriptionId = `${formId}-${field.key}-help`;
            return <label key={field.key} className="block min-w-0 space-y-2 text-sm"><span className="font-medium">{field.label}{required && <span aria-hidden="true" className="ml-1 text-destructive">*</span>}</span>
              {field.type === 'select' ? <select aria-label={field.label} aria-describedby={field.description ? descriptionId : undefined} value={values[field.key] || ''} required={required} disabled={!allowed || Boolean(busy)} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} className="h-10 w-full min-w-0 rounded-lg border border-input bg-background px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select> : <Input aria-label={field.label} aria-describedby={field.description ? descriptionId : undefined} type={field.type === 'password' ? 'password' : 'text'} value={values[field.key] || ''} required={required} autoComplete="off" spellCheck={false} disabled={!allowed || Boolean(busy)}
                placeholder={connector.configuredFields?.includes(field.key) && field.type === 'password' ? '已配置，留空保留' : field.placeholder} onChange={event => setValues(previous => ({ ...previous, [field.key]: event.target.value }))} className="h-10 rounded-lg text-sm" />}
              {field.description && <span id={descriptionId} className="block whitespace-pre-line break-words text-xs leading-6 text-muted-foreground">{field.description}</span>}
            </label>;
          })}
          {schema.docUrl && <button type="button" className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline" onClick={() => void window.agentDesktop.shell.openExternal(schema.docUrl!).catch(reason => setError(String(reason.message || reason)))}>{schema.docLabel || '配置说明'}<ExternalLink className="h-3.5 w-3.5" /></button>}
        </form>
      </AppDetailsSection>}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />{busy === 'setup' ? '正在检查 CLI 并完成登录，请按授权页面提示操作…' : '正在处理…'}</p>}
      {notice && <p role="status" className="text-sm leading-6 text-muted-foreground">{notice}</p>}
      {error && <p role="alert" className="break-words text-sm leading-6 text-destructive">{error}</p>}
    </div>
    {(schema || hasSetup || hasAuth) && <footer className={`flex flex-wrap items-center justify-end gap-2 border-t ${panel ? 'shrink-0 px-5 py-4' : 'mt-6 pt-4'}`}>
      {schema?.provision && <Button type="button" variant="outline" className="rounded-full" disabled={!allowed || Boolean(busy)} onClick={() => void run('provision')}>{schema.provision.label || '创建凭据'}</Button>}
      {hasSetup && <Button variant={schema ? 'outline' : 'default'} className="rounded-full" disabled={!allowed || Boolean(busy) || Boolean(schema && !connector.credentialsConfigured)} onClick={() => void run('setup')}>安装 / 登录 CLI</Button>}
      {hasAuth && <Button variant={schema || hasSetup ? 'outline' : 'default'} className="rounded-full" disabled={!allowed || Boolean(busy) || Boolean(schema && !connector.credentialsConfigured) || !onAuthorize} onClick={() => void run('auth')}>{connector.connected ? '重新授权' : '连接 / 授权'}</Button>}
      {schema && <Button type="submit" form={formId} className="rounded-full" disabled={!allowed || Boolean(busy)}>{busy === 'credentials' && <LoaderCircle className="h-4 w-4 animate-spin" />}{busy === 'credentials' ? '保存中' : '保存配置'}</Button>}
    </footer>}
  </div>;
}
