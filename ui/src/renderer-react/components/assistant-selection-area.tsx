import React from 'react';
import { Bot, Check, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import { cn } from '@/lib/utils';
import {
  QUICK_SELECTION_LIMIT,
  rankRecentItems,
  useRecentIds,
} from '@/lib/recent-selection';

const ASSISTANT_RECENTS_KEY = 'ui.recentAssistants.v1';

export type InstalledAssistant = {
  name: string;
  displayName: string;
  description: string;
  avatar: string;
  emoji: string;
  category: string;
  categories: string[];
  version: string;
  source: string;
  isBuiltin: boolean;
  isHubInstalled: boolean;
  tag: string;
  enabled: boolean;
  skills: string[];
  enabledSkills: string[];
};

type AssistantSelectionAreaProps = {
  assistants: InstalledAssistant[];
  selectedAssistant: InstalledAssistant | null;
  onSelectAssistant: (assistant: InstalledAssistant) => void;
  onOpenExpertHub?: () => void;
};

const isDataUri = (value: string) => value.startsWith('data:');

const AssistantAvatar: React.FC<{
  assistant: InstalledAssistant;
  className?: string;
}> = ({ assistant, className }) => {
  const emojiOrAvatar = assistant.emoji?.trim() || assistant.avatar?.trim();
  const isImage = emojiOrAvatar
    ? /\.(svg|png|jpe?g|webp|gif)$/i.test(emojiOrAvatar) || isDataUri(emojiOrAvatar)
    : false;

  if (!emojiOrAvatar) return <Bot className={cn('shrink-0', className)} />;
  if (isImage) {
    return <img src={emojiOrAvatar} alt="" className={cn('shrink-0 object-contain', className)} />;
  }
  return <span className="shrink-0 text-sm leading-none">{emojiOrAvatar}</span>;
};

const AssistantPill: React.FC<{
  assistant: InstalledAssistant;
  isSelected: boolean;
  onClick: () => void;
  className?: string;
}> = ({ assistant, isSelected, onClick, className }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={isSelected}
    className={cn(
      'group flex h-7 min-w-0 max-w-[144px] items-center gap-1.5 rounded-full border bg-transparent px-2.5 text-sm transition-colors',
      isSelected
        ? 'border-primary bg-primary/10 text-foreground'
        : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
      className,
    )}
    title={assistant.description || assistant.displayName || assistant.name}
  >
    <AssistantAvatar assistant={assistant} className="h-3.5 w-3.5" />
    <span className="truncate">{assistant.displayName || assistant.name}</span>
    {isSelected ? <Check className="h-3 w-3 shrink-0 text-primary" /> : null}
  </button>
);

export const AssistantSelectionArea: React.FC<AssistantSelectionAreaProps> = ({
  assistants,
  selectedAssistant,
  onSelectAssistant,
  onOpenExpertHub,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const { recentIds, remember } = useRecentIds(ASSISTANT_RECENTS_KEY);

  const installed = React.useMemo(() => assistants
    .filter((assistant) => assistant.enabled !== false)
    .sort((a, b) => {
      if (a.name === 'cowork') return -1;
      if (b.name === 'cowork') return 1;
      return String(a.displayName || a.name).localeCompare(
        String(b.displayName || b.name),
        'zh-Hans-CN',
      );
    }), [assistants]);
  const quickAssistants = React.useMemo(
    () => rankRecentItems(
      installed,
      (assistant) => assistant.name,
      selectedAssistant ? [selectedAssistant.name] : [],
      recentIds,
      QUICK_SELECTION_LIMIT,
    ),
    [installed, recentIds, selectedAssistant],
  );
  const filteredAssistants = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hans-CN');
    if (!normalizedQuery) return installed;
    return installed.filter((assistant) => [
      assistant.displayName,
      assistant.name,
      assistant.description,
      assistant.category,
      ...(assistant.categories || []),
    ].some((value) => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(normalizedQuery)));
  }, [installed, query]);

  const handleSelect = React.useCallback((assistant: InstalledAssistant, closeAfterSelect = false) => {
    remember(assistant.name);
    onSelectAssistant(assistant);
    if (closeAfterSelect) {
      setPickerOpen(false);
      setQuery('');
    }
  }, [onSelectAssistant, remember]);
  const closePicker = React.useCallback(() => {
    setPickerOpen(false);
    setQuery('');
  }, []);

  if (installed.length === 0) return null;

  return (
    <>
      <div className="flex w-full min-w-0 items-center justify-center gap-2">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          {quickAssistants.map((assistant, index) => (
            <AssistantPill
              key={assistant.name}
              assistant={assistant}
              isSelected={selectedAssistant?.name === assistant.name}
              onClick={() => handleSelect(assistant)}
              className={index >= 3 ? 'hidden lg:flex' : undefined}
            />
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 rounded-full px-2.5 text-xs text-muted-foreground"
          onClick={() => setPickerOpen(true)}
          title="选择助手"
        >
          <ListFilter className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">选择助手</span>
          {installed.length > QUICK_SELECTION_LIMIT ? (
            <span className="text-[11px] text-muted-foreground/70">{installed.length}</span>
          ) : null}
        </Button>
      </div>

      <SelectionPickerDialog
        open={pickerOpen}
        title="选择助手"
        description={`已安装 ${installed.length} 个${selectedAssistant ? '，已选择 1 个' : ''}`}
        searchPlaceholder="搜索助手"
        query={query}
        onQueryChange={setQuery}
        onClose={closePicker}
        icon={<Bot className="h-4 w-4" />}
        resultCount={filteredAssistants.length}
        totalCount={installed.length}
        emptyLabel="没有匹配的助手"
        managerLabel="打开专家中心"
        onOpenManager={onOpenExpertHub}
      >
        <div className="space-y-1">
          {filteredAssistants.map((assistant) => {
            const isSelected = selectedAssistant?.name === assistant.name;
            return (
              <button
                key={assistant.name}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleSelect(assistant, true)}
                className={cn(
                  'flex h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
                  <AssistantAvatar assistant={assistant} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {assistant.displayName || assistant.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {assistant.description || assistant.category || assistant.name}
                  </span>
                </span>
                {isSelected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      </SelectionPickerDialog>
    </>
  );
};
