import { AppToolSelectionContext, getToolPickerItems, getAppToolServices, toolAppId, toolAppTitle } from '@/lib/app-tool-selection';
import { AppIcon } from '@/components/app-icon';
import * as React from 'react';
import { resourceKey, type AppComposerResource } from '@/lib/app-composer';
import { ArrowLeft, Bot, Check, ChevronRight, GitFork, Hammer, ListFilter } from 'lucide-react';
import {
  AssistantAvatar,
  getSelectableInstalledAssistants,
  type InstalledAssistant,
} from '@/components/assistant-selection-area';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import {
  getSelectableInstalledSkills,
  SkillIcon,
  type InstalledSkillOption,
} from '@/components/skill-selection-area';
import { Button } from '@/components/ui/button';
import {
  getComposerResourceTabs,
  type ComposerResourceTab,
} from '@/lib/composer-mentions';
import { cn } from '@/lib/utils';
import type { DesktopAgentDefinition } from '@/types';

type ComposerResourceSelectionAreaProps = {
  appResources?: AppComposerResource[];
  appResourcesAvailable?: boolean;
  selectedAppResource?: AppComposerResource | null;
  onSelectAppResource?: (resource: AppComposerResource | null) => void;
  onAppResourceQuery?: (query: string) => void;
  onMoreAppResources?: () => void;
  assistants?: InstalledAssistant[];
  selectedAssistant?: InstalledAssistant | null;
  onSelectAssistant?: (assistant: InstalledAssistant) => void;
  onClearAssistant?: () => void;
  onOpenExpertHub?: () => void;
  agents?: DesktopAgentDefinition[];
  selectedAgent?: DesktopAgentDefinition | null;
  onSelectAgent?: (agent: DesktopAgentDefinition) => void;
  onClearAgent?: () => void;
  onOpenAgentManager?: () => void;
  skills?: InstalledSkillOption[];
  selectedSkills?: InstalledSkillOption[];
  onToggleSkill?: (skill: InstalledSkillOption) => void;
  onOpenSkillHub?: () => void;
  skillsLoading?: boolean;
  triggerVisible?: boolean;
  openTab?: ComposerResourceTab | null;
  onOpenTabChange?: (tab: ComposerResourceTab | null) => void;
};

const RESOURCE_TAB_META: Record<ComposerResourceTab, {
  label: string;
  managerLabel: string;
  searchPlaceholder: string;
  icon: React.ReactNode;
}> = {
  apps: { label: 'App', managerLabel: '管理 App', searchPlaceholder: '搜索 App 或子服务', icon: <AppIcon className="h-4 w-4" /> },
  workflows: { label:'工作流', managerLabel:'', searchPlaceholder:'搜索已发布工作流', icon:<GitFork className="h-4 w-4"/> },
  assistants: {
    label: '专家',
    managerLabel: '管理专家',
    searchPlaceholder: '搜索专家',
    icon: <Bot className="h-4 w-4" />,
  },
  agents: {
    label: 'Agents',
    managerLabel: '管理 Agents',
    searchPlaceholder: '搜索可用 Agents',
    icon: <GitFork className="h-4 w-4" />,
  },
  skills: {
    label: '技能',
    managerLabel: '技能市场',
    searchPlaceholder: '搜索已安装技能',
    icon: <Hammer className="h-4 w-4" />,
  },
};

function matchesQuery(values: Array<string | undefined>, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hans-CN');
  if (!normalizedQuery) return true;
  return values.some((value) => String(value || '')
    .toLocaleLowerCase('zh-Hans-CN')
    .includes(normalizedQuery));
}

function ResourceRow({
  selected,
  icon,
  title,
  description,
  singleSelect = false,
  expandable = false,
  disabled = false,
  onSelect,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  singleSelect?: boolean;
  expandable?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={expandable ? undefined : selected}
      aria-haspopup={expandable ? 'true' : undefined}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors disabled:opacity-50',
        selected ? 'bg-primary/10' : 'hover:bg-muted',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{description}</span>
      </span>
      {expandable ? <ChevronRight className="h-4 w-4 shrink-0" /> : singleSelect ? (
        selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null
      ) : (
        <span className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
        )}>
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      )}
    </button>
  );
}

export function ComposerResourceSelectionArea({
  appResources = [], appResourcesAvailable = false, selectedAppResource, onSelectAppResource, onAppResourceQuery, onMoreAppResources,
  assistants = [],
  selectedAssistant = null,
  onSelectAssistant,
  onClearAssistant,
  onOpenExpertHub,
  agents = [],
  selectedAgent = null,
  onSelectAgent,
  onClearAgent,
  onOpenAgentManager,
  skills = [],
  selectedSkills = [],
  onToggleSkill,
  onOpenSkillHub,
  skillsLoading = false,
  triggerVisible = true,
  openTab = null,
  onOpenTabChange,
}: ComposerResourceSelectionAreaProps) {
  const toolApps = React.useContext(AppToolSelectionContext);
  const tabs = React.useMemo(() => getComposerResourceTabs({
    includeApps: toolApps.enabled,
    includeAssistants: Boolean(onSelectAssistant),
    includeAgents: Boolean(onSelectAgent),
    includeSkills: Boolean(onToggleSkill),
    includeWorkflows: appResourcesAvailable,
  }), [toolApps.enabled, appResourcesAvailable, onSelectAgent, onSelectAssistant, onToggleSkill]);
  const [open, setOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<ComposerResourceTab>(() => tabs[0] ?? 'skills');
  const [query, setQuery] = React.useState('');
  const [serviceAppId, setServiceAppId] = React.useState<string | null>(null);
  const serviceApp = toolApps.apps.find(app => toolAppId(app) === serviceAppId);
  const selectedServiceIds = toolApps.selectedServiceIds || [];
  const displayedTab = openTab ?? activeTab;
  const pickerOpen = openTab !== null || open;
  React.useEffect(() => { if (!pickerOpen || displayedTab !== 'apps' || !serviceApp) setServiceAppId(null) }, [pickerOpen, displayedTab, serviceApp]);
  React.useEffect(() => { if (pickerOpen && displayedTab === 'workflows') onAppResourceQuery?.(query) }, [query, displayedTab, pickerOpen, onAppResourceQuery]);

  React.useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0] ?? 'skills');
  }, [activeTab, tabs]);

  const installedAssistants = React.useMemo(
    () => getSelectableInstalledAssistants(assistants),
    [assistants],
  );
  const installedSkills = React.useMemo(() => getSelectableInstalledSkills(skills), [skills]);
  const activeAgents = React.useMemo(() => agents.filter((agent) => agent.active), [agents]);
  const filteredAssistants = React.useMemo(() => installedAssistants.filter((assistant) => matchesQuery([
    assistant.displayName,
    assistant.name,
    assistant.description,
    assistant.category,
    ...(assistant.categories || []),
  ], query)), [installedAssistants, query]);
  const filteredSkills = React.useMemo(() => installedSkills.filter((skill) => matchesQuery([
    skill.displayName,
    skill.name,
    skill.description,
  ], query)), [installedSkills, query]);
  const filteredAgents = React.useMemo(() => activeAgents.filter((agent) => matchesQuery([
    agent.agentType,
    agent.description,
    agent.source,
  ], query)), [activeAgents, query]);
  const allToolApps = getToolPickerItems(toolApps.apps, '', toolApps.selectedIds, selectedServiceIds).map(item => item.app);
  const filteredToolItems = getToolPickerItems(toolApps.apps, query, toolApps.selectedIds, selectedServiceIds, serviceAppId);
  const availableServiceIds = serviceApp ? getAppToolServices(serviceApp).filter(service => service.available).map(service => service.id) : [];
  const allServicesSelected = availableServiceIds.length > 0 && availableServiceIds.every(id => selectedServiceIds.includes(id));
  if (tabs.length === 0) return null;

  const selectedSkillNames = new Set(selectedSkills.map((skill) => skill.name));
  const selectedCount = (toolApps.enabled ? (toolApps.selectedIds.length + selectedServiceIds.length) : 0) + (selectedAppResource ? 1 : 0) + (tabs.includes('assistants') && selectedAssistant ? 1 : 0)
    + (tabs.includes('agents') && selectedAgent ? 1 : 0)
    + (tabs.includes('skills')
      ? installedSkills.filter((skill) => selectedSkillNames.has(skill.name)).length
      : 0);
  const activeItems = displayedTab === 'apps' ? filteredToolItems : displayedTab === 'workflows' ? appResources : displayedTab === 'assistants'
    ? filteredAssistants
    : displayedTab === 'agents'
      ? filteredAgents
    : filteredSkills;
  const activeTotal = displayedTab === 'apps' ? (serviceApp ? getAppToolServices(serviceApp).length : allToolApps.length) : displayedTab === 'workflows' ? appResources.length : displayedTab === 'assistants'
    ? installedAssistants.length
    : displayedTab === 'agents'
      ? activeAgents.length
    : installedSkills.length;
  const meta = RESOURCE_TAB_META[displayedTab];
  const closePicker = () => {
    setOpen(false);
    setQuery('');
    setServiceAppId(null);
    onOpenTabChange?.(null);
  };
  const openManager = displayedTab === 'apps' ? toolApps.openManager : displayedTab === 'workflows' ? undefined : displayedTab === 'assistants'
    ? onOpenExpertHub
    : displayedTab === 'agents'
      ? onOpenAgentManager
    : onOpenSkillHub;
  const emptyLabel = displayedTab === 'apps' ? '没有匹配的带工具 App' : displayedTab === 'workflows' ? '没有匹配的已发布工作流' : displayedTab === 'assistants'
    ? '没有匹配的已安装专家'
    : displayedTab === 'agents'
      ? '没有匹配的已启用 Agent'
    : displayedTab === 'skills'
      ? skillsLoading ? '正在加载已安装技能...' : '没有匹配的已安装技能'
      : '没有匹配的资源';

  return (
    <>
      {triggerVisible ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 rounded-full border-border/70 bg-muted/35 px-2.5 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
          onClick={() => setOpen(true)}
          title={selectedCount > 0 ? `选择资源，已选 ${selectedCount} 项` : '选择资源'}
          aria-label={selectedCount > 0 ? `选择资源，已选 ${selectedCount} 项` : '选择资源'}
        >
          <ListFilter className="h-3.5 w-3.5" />
          <span>选择资源</span>
          {selectedCount > 0 ? (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/15 px-1 text-[10px] font-medium text-primary">
              {selectedCount}
            </span>
          ) : null}
        </Button>
      ) : null}

      <SelectionPickerDialog
        open={pickerOpen}
        title={serviceApp ? `选择${toolAppTitle(serviceApp)}的服务` : openTab ? `选择${meta.label}` : "选择资源"}
        description={serviceApp ? `可多选，已选 ${selectedServiceIds.filter(id => getAppToolServices(serviceApp).some(service => service.id === id)).length} 个服务` : openTab ? `选择会话所需${meta.label}` : `选择会话所需资源，已选 ${selectedCount} 项`}
        searchPlaceholder={serviceApp ? "搜索当前 App 的服务" : meta.searchPlaceholder}
        query={query}
        onQueryChange={setQuery}
        onClose={closePicker}
        icon={<ListFilter className="h-4 w-4" />}
        resultCount={activeItems.length}
        totalCount={activeTotal}
        emptyLabel={emptyLabel}
        managerLabel={meta.managerLabel}
        onOpenManager={openManager}
        managerPlacement="left"
        confirmLabel="确定"
        onConfirm={closePicker}
        contentHeader={<>
          {displayedTab === 'apps' && serviceApp && <div className="flex items-center justify-between gap-2">
            <button type="button" className="flex min-w-0 items-center gap-1 text-sm" onClick={() => { setServiceAppId(null); setQuery('') }}><ArrowLeft className="h-4 w-4 shrink-0" /><span className="truncate">{toolAppTitle(serviceApp)}</span></button>
            <button type="button" className="shrink-0 text-xs text-primary disabled:opacity-50" disabled={!availableServiceIds.length || toolApps.pending} onClick={() => toolApps.setServices?.(toolAppId(serviceApp), allServicesSelected ? [] : availableServiceIds)}>{allServicesSelected ? '清空服务选择' : '全选当前可用服务'}</button>
          </div>}
          {!openTab && (
          <div className="flex items-center gap-1" role="tablist" aria-label="资源类型">
            {tabs.map((tab) => {
              const tabMeta = RESOURCE_TAB_META[tab];
              const selected = displayedTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className={cn(
                    'flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors',
                    selected
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                  onClick={() => {
                    setActiveTab(tab);
                    setQuery('');
                  }}
                >
                  {tabMeta.icon}
                  <span className="truncate">{tabMeta.label}</span>
                </button>
              );
            })}
          </div>
          )}
        </>}
      >
        <div className="space-y-1">
          {displayedTab === 'apps' && filteredToolItems.some(item => item.app.toolScope === 'global') && <p className="px-3 pb-2 text-xs leading-5 text-muted-foreground">全局按需会在需要时加载，勾选可在本会话常驻。全局常驻已直接可用，可在 App 详情中调整。</p>}
          {displayedTab === 'apps' ? filteredToolItems.map((item, i) => <React.Fragment key={item.id}>
            <ResourceRow selected={item.selected} expandable={item.expandable} disabled={toolApps.pending || (item.resident && !item.expandable) || (!item.available && !item.selected && !item.expandable)}
              icon={<AppIcon icon={item.app.icon} className="h-5 w-5" />} title={item.title} description={item.description}
              onSelect={() => item.expandable ? (setServiceAppId(toolAppId(item.app)), setQuery('')) : item.service ? toolApps.toggleService?.(item.id) : toolApps.toggle(item.id)} />
          </React.Fragment>) : displayedTab === 'workflows' ? <>
            {appResources.map(resource => <ResourceRow key={resourceKey(resource)} selected={resourceKey(resource)===resourceKey(selectedAppResource)} icon={<GitFork className="h-4 w-4"/>} title={resource.title} description={`${resource.scope==='project'?'项目':'个人'} · ${resource.description || ''}`} singleSelect onSelect={() => onSelectAppResource?.(resourceKey(resource)===resourceKey(selectedAppResource)?null:resource)}/>)}
            {onMoreAppResources && <button className="p-2 text-xs" onClick={onMoreAppResources}>加载更多</button>}
          </> : displayedTab === 'assistants' ? filteredAssistants.map((assistant) => (
            <ResourceRow
              key={`assistant:${assistant.name}`}
              selected={selectedAssistant?.name === assistant.name}
              icon={<AssistantAvatar assistant={assistant} className="h-4 w-4" />}
              title={assistant.displayName || assistant.name}
              description={assistant.description || assistant.category || assistant.name}
              singleSelect
              onSelect={() => {
                if (selectedAssistant?.name === assistant.name) onClearAssistant?.();
                else onSelectAssistant?.(assistant);
              }}
            />
          )) : displayedTab === 'agents' ? filteredAgents.map((agent) => (
            <ResourceRow
              key={agent.id}
              selected={selectedAgent?.agentType === agent.agentType}
              icon={<GitFork className="h-4 w-4" />}
              title={agent.agentType}
              description={agent.description || agent.source}
              singleSelect
              onSelect={() => {
                if (selectedAgent?.agentType === agent.agentType) onClearAgent?.();
                else onSelectAgent?.(agent);
              }}
            />
          )) : displayedTab === 'skills' ? filteredSkills.map((skill) => (
            <ResourceRow
              key={`skill:${skill.name}`}
              selected={selectedSkillNames.has(skill.name)}
              icon={<SkillIcon skill={skill} className="h-4 w-4" />}
              title={skill.displayName || skill.name}
              description={skill.description || skill.name}
              onSelect={() => onToggleSkill?.(skill)}
            />
          )) : null}
        </div>
      </SelectionPickerDialog>
    </>
  );
}
