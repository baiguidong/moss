import * as React from 'react';
import { ArrowUpRight, Bot, Check, ChevronRight, FolderKanban, Hammer } from 'lucide-react';
import { AssistantAvatar, getSelectableInstalledAssistants, type InstalledAssistant } from '@/components/assistant-selection-area';
import { getSelectableInstalledSkills, SkillIcon, type InstalledSkillOption } from '@/components/skill-selection-area';
import { ProjectIcon } from '@/components/projects/project-icon';
import { cn } from '@/lib/utils';
import type { Project, SessionSummary } from '@/types';

export type HomeShortcutOptions = {
  projects: Project[];
  sessions: SessionSummary[];
  onOpenProject: (project: Project) => void;
  onOpenProjects: () => void;
};

const SHORTCUT_LIMIT = 3;
type Usage = { count: number; latest: number };

function ShortcutRow({ label, icon: Icon, onMore, children, empty }: {
  label: string;
  icon: typeof Bot;
  onMore: () => void;
  children: React.ReactNode;
  empty?: string;
}) {
  return <section aria-label={`常用${label}`} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 @[520px]/shortcuts:grid-cols-[64px_1fr_auto]">
    <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </h2>
    <div className="col-span-2 row-start-2 grid min-w-0 grid-cols-2 gap-2 [&>button:nth-child(n+3)]:hidden @[520px]/shortcuts:col-span-1 @[520px]/shortcuts:col-start-2 @[520px]/shortcuts:row-start-1 @[520px]/shortcuts:grid-cols-3 @[520px]/shortcuts:[&>button:nth-child(n+3)]:flex">
      {empty ? <span className="col-span-full py-2 text-xs text-muted-foreground/75">{empty}</span> : children}
    </div>
    <button type="button" onClick={onMore} aria-label={`更多${label}`} title={`更多${label}`}
      className="col-start-2 row-start-1 flex h-7 items-center gap-0.5 rounded-md px-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring @[520px]/shortcuts:col-start-3">
      更多<ChevronRight className="h-3 w-3" aria-hidden="true" />
    </button>
  </section>;
}

function Shortcut({ title, description, icon, selected, onClick, project = false }: {
  title: string;
  description?: string;
  icon: React.ReactNode;
  selected?: boolean;
  onClick: () => void;
  project?: boolean;
}) {
  return <button type="button" onClick={onClick} aria-pressed={project ? undefined : selected}
    aria-label={project ? `进入项目会话：${title}` : title}
    title={[title, description, project ? '进入项目会话' : selected ? '点击取消选择' : '加入会话资源'].filter(Boolean).join('\n')}
    className={cn(
      'group flex h-9 min-w-0 items-center gap-2 rounded-xl border px-2.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      selected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border/60 bg-card/65 text-foreground/85 shadow-sm hover:border-primary/25 hover:bg-card',
    )}>
    <span className="shrink-0 text-muted-foreground">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{title}</span>
    {project ? <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground/65" aria-hidden="true" />
      : selected ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
  </button>;
}

export function HomeResourceShortcuts({ options, assistants, skills, selectedAssistant, selectedSkills, skillsLoading,
  onSelectAssistant, onClearAssistant, onToggleSkill, onMoreAssistants, onMoreSkills,
}: {
  options: HomeShortcutOptions;
  assistants: InstalledAssistant[];
  skills: InstalledSkillOption[];
  selectedAssistant?: InstalledAssistant | null;
  selectedSkills: InstalledSkillOption[];
  skillsLoading: boolean;
  onSelectAssistant: (assistant: InstalledAssistant) => void;
  onClearAssistant: () => void;
  onToggleSkill: (skill: InstalledSkillOption) => void;
  onMoreAssistants: () => void;
  onMoreSkills: () => void;
}) {
  const shortcuts = React.useMemo(() => {
    const projectUsage = new Map<string, Usage>(), expertUsage = new Map<string, Usage>(), skillUsage = new Map<string, Usage>();
    const record = (usage: Map<string, Usage>, id: string | null | undefined, time: number) => {
      if (!id) return;
      const previous = usage.get(id);
      usage.set(id, { count: (previous?.count || 0) + 1, latest: Math.max(previous?.latest || 0, time) });
    };
    for (const session of options.sessions) {
      if (session.isSubAgent || session.archivedAt) continue;
      record(projectUsage, session.projectId, session.updatedAt);
      record(expertUsage, session.assistantName, session.updatedAt);
      for (const name of new Set(session.skillIds || [])) record(skillUsage, name, session.updatedAt);
    }
    const compare = (usage: Map<string, Usage>, a: string, b: string) =>
      (usage.get(b)?.count || 0) - (usage.get(a)?.count || 0)
      || (usage.get(b)?.latest || 0) - (usage.get(a)?.latest || 0);
    return {
      projects: options.projects.filter(project => !project.archivedAt)
        .sort((a, b) => compare(projectUsage, a.id, b.id) || b.updatedAt - a.updatedAt).slice(0, SHORTCUT_LIMIT),
      assistants: getSelectableInstalledAssistants(assistants)
        .sort((a, b) => compare(expertUsage, a.name, b.name)).slice(0, SHORTCUT_LIMIT),
      skills: getSelectableInstalledSkills(skills)
        .filter((skill, index, all) => all.findIndex(item => item.name === skill.name) === index)
        .sort((a, b) => compare(skillUsage, a.name, b.name)).slice(0, SHORTCUT_LIMIT),
    };
  }, [options.projects, options.sessions, assistants, skills]);

  return <nav aria-label="常用快捷入口" className="@container/shortcuts mt-6 w-full max-w-[820px] space-y-3 px-1">
    <ShortcutRow label="项目" icon={FolderKanban} onMore={options.onOpenProjects} empty={!shortcuts.projects.length ? '暂无项目' : undefined}>
      {shortcuts.projects.map(project => <Shortcut key={project.id} project title={project.name} description={project.instructions}
        icon={<ProjectIcon icon={project.icon} badge={false} className="h-4 w-4" />} onClick={() => options.onOpenProject(project)} />)}
    </ShortcutRow>
    <ShortcutRow label="专家" icon={Bot} onMore={onMoreAssistants} empty={!shortcuts.assistants.length ? '暂无可用专家' : undefined}>
      {shortcuts.assistants.map(assistant => <Shortcut key={assistant.name} title={assistant.displayName || assistant.name} description={assistant.description}
        icon={<AssistantAvatar assistant={assistant} className="h-4 w-4" />} selected={selectedAssistant?.name === assistant.name}
        onClick={() => selectedAssistant?.name === assistant.name ? onClearAssistant() : onSelectAssistant(assistant)} />)}
    </ShortcutRow>
    <ShortcutRow label="技能" icon={Hammer} onMore={onMoreSkills} empty={!shortcuts.skills.length ? skillsLoading ? '正在读取技能…' : '暂无可用技能' : undefined}>
      {shortcuts.skills.map(skill => <Shortcut key={skill.name} title={skill.displayName || skill.name} description={skill.description}
        icon={<SkillIcon skill={skill} className="h-4 w-4" />} selected={selectedSkills.some(item => item.name === skill.name)} onClick={() => onToggleSkill(skill)} />)}
    </ShortcutRow>
  </nav>;
}
