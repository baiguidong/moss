import * as React from 'react';
import { Check, Hammer, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import { cn } from '@/lib/utils';

export type InstalledSkillOption = {
  name: string;
  displayName?: string;
  description?: string;
  source?: string;
  icon?: string;
  emoji?: string;
  enabled?: boolean;
};

type SkillSelectionAreaProps = {
  skills: InstalledSkillOption[];
  selectedSkills: InstalledSkillOption[];
  onToggleSkill: (skill: InstalledSkillOption) => void;
  onOpenSkillHub?: () => void;
  loading?: boolean;
};

export function getSelectableInstalledSkills(skills: InstalledSkillOption[]) {
  return skills
    .filter((skill) => skill.enabled !== false)
    .sort((a, b) => String(a.displayName || a.name).localeCompare(
      String(b.displayName || b.name),
      'zh-Hans-CN',
    ));
}

export function SkillIcon({ skill, className }: { skill?: InstalledSkillOption; className?: string }) {
  const [failed, setFailed] = React.useState(false);
  if (skill?.icon && !failed) {
    return (
      <img
        src={skill.icon}
        alt=""
        className={cn('shrink-0 object-contain', className)}
        onError={() => setFailed(true)}
      />
    );
  }
  if (skill?.emoji) {
    return <span className="shrink-0 text-sm leading-none" aria-hidden="true">{skill.emoji}</span>;
  }
  return <Hammer className={cn('shrink-0', className)} />;
}

export function SkillSelectionArea({
  skills,
  selectedSkills,
  onToggleSkill,
  onOpenSkillHub,
  loading = false,
}: SkillSelectionAreaProps) {
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const installed = React.useMemo(() => getSelectableInstalledSkills(skills), [skills]);
  const selected = React.useMemo(() => new Set(selectedSkills.map((skill) => skill.name)), [selectedSkills]);
  const selectedPreview = React.useMemo(
    () => selectedSkills
      .map((selectedSkill) => installed.find((skill) => skill.name === selectedSkill.name))
      .find((skill): skill is InstalledSkillOption => Boolean(skill)),
    [installed, selectedSkills],
  );
  const filteredSkills = React.useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hans-CN');
    if (!normalizedQuery) return installed;
    return installed.filter((skill) => [
      skill.name,
      skill.displayName,
      skill.description,
    ].some((value) => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(normalizedQuery)));
  }, [installed, query]);
  const closePicker = React.useCallback(() => {
    setPickerOpen(false);
    setQuery('');
  }, []);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          'h-7 shrink-0 border-border/70 bg-muted/35 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground',
          selectedPreview ? 'w-7 rounded-md px-0' : 'rounded-full px-2.5',
        )}
        onClick={() => setPickerOpen(true)}
        title={selectedPreview
          ? `${selectedPreview.displayName || selectedPreview.name}${selected.size > 1 ? ` 等 ${selected.size} 个技能` : ''}`
          : '选择技能'}
        aria-label={selected.size > 0 ? `选择技能，已选 ${selected.size} 个` : '选择技能'}
      >
        {selectedPreview ? (
          <SkillIcon skill={selectedPreview} className="h-4 w-4" />
        ) : (
          <>
            <ListFilter className="h-3.5 w-3.5" />
            <span>选择技能</span>
          </>
        )}
      </Button>

      <SelectionPickerDialog
        open={pickerOpen}
        title="选择技能"
        description={`已安装 ${installed.length} 个，已选 ${selected.size} 个`}
        searchPlaceholder="搜索已安装技能"
        query={query}
        onQueryChange={setQuery}
        onClose={closePicker}
        icon={<Hammer className="h-4 w-4" />}
        resultCount={filteredSkills.length}
        totalCount={installed.length}
        emptyLabel={loading ? '正在加载已安装技能...' : query ? '没有匹配的已安装技能' : '还没有已安装技能'}
        managerLabel="技能市场"
        onOpenManager={onOpenSkillHub}
        managerPlacement="left"
        confirmLabel="确定"
        onConfirm={closePicker}
      >
        <div className="space-y-1">
          {filteredSkills.map((skill) => {
            const isSelected = selected.has(skill.name);
            return (
              <button
                key={skill.name}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onToggleSkill(skill)}
                className={cn(
                  'flex h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                  <SkillIcon skill={skill} className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {skill.displayName || skill.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {skill.description || skill.name}
                  </span>
                </span>
                <span className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                )}>
                  {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </SelectionPickerDialog>
    </>
  );
}
