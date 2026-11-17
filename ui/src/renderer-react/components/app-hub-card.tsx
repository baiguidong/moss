import type { ReactNode } from 'react';

/** Compact App/connector card used by both the marketplace and installed lists. */
export function AppHubCard({ id, title, publisher, description, icon, category, onOpen, marketplace = false, enabled, onToggleEnabled, toggleBusy = false }: {
  id: string; title: string; publisher: string; description?: string; icon: ReactNode;
  category?: string; onOpen(): void; marketplace?: boolean; enabled?: boolean;
  onToggleEnabled?: (enabled: boolean) => void; toggleBusy?: boolean;
}) {
  const showToggle = !marketplace && onToggleEnabled;
  return <section data-app-category={category || 'other'} className={`relative min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5 transition-opacity ${enabled === false ? 'opacity-60 grayscale' : ''}`}>
    <button type="button" data-app-open={marketplace ? undefined : id} data-app-market-open={marketplace ? id : undefined}
      aria-label={`查看 ${title}`} title="打开 App 信息" onClick={onOpen}
      className="absolute inset-0 cursor-pointer rounded-lg transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
    {showToggle ? <label className="absolute right-2.5 top-2.5 z-10 inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground" onClick={event => event.stopPropagation()}>
      <input className="peer sr-only" type="checkbox" role="switch" aria-label={`${enabled ? '停用' : '启用'} ${title}`} checked={Boolean(enabled)} disabled={toggleBusy} onChange={event => onToggleEnabled?.(event.target.checked)} />
      <span className="relative h-5 w-9 rounded-full bg-muted transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-ring after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-background after:shadow after:transition-transform peer-checked:after:translate-x-4" />
      <span>{enabled ? '已启用' : '未启用'}</span>
    </label> : null}
    <div className="pointer-events-none relative flex min-w-0 items-start gap-2.5 pr-16">
      {icon}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{publisher}</p>
        <p className="mt-2 line-clamp-2 h-9 text-xs leading-[18px] text-muted-foreground">{description || '暂无描述'}</p>
      </div>
    </div>
  </section>;
}
