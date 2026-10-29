import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export const APP_DETAILS_LIST_CLASS = 'divide-y divide-border/50 text-sm';
export const APP_DETAILS_ROW_CLASS = 'flex items-start justify-between gap-4 py-4';

/** Shared navigation row for skills, connections and service details. */
export function AppDetailsEntry({ title, description, trailing, ...props }: Omit<ComponentPropsWithoutRef<'button'>, 'title' | 'children'> & {
  title: ReactNode; description?: ReactNode; trailing?: ReactNode;
}) {
  return <button {...props} type="button" data-app-details-entry className="group flex w-full items-center justify-between gap-4 rounded-lg px-4 py-4 text-left text-sm transition-colors hover:bg-muted/50 aria-expanded:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50">
    <span className="min-w-0 flex-1"><span className="block break-words font-medium leading-6">{title}</span>{description && <span className="mt-1 block break-words text-xs leading-6 text-muted-foreground">{description}</span>}</span>
    {trailing}<ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground group-aria-expanded:text-foreground" />
  </button>;
}

export function AppDetailsSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <section aria-label={title} data-app-details-section={title}>
    <h2 className="border-b pb-3 text-base font-semibold">{title}{count !== undefined && <span className="ml-2 text-sm font-normal text-muted-foreground">{count}</span>}</h2>
    {children}
  </section>;
}
