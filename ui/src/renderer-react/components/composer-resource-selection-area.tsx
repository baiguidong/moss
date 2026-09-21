import * as React from 'react';
import { Bot, Cable, Check, GitFork, Hammer, ListFilter } from 'lucide-react';
import {
  AssistantAvatar,
  getSelectableInstalledAssistants,
  type InstalledAssistant,
} from '@/components/assistant-selection-area';
import {
  ConnectorIcon,
  connectorTypeLabel,
  getSelectableInstalledConnectors,
} from '@/components/connector-selection-area';
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
import type { DesktopAgentDefinition, InstalledConnector } from '@/types';

type ComposerResourceSelectionAreaProps = {
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
  connectors?: InstalledConnector[];
  selectedConnectorIds?: string[];
  onToggleConnector?: (connector: InstalledConnector) => void;
  onOpenConnectorHub?: () => void;
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
  connectors: {
    label: '连接器',
    managerLabel: '管理连接器',
    searchPlaceholder: '搜索连接器',
    icon: <Cable className="h-4 w-4" />,
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
  onSelect,
}: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  singleSelect?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'flex h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
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
      {singleSelect ? (
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
  connectors = [],
  selectedConnectorIds = [],
  onToggleConnector,
  onOpenConnectorHub,
  triggerVisible = true,
  openTab = null,
  onOpenTabChange,
}: ComposerResourceSelectionAreaProps) {
  const tabs = React.useMemo(() => getComposerResourceTabs({
    includeAssistants: Boolean(onSelectAssistant),
    includeAgents: Boolean(onSelectAgent),
    includeSkills: Boolean(onToggleSkill),
    includeConnectors: Boolean(onToggleConnector),
  }), [onSelectAgent, onSelectAssistant, onToggleConnector, onToggleSkill]);
  const [open, setOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<ComposerResourceTab>(() => tabs[0] ?? 'skills');
  const [query, setQuery] = React.useState('');
  const displayedTab = openTab ?? activeTab;
  const pickerOpen = openTab !== null || open;

  React.useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0] ?? 'skills');
  }, [activeTab, tabs]);

  const installedAssistants = React.useMemo(
    () => getSelectableInstalledAssistants(assistants),
    [assistants],
  );
  const installedSkills = React.useMemo(() => getSelectableInstalledSkills(skills), [skills]);
  const activeAgents = React.useMemo(() => agents.filter((agent) => agent.active), [agents]);
  const installedConnectors = React.useMemo(
    () => getSelectableInstalledConnectors(connectors),
    [connectors],
  );
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
  const filteredConnectors = React.useMemo(() => installedConnectors.filter((connector) => matchesQuery([
    connector.name,
    connector.description,
    connector.type,
  ], query)), [installedConnectors, query]);

  if (tabs.length === 0) return null;

  const selectedSkillNames = new Set(selectedSkills.map((skill) => skill.name));
  const selectedConnectors = new Set(selectedConnectorIds);
  const selectedCount = (tabs.includes('assistants') && selectedAssistant ? 1 : 0)
    + (tabs.includes('agents') && selectedAgent ? 1 : 0)
    + (tabs.includes('skills')
      ? installedSkills.filter((skill) => selectedSkillNames.has(skill.name)).length
      : 0)
    + (tabs.includes('connectors')
      ? installedConnectors.filter((connector) => selectedConnectors.has(connector.id)).length
      : 0);
  const activeItems = displayedTab === 'assistants'
    ? filteredAssistants
    : displayedTab === 'agents'
      ? filteredAgents
    : displayedTab === 'skills'
      ? filteredSkills
      : filteredConnectors;
  const activeTotal = displayedTab === 'assistants'
    ? installedAssistants.length
    : displayedTab === 'agents'
      ? activeAgents.length
    : displayedTab === 'skills'
      ? installedSkills.length
      : installedConnectors.length;
  const meta = RESOURCE_TAB_META[displayedTab];
  const closePicker = () => {
    setOpen(false);
    setQuery('');
    onOpenTabChange?.(null);
  };
  const openManager = displayedTab === 'assistants'
    ? onOpenExpertHub
    : displayedTab === 'agents'
      ? onOpenAgentManager
    : displayedTab === 'skills'
      ? onOpenSkillHub
      : onOpenConnectorHub;
  const emptyLabel = displayedTab === 'assistants'
    ? '没有匹配的已安装专家'
    : displayedTab === 'agents'
      ? '没有匹配的已启用 Agent'
    : displayedTab === 'skills'
      ? skillsLoading ? '正在加载已安装技能...' : '没有匹配的已安装技能'
      : '没有匹配的已认证连接器';

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
        title={openTab ? `选择${meta.label}` : "选择资源"}
        description={openTab ? `选择会话所需${meta.label}` : `选择会话所需资源，已选 ${selectedCount} 项`}
        searchPlaceholder={meta.searchPlaceholder}
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
        contentHeader={openTab ? undefined : (
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
      >
        <div className="space-y-1">
          {displayedTab === 'assistants' ? filteredAssistants.map((assistant) => (
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
          )) : filteredConnectors.map((connector) => (
            <ResourceRow
              key={`connector:${connector.id}`}
              selected={selectedConnectors.has(connector.id)}
              icon={<ConnectorIcon connector={connector} className="h-4 w-4" />}
              title={connector.name}
              description={`${connectorTypeLabel(connector)}${connector.description ? ` · ${connector.description}` : ''}`}
              onSelect={() => onToggleConnector?.(connector)}
            />
          ))}
        </div>
      </SelectionPickerDialog>
    </>
  );
}
