import * as React from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

// Lists keep their own search state while sharing the hub's top row.
// Undefined means the list is rendered outside the hub.
export const ResourceHubSearchTarget = React.createContext<HTMLDivElement | null | undefined>(undefined);

export function ResourceHubSearch({ value, onChange, placeholder, label, refresh, visible = true }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  refresh?: React.ReactNode;
  visible?: boolean;
}) {
  const target = React.useContext(ResourceHubSearchTarget);
  if (!visible) return null;

  const search = <div className="ml-auto flex w-full min-w-0 max-w-80 items-center gap-1.5">
    <div className="relative min-w-0 flex-1">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={event => onChange(event.target.value)}
        className="h-8 rounded-lg border-border/50 bg-muted/40 pl-8 text-sm shadow-none"
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
    {refresh}
  </div>;

  return target === undefined ? search : target ? createPortal(search, target) : null;
}
