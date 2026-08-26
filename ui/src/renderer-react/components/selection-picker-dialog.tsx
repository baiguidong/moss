import * as React from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type SelectionPickerDialogProps = {
  open: boolean;
  title: string;
  description: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  icon: React.ReactNode;
  resultCount: number;
  totalCount: number;
  emptyLabel: string;
  managerLabel: string;
  onOpenManager?: () => void;
  children: React.ReactNode;
};

export function SelectionPickerDialog({
  open,
  title,
  description,
  searchPlaceholder,
  query,
  onQueryChange,
  onClose,
  icon,
  resultCount,
  totalCount,
  emptyLabel,
  managerLabel,
  onOpenManager,
  children,
}: SelectionPickerDialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[min(640px,calc(100vh-32px))] w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
      >
        <div className="flex items-start gap-3 border-b border-border px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} title="关闭">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-b border-border px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="h-9 pl-9"
            />
          </div>
        </div>

        <div className="min-h-[160px] flex-1 overflow-y-auto p-2">
          {resultCount > 0 ? children : (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              {emptyLabel}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
          <span className="text-xs text-muted-foreground">
            {query ? `${resultCount} 个结果` : `共 ${totalCount} 个`}
          </span>
          {onOpenManager ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onClose();
                onOpenManager();
              }}
            >
              {managerLabel}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
