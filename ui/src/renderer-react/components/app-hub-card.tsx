import type { ReactNode } from 'react';

/** Lists contain only an App's introduction; actions and status belong to details. */
export function AppHubCard({ id, title, publisher, description, icon, category, onOpen, marketplace = false }: {
  id: string; title: string; publisher: string; description?: string; icon: ReactNode;
  category?: string; onOpen(): void; marketplace?: boolean;
}) {
  return <section data-app-category={category || 'other'} className="relative min-w-0 rounded-lg border border-border/70 bg-card/82 p-2.5">
    <button type="button" data-app-open={marketplace ? undefined : id} data-app-market-open={marketplace ? id : undefined}
      aria-label={`查看 ${title}`} title="打开 App 信息" onClick={onOpen}
      className="absolute inset-0 cursor-pointer rounded-lg transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset" />
    <div className="pointer-events-none relative flex min-w-0 items-start gap-2.5">
      {icon}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{publisher}</p>
        <p className="mt-2 line-clamp-2 h-9 text-xs leading-[18px] text-muted-foreground">{description || '暂无描述'}</p>
      </div>
    </div>
  </section>;
}
