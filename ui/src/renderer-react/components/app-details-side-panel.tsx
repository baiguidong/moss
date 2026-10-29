import type { ReactNode } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Shared details slot for skills and Core-owned configuration forms. */
export function AppDetailsSidePanel({ id, label, title, icon, busy = false, onClose, children, wide = false, expanded = false, onToggleExpanded }: {
  id: string; label: string; title: string; icon: ReactNode; busy?: boolean;
  onClose(): void; children: ReactNode;
  wide?: boolean; expanded?: boolean; onToggleExpanded?: () => void;
}) {
  return <aside id={id} data-app-custom-panel={onToggleExpanded ? true : undefined} aria-label={label} className={`flex min-h-0 min-w-0 shrink-0 flex-col border-t bg-muted/20 lg:border-l lg:border-t-0 ${expanded ? 'h-full w-full flex-1' : onToggleExpanded ? wide ? 'max-lg:h-full max-lg:flex-1 lg:w-[65%]' : 'max-lg:h-full max-lg:flex-1 lg:w-[45%]' : 'max-lg:h-1/2 lg:w-[45%]'}`}>
    <div className="flex items-center gap-3 border-b px-4 py-3">{icon}<h2 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h2>{onToggleExpanded && <Button variant="ghost" size="icon" aria-label={expanded ? '还原面板' : '展开面板'} onClick={onToggleExpanded}>{expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</Button>}<Button variant="ghost" size="icon" aria-label={`关闭${label}`} disabled={busy} onClick={onClose}><X className="h-4 w-4" /></Button></div>
    {children}
  </aside>;
}
