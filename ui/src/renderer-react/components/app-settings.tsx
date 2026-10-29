import { RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** App workspaces only expose page actions; management belongs to plugin details. */
export function AppToolbarActions({ onRefresh }: { onRefresh: () => void }) {
  return <div className="flex shrink-0 items-center gap-2" data-app-toolbar-actions>
    <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-xl px-2.5 text-xs" onClick={onRefresh}>
      <RefreshCcw className="h-3.5 w-3.5" />刷新
    </Button>
  </div>;
}
