import * as React from 'react';
import { Blocks } from 'lucide-react';
import type { AppMcpServiceTools, StoredApp } from '@/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AppToolList, type AppToolListItem } from '@/components/app-tool-list';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { appCapabilitySummary, hasMcpCatalog } from '@/lib/app-capabilities';

function useCapabilityCatalog(app: StoredApp) {
  const [discovered, setDiscovered] = React.useState<Record<string, {sourceStatus: string; sourceCheckedAt?: number; value: AppMcpServiceTools}>>({});
  React.useEffect(() => setDiscovered({}), [app.id, app.name]);
  const receive = React.useCallback((next: AppMcpServiceTools) => {
    const source = app.mcpServices?.find(service => service.appId === next.appId && service.instanceId === next.instanceId && service.name === next.name && service.revision === next.revision);
    if (source) setDiscovered(previous => ({...previous, [`${next.instanceId}/${next.name}/${next.revision}`]: {sourceStatus:source.status,sourceCheckedAt:source.checkedAt,value:next}}));
  }, [app.mcpServices]);
  const current = {...app, mcpServices: app.mcpServices?.map(service => {
    const found = discovered[`${service.instanceId}/${service.name}/${service.revision}`];
    return found?.sourceStatus === service.status && found.sourceCheckedAt === service.checkedAt ? found.value : service;
  })};
  return {current, receive};
}

export function AppAgentTools({ app, onDiscovered, showSkills = true, showSummary = true }: { app: StoredApp; onDiscovered?: (service: AppMcpServiceTools) => void; showSkills?: boolean; showSummary?: boolean }) {
  const { current, receive } = useCapabilityCatalog(app);
  const skills = showSkills ? current.contributes?.skills || [] : [];
  const [busy, setBusy] = React.useState<Record<string, boolean>>({}), [errors, setErrors] = React.useState<Record<string, string>>({});
  const working = React.useRef(new Set<string>()), live = React.useRef(true);
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const serviceKey = (service: AppMcpServiceTools) => `${service.instanceId}/${service.name}/${service.revision}`;
  const refresh = async (service: AppMcpServiceTools) => {
    const key = serviceKey(service);
    if (working.current.has(key)) return;
    working.current.add(key); setBusy(value => ({ ...value, [key]: true })); setErrors(value => ({ ...value, [key]: '' }));
    try {
      const { appId, instanceId, name, revision } = service;
      const next = await window.agentDesktop.inspectAppMcpTools({ appId, instanceId, name, revision });
      if (!next || next.revision !== revision) throw new Error('连接配置已变化，请重新加载。');
      if (live.current) { receive(next); onDiscovered?.(next); }
    } catch (cause) { if (live.current) setErrors(value => ({ ...value, [key]: cleanIpcErrorMessage(cause) })); }
    finally { working.current.delete(key); if (live.current) setBusy(value => ({ ...value, [key]: false })); }
  };
  const effects = { read: '只读', write: '写入', destructive: '破坏性操作' };
  const statuses = { 'app-disabled': 'App 已停用', 'instance-disabled': '实例已停用', unauthorized: '未授权', disabled: '服务已停用', 'credentials-missing': '需补充凭据', unchecked: '使用时连接', authorized: '使用时连接', connected: '检查通过', 'needs-auth': '需要授权', failed: '连接失败' };
  const tools: AppToolListItem[] = [
    ...(current.agentTools || []).map(tool => ({ id: `native/${tool.id}`, name: tool.name || tool.id, title: tool.title, description: tool.description,
      effect: effects[tool.effect], source: `来源：${current.displayName || current.title || current.name} · App`,
      status: !current.enabled ? 'App 已停用' : tool.permission && !current.grants?.includes(tool.permission) ? '未授权' : undefined })),
    ...(current.mcpServices || []).flatMap(service => service.tools.map(tool => ({ id: `${serviceKey(service)}/${tool.name}`, name: tool.name,
      description: tool.description, mcp: true, source: current.mcpServices!.length > 1 ? service.name : undefined,
      status: !current.enabled ? 'App 已停用' : tool.disabled ? '已排除' : ['disabled', 'instance-disabled', 'unauthorized', 'credentials-missing', 'needs-auth'].includes(service.status) ? statuses[service.status] : undefined }))),
  ];
  return <div data-app-capabilities className="min-w-0 space-y-4">
    {showSummary && <div className="text-sm font-medium">{appCapabilitySummary(showSkills ? current : { ...current, contributes: { ...current.contributes, skills: [] } })}</div>}
    {skills.length > 0 && <ul className="grid gap-2">{skills.map(skill => <li key={skill.id} className="rounded-md border border-border px-3 py-2 text-xs"><span className="font-medium">{skill.title} · CLI skill</span><p className="mt-1 text-muted-foreground">{skill.description}</p><code className="mt-1 block break-all text-muted-foreground">{skill.id}</code></li>)}</ul>}
    {current.mcpServices?.map(service => {
      const key = serviceKey(service), available = current.enabled && ['unchecked', 'authorized', 'connected', 'failed', 'needs-auth'].includes(service.status);
      const error = errors[key] || service.error;
      return <div key={key} className="space-y-2 border-b pb-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center justify-between gap-2"><span>{service.name} · {busy[key] ? '正在检查' : statuses[service.status]}{service.truncated ? ' · 仅展示部分工具' : ''}</span>{available && <Button variant="outline" size="sm" disabled={busy[key]} onClick={() => void refresh(service)} aria-label={`检查 ${service.name} 服务`}>检查服务</Button>}</div>
        {error ? <p role="alert" className="break-words text-destructive">{error}</p> : ['needs-auth', 'unauthorized', 'credentials-missing'].includes(service.status) && <p>请在 App 中完成授权或补充连接凭据。</p>}
      </div>;
    })}
    {(tools.length > 0 || Boolean(current.mcpServices?.length)) && <AppToolList tools={tools} loading={Object.values(busy).some(Boolean)} />}
  </div>;
}

export function AppCapabilityButton({app, discover = false, compact = false}: {app:StoredApp; discover?:boolean; compact?:boolean}) {
  const {current, receive} = useCapabilityCatalog(app);
  const attempted = React.useRef(new Set<string>());
  const live = React.useRef(true);
  const receiveRef = React.useRef(receive); receiveRef.current = receive;
  React.useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  React.useEffect(() => {
    if (!discover || !app.enabled) return;
    for (const service of app.mcpServices || []) {
      const key = `${service.appId}/${service.instanceId}/${service.name}/${service.revision}/${service.status}`;
      if (hasMcpCatalog(service) || !['unchecked','authorized'].includes(service.status) || attempted.current.has(key)) continue;
      attempted.current.add(key);
      const {appId, instanceId, name, revision} = service;
      void window.agentDesktop.inspectAppMcpTools({appId, instanceId, name, revision}).then(next => {
        if (live.current && next) receiveRef.current(next);
      }).catch(() => { attempted.current.delete(key); });
    }
  }, [discover,app.enabled,app.mcpServices]);
  return <Popover><PopoverTrigger asChild><Button variant={compact ? 'ghost' : 'outline'} size="sm" className={compact ? 'h-auto max-w-60 gap-1 rounded px-1 py-0.5 text-[11px] font-normal text-muted-foreground' : 'h-8 max-w-60 gap-1.5 rounded-md px-2.5 text-xs'} title="查看此 App 提供的工具与技能" aria-label={`查看 AI 能力：${appCapabilitySummary(current)}`}><Blocks className={compact ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0'}/><span className="truncate">{appCapabilitySummary(current)}</span></Button></PopoverTrigger><PopoverContent align="end" className="max-h-[70vh] w-[min(720px,calc(100vw-32px))] overflow-auto p-4"><AppAgentTools app={current} onDiscovered={receive}/></PopoverContent></Popover>;
}
