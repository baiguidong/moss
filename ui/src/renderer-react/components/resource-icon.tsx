import * as React from 'react';
import { cn } from '@/lib/utils';

export function ResourceIcon({ source, label, fallback: Fallback, className }: {
  source?: string;
  label: string;
  fallback: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const [failedSource, setFailedSource] = React.useState<string>();
  const src = typeof source === 'string' ? source.trim() : '';
  return <span aria-hidden="true" className={cn('flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary', className)}>
    {src && failedSource !== src
      ? <img src={src} alt="" title={label} className="h-full w-full object-cover" onError={() => setFailedSource(src)} />
      : <Fallback className="h-full w-full p-[22%]" />}
  </span>;
}
