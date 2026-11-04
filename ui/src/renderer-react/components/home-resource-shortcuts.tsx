import * as React from 'react';
import { ArrowUpRight, Bot, Check, FolderKanban, Hammer } from 'lucide-react';
import { AssistantAvatar, getSelectableInstalledAssistants, type InstalledAssistant } from '@/components/assistant-selection-area';
import { getSelectableInstalledSkills, SkillIcon, type InstalledSkillOption } from '@/components/skill-selection-area';
import { ProjectIcon } from '@/components/projects/project-icon';
import { cn } from '@/lib/utils';
import { rankHomeResources, useHomeResourceUsage } from '@/lib/home-resource-usage';
import type { Project } from '@/types';

export type HomeShortcutOptions = {
  projects: Project[];
  onOpenProject: (project: Project) => void;
};

function ShortcutRow({ label, icon: Icon, children }: {
  label: string;
  icon: typeof Bot;
  children: React.ReactNode;
}) {
  return <section aria-label={`常用${label}`} className="grid min-w-0 items-center gap-x-3 gap-y-2 @[520px]/shortcuts:grid-cols-[64px_1fr]">
    <h2 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </h2>
    <div className="flex min-w-0 flex-wrap gap-2">
      {children}
    </div>
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
      'group flex h-9 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-xs shadow-[0_2px_8px_-3px_rgb(0_0_0/0.14)] transition-[background-color,color,box-shadow,transform] duration-150 hover:shadow-[0_4px_12px_-3px_rgb(0_0_0/0.18)] motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background @[520px]/shortcuts:max-w-[calc((100%-1rem)/3)]',
      selected ? 'bg-primary/12 text-primary hover:bg-primary/18' : 'bg-card/80 text-foreground/85 hover:bg-card hover:text-foreground',
    )}>
    <span className="shrink-0 text-muted-foreground">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{title}</span>
    {project ? <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground/65" aria-hidden="true" />
      : selected ? <Check className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
  </button>;
}

export function HomeResourceShortcuts({ options, assistants, skills, selectedAssistant, selectedSkills,
  onSelectAssistant, onClearAssistant, onToggleSkill,
}: {
  options: HomeShortcutOptions;
  assistants: InstalledAssistant[];
  skills: InstalledSkillOption[];
  selectedAssistant?: InstalledAssistant | null;
  selectedSkills: InstalledSkillOption[];
  onSelectAssistant: (assistant: InstalledAssistant) => void;
  onClearAssistant: () => void;
  onToggleSkill: (skill: InstalledSkillOption) => void;
}) {
  const usage = useHomeResourceUsage();
  const shortcuts = React.useMemo(() => ({
    projects: rankHomeResources(options.projects.filter(project => !project.archivedAt), project => project.id, usage.projects),
    assistants: rankHomeResources(getSelectableInstalledAssistants(assistants), assistant => assistant.name, usage.assistants),
    skills: rankHomeResources(getSelectableInstalledSkills(skills), skill => skill.name, usage.skills),
  }), [options.projects, assistants, skills, usage]);

  if (!shortcuts.projects.length && !shortcuts.assistants.length && !shortcuts.skills.length) return null;

  return <nav aria-label="常用快捷入口" className="@container/shortcuts mt-6 w-full max-w-[820px] space-y-3 px-1">
    {shortcuts.projects.length > 0 && <ShortcutRow label="项目" icon={FolderKanban}>
      {shortcuts.projects.map(project => <Shortcut key={project.id} project title={project.name} description={project.instructions}
        icon={<ProjectIcon icon={project.icon} badge={false} className="h-4 w-4" />} onClick={() => options.onOpenProject(project)} />)}
    </ShortcutRow>}
    {shortcuts.assistants.length > 0 && <ShortcutRow label="专家" icon={Bot}>
      {shortcuts.assistants.map(assistant => <Shortcut key={assistant.name} title={assistant.displayName || assistant.name} description={assistant.description}
        icon={<AssistantAvatar assistant={assistant} className="h-4 w-4" />} selected={selectedAssistant?.name === assistant.name}
        onClick={() => selectedAssistant?.name === assistant.name ? onClearAssistant() : onSelectAssistant(assistant)} />)}
    </ShortcutRow>}
    {shortcuts.skills.length > 0 && <ShortcutRow label="技能" icon={Hammer}>
      {shortcuts.skills.map(skill => <Shortcut key={skill.name} title={skill.displayName || skill.name} description={skill.description}
        icon={<SkillIcon skill={skill} className="h-4 w-4" />} selected={selectedSkills.some(item => item.name === skill.name)} onClick={() => onToggleSkill(skill)} />)}
    </ShortcutRow>}
  </nav>;
}
