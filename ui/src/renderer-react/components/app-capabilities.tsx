import * as React from 'react';
import { Blocks } from 'lucide-react';
import type { AppMcpServiceTools, StoredApp } from '@/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AppMcpToolRows } from '@/components/app-mcp-tool-rows';
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

export function AppAgentTools({ app, onDiscovered }: { app: StoredApp; onDiscovered?: (service: AppMcpServiceTools) => void }) {
  const {current, receive} = useCapabilityCatalog(app);
  const tools = current.agentTools || [], skills = current.contributes?.skills || [];
  const effects = {read:'只读',write:'写入',destructive:'破坏性操作'};
  return <div data-app-capabilities className="min-w-0">
    <div className="text-sm font-medium">{appCapabilitySummary(current)}</div>
    <p className="mt-1 text-xs leading-5 text-muted-foreground">{tools.length || skills.length || current.mcpServices?.length
      ? current.toolScope === 'global' ? '启用并授权后，Agent 可按需使用这些能力。' : '在会话选择此 App 后，Agent 可调用这些能力。'
      : '此 App 当前没有声明供 Agent 调用的工具或 skill。'}</p>
    {current.mcpServices?.some(service => service.catalogSource === 'cache') && <p className="mt-2 text-xs leading-5 text-muted-foreground">显示上次获取的工具清单，使用时会连接服务并更新。也可在下方手动刷新。</p>}
    {skills.length > 0 && <ul className="mt-3 grid gap-2">{skills.map(skill => <li key={skill.id} className="rounded-md border border-border px-3 py-2 text-xs"><span className="font-medium">{skill.title} · CLI skill</span><p className="mt-1 text-muted-foreground">{skill.description}</p><code className="mt-1 block break-all text-muted-foreground">{skill.id}</code></li>)}</ul>}
    {tools.length > 0 && <ul className="mt-3 grid gap-2">{tools.map(tool => <li key={tool.id} className="rounded-md border border-border px-3 py-2 text-xs"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{tool.title}</span><span className="text-muted-foreground">{effects[tool.effect]}</span><span className="ml-auto text-muted-foreground">{!current.enabled?'App 已停用':tool.permission&&!current.grants?.includes(tool.permission)?'未授权':'已注册'}</span></div><p className="mt-1 break-words leading-5 text-muted-foreground">{tool.description}</p><code className="mt-1 block break-all text-[11px] text-muted-foreground">{tool.id}</code></li>)}</ul>}
    {!!current.mcpServices?.length && <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[600px] table-fixed text-left" aria-label="此 App 的 MCP 工具"><colgroup><col className="w-32"/><col className="w-36"/><col/><col className="w-20"/><col className="w-20"/></colgroup><thead><tr className="border-b text-xs"><th className="p-2">服务</th><th>工具</th><th>说明</th><th>加载方式</th><th>状态</th></tr></thead>{current.mcpServices.map(service=><AppMcpToolRows key={`${service.instanceId}/${service.name}/${service.revision}`} app={current} service={service} onDiscovered={next=>{receive(next);onDiscovered?.(next);}}/>)}</table></div>}
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
  return <Popover><PopoverTrigger asChild><Button variant={compact ? 'ghost' : 'outline'} size="sm" className={compact ? 'h-auto max-w-60 gap-1 rounded px-1 py-0.5 text-[11px] font-normal text-muted-foreground' : 'h-8 max-w-60 gap-1.5 rounded-md px-2.5 text-xs'} title={current.mcpServices?.some(service => service.catalogSource === 'cache') ? '上次获取的工具清单；使用时更新' : '查看此 App 提供的 AI 能力'} aria-label={`查看 AI 能力：${appCapabilitySummary(current)}`}><Blocks className={compact ? 'h-3 w-3 shrink-0' : 'h-3.5 w-3.5 shrink-0'}/><span className="truncate">{appCapabilitySummary(current)}</span></Button></PopoverTrigger><PopoverContent align="end" className="max-h-[70vh] w-[min(720px,calc(100vw-32px))] overflow-auto p-4"><AppAgentTools app={current} onDiscovered={receive}/></PopoverContent></Popover>;
}
