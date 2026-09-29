import * as React from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export function WorkspaceToolbarButton({ tooltip, children, className, ...props }: React.ComponentPropsWithRef<'button'> & { tooltip: string }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex shrink-0">
        <button type="button" {...props} className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40', className)}>
          {children}
        </button>
      </span>
    </TooltipTrigger>
    <TooltipContent side="bottom" sideOffset={6} className="max-w-64">{tooltip}</TooltipContent>
  </Tooltip>;
}
