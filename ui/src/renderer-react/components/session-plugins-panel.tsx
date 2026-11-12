import * as React from 'react';
import { AppWindow, Blocks, Bot, Hammer, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getAppToolServices, parseAppServiceKey, toolAppId, toolAppTitle } from '@/lib/app-tool-selection';
import type { InstalledAssistant, SessionDetail, StoredApp } from '@/types';
import type { InstalledSkillOption } from '@/components/skill-selection-area';

type PluginCard = {
  id: string;
  title: string;
  description?: string;
  meta?: string;
};

type PluginSection = {
  id: 'tools' | 'skills' | 'experts' | 'apps';
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: string;
  items: PluginCard[];
};

const sectionMeta: Record<PluginSection['id'], { title: string; icon: PluginSection['icon']; tone: string }> = {
  tools: { title: '工具', icon: Wrench, tone: 'text-sky-600 dark:text-sky-400' },
  skills: { title: '技能', icon: Hammer, tone: 'text-amber-600 dark:text-amber-400' },
  experts: { title: '专家', icon: Bot, tone: 'text-violet-600 dark:text-violet-400' },
  apps: { title: 'App', icon: AppWindow, tone: 'text-emerald-600 dark:text-emerald-400' },
};

function historyToolNames(history: SessionDetail['history'] = []) {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (record.type === 'tool_use') {
      const name = String(record.tool_name || record.name || record.display_name || '').trim();
      if (name && name !== 'Tool') names.add(name);
    }
    Object.values(record).forEach(child => {
      if (child && typeof child === 'object') visit(child);
    });
  };
  visit(history);
  return [...names];
}

function selectedAppIds(session: SessionDetail | null, apps: StoredApp[]) {
  if (!session) return [];
  const ids = new Set(session.appIds || []);
  for (const serviceKey of session.appServiceIds || []) {
    const ref = parseAppServiceKey(serviceKey);
    if (ref?.appId) ids.add(ref.appId);
  }
  const connectorIds = new Set(session.connectorIds || []);
  for (const app of apps) {
    if (app.connectorApp?.id && connectorIds.has(app.connectorApp.id)) ids.add(toolAppId(app));
  }
  return [...ids];
}

function appToolCards(session: SessionDetail | null, apps: StoredApp[]): PluginCard[] {
  if (!session) return [];
  const serviceIds = new Set(session.appServiceIds || []);
  const cards: PluginCard[] = [];
  const seen = new Set<string>();
  for (const appId of selectedAppIds(session, apps)) {
    const app = apps.find(item => toolAppId(item) === appId);
    if (!app) continue;
    const selectedServices = new Set(getAppToolServices(app)
      .filter(service => serviceIds.has(service.id))
      .map(service => service.serviceId));
    for (const tool of app.agentTools || []) {
      if (app.toolSelection === 'services' && tool.serviceId && !selectedServices.has(tool.serviceId)) continue;
      const id = `app:${appId}:${tool.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      cards.push({ id, title: tool.title || tool.name || tool.id, description: tool.description, meta: toolAppTitle(app) });
    }
    for (const service of app.mcpServices || []) {
      const selected = selectedServices.has(service.serviceId || '');
      if ((app.toolSelection === 'services' && !selected) || (app.toolSelection !== 'services' && service.status === 'disabled')) continue;
      for (const tool of service.tools || []) {
        if (tool.disabled) continue;
        const id = `mcp:${appId}:${service.serviceId || service.name}:${tool.name}`;
        if (seen.has(id)) continue;
        seen.add(id);
        cards.push({ id, title: tool.name, description: tool.description, meta: `${toolAppTitle(app)} · ${service.name}` });
      }
    }
  }
  return cards;
}

export function hasSessionPlugins(session: SessionDetail | null, apps: StoredApp[]) {
  if (!session) return false;
  return Boolean(
    session.skillIds?.length
      || session.assistantName?.trim()
      || selectedAppIds(session, apps).length
      || historyToolNames(session.history).length,
  );
}

function PluginCardView({ item }: { item: PluginCard }) {
  return <article className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/70 bg-background/70 p-3 shadow-sm">
    <h4 className="break-words text-xs font-medium text-foreground">{item.title}</h4>
    {item.description && <p className="line-clamp-3 break-words text-[11px] leading-4 text-muted-foreground">{item.description}</p>}
    {item.meta && <p className="truncate text-[10px] text-muted-foreground/80" title={item.meta}>{item.meta}</p>}
  </article>;
}

function PluginSectionView({ section }: { section: PluginSection }) {
  if (!section.items.length) return null;
  const Icon = section.icon;
  return <section aria-labelledby={`session-plugin-${section.id}`}>
    <div className="mb-2 flex items-center gap-1.5">
      <Icon size={14} className={section.tone} />
      <h3 id={`session-plugin-${section.id}`} className="text-xs font-semibold">{section.title}</h3>
      <span className="text-[10px] tabular-nums text-muted-foreground">{section.items.length}</span>
    </div>
    <div className="grid grid-cols-1 gap-2">{section.items.map(item => <PluginCardView key={item.id} item={item} />)}</div>
  </section>;
}

export function SessionPluginsPanel({ session, apps, installedAssistants }: {
  session: SessionDetail;
  apps: StoredApp[];
  installedAssistants: InstalledAssistant[];
}) {
  const [skills, setSkills] = React.useState<InstalledSkillOption[]>([]);
  const skillIds = session.skillIds || [];

  React.useEffect(() => {
    let active = true;
    if (!skillIds.length) { setSkills([]); return () => { active = false; }; }
    void window.agentDesktop.getInstalledSkills().then((result: any) => {
      if (!active) return;
      const entries = Array.isArray(result?.data) ? result.data : Array.isArray(result) ? result : [];
      const wanted = new Set(skillIds);
      const found = entries.filter((skill: InstalledSkillOption & { id?: string }) => wanted.has(skill.name) || (skill.id && wanted.has(skill.id)));
      const known = new Set(found.flatMap((skill: InstalledSkillOption & { id?: string }) => [skill.name, skill.id].filter(Boolean) as string[]));
      setSkills([...found, ...skillIds.filter(id => !known.has(id)).map(name => ({ name, displayName: name }))]);
    }).catch(() => {
      if (active) setSkills(skillIds.map(name => ({ name, displayName: name })));
    });
    return () => { active = false; };
  }, [session.id, skillIds.join('\u0000')]);

  const sections = React.useMemo<PluginSection[]>(() => {
    const toolCards = appToolCards(session, apps);
    const knownTools = new Set(toolCards.map(item => item.title));
    for (const name of historyToolNames(session.history)) {
      if (knownTools.has(name)) continue;
      knownTools.add(name);
      toolCards.push({ id: `history:${name}`, title: name, description: '本会话已加载并使用', meta: '会话工具' });
    }
    const assistant = installedAssistants.find(item => item.name === session.assistantName) || null;
    const expertCards: PluginCard[] = session.assistantName ? [{
      id: `expert:${session.assistantName}`,
      title: assistant?.displayName || session.assistantName,
      description: assistant?.description,
      meta: assistant?.category || '当前会话专家',
    }] : [];
    const skillCards: PluginCard[] = skills.map(skill => ({
      id: `skill:${skill.name}`,
      title: skill.displayName || skill.name,
      description: skill.description,
      meta: skill.source || '当前会话技能',
    }));
    const appCards: PluginCard[] = selectedAppIds(session, apps).map(id => {
      const app = apps.find(item => toolAppId(item) === id);
      const selectedServices = app ? getAppToolServices(app).filter(service => (session.appServiceIds || []).includes(service.id)).map(service => service.title) : [];
      return { id: `app:${id}`, title: app ? toolAppTitle(app) : id, description: app?.description, meta: selectedServices.length ? `服务：${selectedServices.join('、')}` : '当前会话 App' };
    });
    return (['tools', 'skills', 'experts', 'apps'] as const).map(id => ({ id, ...sectionMeta[id], items: id === 'tools' ? toolCards : id === 'skills' ? skillCards : id === 'experts' ? expertCards : appCards }));
  }, [apps, installedAssistants, session, skills]);

  return <div data-session-plugins className="min-h-0 flex-1 overflow-y-auto p-3">
    <div className="mb-3 flex items-center gap-2"><Blocks size={15} className="text-primary" /><h2 className="text-sm font-semibold">当前会话插件</h2></div>
    <div className={cn('space-y-4', !sections.some(section => section.items.length) && 'hidden')}>
      {sections.map(section => <PluginSectionView key={section.id} section={section} />)}
    </div>
  </div>;
}
