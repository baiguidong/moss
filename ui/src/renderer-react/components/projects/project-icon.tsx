import * as React from 'react';
import { DEFAULT_PROJECT_ICON, PROJECT_ICON_COLORS, PROJECT_ICON_PRESETS, normalizeProjectIcon } from '../../../../../shared/project-icon.mjs';
import type { ProjectIconValue } from '../../../../../shared/project-icon.mjs';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function ProjectIcon({ icon, className, badge = true }: { icon?: ProjectIconValue | null; className?: string; badge?: boolean }) {
  const value = normalizeProjectIcon(icon);
  const color = PROJECT_ICON_COLORS.find(item => item.id === value.color)!;
  const paths = value.kind === 'generated' ? value.paths : PROJECT_ICON_PRESETS.find(item => item.name === value.name)!.paths;
  return <span aria-hidden="true" data-project-icon={value.kind === 'generated' ? 'generated' : value.name} data-icon-color={value.color}
    className={cn('inline-flex shrink-0 items-center justify-center rounded-lg', badge ? 'h-10 w-10' : 'h-5 w-5', className)}
    style={{ color: color.value, backgroundColor: badge ? `${color.value}18` : undefined }}>
    <svg viewBox="0 0 24 24" className={badge ? 'h-[60%] w-[60%]' : 'h-full w-full'} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths.map((d, index) => <path key={index} d={d} />)}
    </svg>
  </span>;
}

export function ProjectIconPicker({ value, onChange, disabled = false }: {
  value?: ProjectIconValue | null; onChange: (icon: ProjectIconValue) => void; disabled?: boolean;
}) {
  const icon = normalizeProjectIcon(value);
  const [expanded, setExpanded] = React.useState(false);
  // Keep the generated proposal available when comparing it with built-in options.
  const generated = React.useRef<ProjectIconValue | null>(null);
  if (icon.kind === 'generated') generated.current = icon;
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 disabled:opacity-60" aria-label="项目图标">
    <legend className="text-xs font-medium text-muted-foreground">项目图标</legend>
    <div className="flex items-center justify-between gap-3"><ProjectIcon icon={icon} className="h-8 w-8" />
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>{expanded ? '收起' : '修改'}</Button>
    </div>
    {expanded && <>
    <div role="group" aria-label="选择图形" className="flex flex-wrap gap-1.5">
      {generated.current && <button type="button" aria-label="使用 AI 生成图标" aria-pressed={icon.kind === 'generated'} title="AI 生成图标"
        className={cn('rounded-lg border p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', icon.kind === 'generated' ? 'border-primary' : 'border-transparent hover:border-border')}
        onClick={() => onChange({ ...generated.current!, color: icon.color })}><ProjectIcon icon={{ ...generated.current, color: icon.color } as ProjectIconValue} className="h-8 w-8" /></button>}
      {PROJECT_ICON_PRESETS.map(preset => <button key={preset.name} type="button" aria-label={`使用${preset.label}图标`} title={preset.label}
        aria-pressed={icon.kind === 'builtin' && icon.name === preset.name}
        className={cn('rounded-lg border p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', icon.kind === 'builtin' && icon.name === preset.name ? 'border-primary' : 'border-transparent hover:border-border')}
        onClick={() => onChange({ kind: 'builtin', name: preset.name, color: icon.color })}>
        <ProjectIcon icon={{ kind: 'builtin', name: preset.name, color: icon.color }} className="h-8 w-8" />
      </button>)}
    </div>
    <div role="group" aria-label="选择图标配色" className="flex flex-wrap gap-2">
      {PROJECT_ICON_COLORS.map(color => <button key={color.id} type="button" aria-label={`${color.label}图标`} title={color.label} aria-pressed={icon.color === color.id}
        className={cn('flex h-7 w-7 items-center justify-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', icon.color === color.id ? 'border-primary' : 'border-transparent hover:border-border')}
        onClick={() => onChange({ ...icon, color: color.id })}><span className="h-4 w-4 rounded-full" style={{ backgroundColor: color.value }} /></button>)}
    </div>
    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => onChange({ ...DEFAULT_PROJECT_ICON })}>恢复默认</Button>
    </>}
  </fieldset>;
}
