import * as React from 'react';
import { AppWindow, Bot, Hammer, Wrench } from 'lucide-react';
import { AppIcon } from '@/components/app-icon';
import { ResourceIcon } from '@/components/resource-icon';
import { AssistantAvatar } from '@/components/assistant-selection-area';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { InstalledAssistant, SessionDetail, StoredApp } from '@/types';

type ModelTool = { id: string; name: string; title: string; description?: string; source?: string; appId?: string };
type ModelSkill = { id: string; name: string; displayName?: string; description?: string; icon?: string; source?: string };
type ModelExpert = { id: string; name: string; displayName?: string; description?: string; avatar?: string; emoji?: string };
type ModelApp = { id: string; name?: string; displayName?: string; description?: string; icon?: string };
export type SessionPluginCatalog = { tools: ModelTool[]; skills: ModelSkill[]; experts?: ModelExpert[]; apps?: ModelApp[] };

type PluginCard = { id: string; title: string; subtitle?: string; description?: string; meta?: string; badges?: string[]; icon: React.ReactNode };
type PluginSection = { id: 'tools' | 'skills' | 'experts' | 'apps'; title: string; icon: React.ComponentType<{ className?: string }>; items: PluginCard[] };

const sectionMeta: Record<PluginSection['id'], { title: string; icon: PluginSection['icon'] }> = {
  tools: { title: '工具', icon: Wrench }, skills: { title: '技能', icon: Hammer }, experts: { title: '专家', icon: Bot }, apps: { title: 'App', icon: AppWindow },
};

function firstText(...values: unknown[]) {
  return values.map(value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '').find(Boolean) || '';
}

export function hasSessionPlugins(session: SessionDetail | null, _apps: StoredApp[]) {
  return Boolean(session && session.agentMode !== 'remote-direct');
}

function toolIcon() {
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wrench className="h-4 w-4" /></span>;
}

function PluginCardView({ item }: { item: PluginCard }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <div tabIndex={0} role="group" aria-label={`${item.title}，悬停或聚焦查看详情`} className="group flex h-12 min-w-0 items-center gap-2 rounded-xl border border-border/65 bg-card/70 px-2.5 text-left transition-colors hover:border-primary/35 hover:bg-card focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25">
        <span className="shrink-0">{item.icon}</span><span className="min-w-0 truncate text-xs font-medium text-foreground" title={item.title}>{item.title}</span>
      </div>
    </TooltipTrigger>
    <TooltipContent side="top" align="start" sideOffset={8} collisionPadding={12} className="max-w-80 border border-border/80 bg-popover px-3 py-2.5 text-popover-foreground shadow-xl [&>svg]:bg-popover [&>svg]:fill-popover">
      <div className="space-y-1.5"><div className="font-semibold leading-5">{item.title}</div>{item.subtitle ? <div className="text-[11px] text-muted-foreground">{item.subtitle}</div> : null}<p className="text-xs leading-5 text-muted-foreground">{item.description || '暂无描述'}</p>{item.badges?.length || item.meta ? <div className="flex min-w-0 flex-wrap items-center gap-1.5 pt-0.5">{(item.badges || []).map((badge, index) => <Badge key={`${badge}-${index}`} variant="outline" className="rounded-md text-[11px]">{badge}</Badge>)}{item.meta ? <span className="truncate text-[11px] text-muted-foreground">{item.meta}</span> : null}</div> : null}</div>
    </TooltipContent>
  </Tooltip>;
}

function PluginSectionView({ section }: { section: PluginSection }) {
  if (!section.items.length) return null;
  const Icon = section.icon;
  return <section aria-labelledby={`session-plugin-${section.id}`}>
    <div className="mb-2 flex items-center gap-2 px-1"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><h2 id={`session-plugin-${section.id}`} className="text-sm font-semibold text-foreground">{section.title}</h2><span className="text-xs text-muted-foreground">{section.items.length}</span></div>
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 132px), 1fr))' }}>{section.items.map(item => <PluginCardView key={item.id} item={item} />)}</div>
  </section>;
}

export function SessionPluginsPanel({ session, apps: _apps, installedAssistants: _installedAssistants, initialCatalog }: {
  session: SessionDetail;
  apps: StoredApp[];
  installedAssistants: InstalledAssistant[];
  initialCatalog?: SessionPluginCatalog;
}) {
  const [catalog, setCatalog] = React.useState<SessionPluginCatalog>(initialCatalog || { tools: [], skills: [], experts: [], apps: [] });
  React.useEffect(() => {
    let active = true;
    void window.agentDesktop.getSessionPluginCatalog({ sessionId: session.id }).then(value => {
      if (active && value) setCatalog(value as SessionPluginCatalog);
    }).catch(() => {});
    return () => { active = false; };
  }, [session.id, session.assistantName, (session.skillIds || []).join('\u0000'), (session.appIds || []).join('\u0000'), (session.appServiceIds || []).join('\u0000'), (session.connectorIds || []).join('\u0000')]);

  const sections = React.useMemo<PluginSection[]>(() => {
    const toolCards: PluginCard[] = catalog.tools.map(tool => ({ id: `tool:${tool.id}`, title: firstText(tool.title, tool.name, tool.id), description: tool.description, meta: tool.source === 'built-in' ? 'Moss 内置工具' : tool.source === 'mcp' ? 'MCP 工具' : '当前会话 App 工具', badges: [tool.source === 'built-in' ? '内置' : tool.source === 'mcp' ? 'MCP' : 'App'], icon: toolIcon() }));
    const skillCards: PluginCard[] = catalog.skills.map(skill => ({ id: `skill:${skill.id}`, title: firstText(skill.displayName, skill.name, skill.id), description: skill.description, meta: skill.source || '当前 Agent 技能', icon: <ResourceIcon source={skill.icon} label={skill.displayName || skill.name} fallback={Hammer} /> }));
    const expertCards: PluginCard[] = (catalog.experts || []).map(expert => ({ id: `expert:${expert.id}`, title: firstText(expert.displayName, expert.name, expert.id), description: expert.description, meta: '当前会话专家', icon: <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary"><AssistantAvatar assistant={expert as unknown as InstalledAssistant} className="h-5 w-5" /></span> }));
    const appCards: PluginCard[] = (catalog.apps || []).map(app => ({ id: `app:${app.id}`, title: firstText(app.displayName, app.name, app.id), description: app.description, meta: '当前会话 App', icon: <AppIcon icon={app.icon} className="h-7 w-7 rounded-lg" /> }));
    return (['tools', 'skills', 'experts', 'apps'] as const).map(id => ({ id, ...sectionMeta[id], items: id === 'tools' ? toolCards : id === 'skills' ? skillCards : id === 'experts' ? expertCards : appCards }));
  }, [catalog]);

  return <div data-session-plugins className="min-h-0 flex-1 overflow-y-auto bg-background px-3 py-3"><div className="space-y-5">{sections.map(section => <PluginSectionView key={section.id} section={section} />)}</div></div>;
}
