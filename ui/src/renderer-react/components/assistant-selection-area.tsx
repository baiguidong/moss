import React from 'react';
import { Bot, Check, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import { cn } from '@/lib/utils';

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
  onSelectAssistant?: (assistant: InstalledAssistant) => void;
  onClearAssistant?: () => void;
  onOpenExpertHub?: () => void;
  displayOnly?: boolean;
};

const isDataUri = (value: string) => value.startsWith('data:');

export const AssistantAvatar: React.FC<{
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

export function getSelectableInstalledAssistants(assistants: InstalledAssistant[]) {
  return assistants
    .filter((assistant) => assistant.enabled !== false)
    .sort((a, b) => {
      if (a.name === 'cowork') return -1;
      if (b.name === 'cowork') return 1;
      return String(a.displayName || a.name).localeCompare(
        String(b.displayName || b.name),
        'zh-Hans-CN',
      );
    });
}

export const AssistantSelectionArea: React.FC<AssistantSelectionAreaProps> = ({
  assistants,
  selectedAssistant,
  onSelectAssistant,
  onClearAssistant,
  onOpenExpertHub,
  displayOnly = false,
}) => {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const installed = React.useMemo(() => getSelectableInstalledAssistants(assistants), [assistants]);
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

  const handleSelect = React.useCallback((assistant: InstalledAssistant) => {
    if (selectedAssistant?.name === assistant.name && onClearAssistant) {
      onClearAssistant();
    } else {
      onSelectAssistant?.(assistant);
    }
  }, [onClearAssistant, onSelectAssistant, selectedAssistant?.name]);
  const closePicker = React.useCallback(() => {
    setPickerOpen(false);
    setQuery('');
  }, []);

  if (displayOnly) {
    if (!selectedAssistant) return null;
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary"
        title={selectedAssistant.displayName || selectedAssistant.name}
        aria-label={`当前助手：${selectedAssistant.displayName || selectedAssistant.name}`}
      >
        <AssistantAvatar assistant={selectedAssistant} className="h-4 w-4" />
      </span>
    );
  }

  if (installed.length === 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          'h-7 shrink-0 border-border/70 bg-muted/35 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          selectedAssistant ? 'w-7 rounded-md px-0' : 'rounded-full px-2.5',
        )}
        onClick={() => setPickerOpen(true)}
        title={selectedAssistant
          ? selectedAssistant.displayName || selectedAssistant.name
          : '选择助手'}
        aria-label={selectedAssistant
          ? `选择助手，当前为 ${selectedAssistant.displayName || selectedAssistant.name}`
          : '选择助手'}
      >
        {selectedAssistant ? (
          <AssistantAvatar assistant={selectedAssistant} className="h-4 w-4" />
        ) : (
          <>
            <ListFilter className="h-3.5 w-3.5" />
            <span>选择助手</span>
          </>
        )}
      </Button>

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
        managerLabel="管理专家"
        onOpenManager={onOpenExpertHub}
        managerPlacement="left"
        confirmLabel="确定"
        onConfirm={closePicker}
      >
        <div className="space-y-1">
          {filteredAssistants.map((assistant) => {
            const isSelected = selectedAssistant?.name === assistant.name;
            return (
              <button
                key={assistant.name}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleSelect(assistant)}
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
