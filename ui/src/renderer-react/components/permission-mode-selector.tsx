import { ChevronDown, ShieldCheck } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PermissionMode } from '../types';

export const PERMISSION_MODE_OPTIONS: Array<{
  id: PermissionMode;
  label: string;
  description: string;
}> = [
  { id: 'plan', label: '计划模式', description: '只分析和规划，不执行修改。' },
  { id: 'acceptEdits', label: '自动接受编辑', description: '自动允许文件编辑，其他敏感操作仍确认。' },
  { id: 'default', label: '默认询问', description: '按项目规则执行，需要时向你确认。' },
  { id: 'dontAsk', label: '禁止询问', description: '不能自动允许的操作直接拒绝。' },
  { id: 'bypassPermissions', label: '完全放行', description: '跳过常规权限确认，风险最高。' },
];

export function getPermissionModeLabel(mode: PermissionMode): string {
  return PERMISSION_MODE_OPTIONS.find((option) => option.id === mode)?.label ?? '默认询问';
}

export function PermissionModeSelector({
  value,
  onChange,
  disabled = false,
  compact = true,
}: {
  value: PermissionMode;
  onChange: (mode: PermissionMode) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const selectMode = (rawMode: string) => {
    const mode = rawMode as PermissionMode;
    if (mode === value) return;
    if (
      mode === 'bypassPermissions'
      && !window.confirm('完全放行会跳过常规权限确认，Agent 可直接修改文件并执行命令。确定启用吗？')
    ) return;
    void onChange(mode);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/35 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
            compact ? 'px-2.5 py-1.5' : 'h-9 px-3',
          )}
          title={disabled ? '会话执行期间不能切换权限模式' : '选择权限模式'}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>{getPermissionModeLabel(value)}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>权限模式</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value} onValueChange={selectMode}>
          {PERMISSION_MODE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="items-start py-2">
              <span className="grid gap-0.5 pr-2">
                <span className="text-sm">{option.label}</span>
                <span className="whitespace-normal text-xs leading-4 text-muted-foreground">
                  {option.description}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
