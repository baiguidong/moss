import * as React from 'react';
import { MonitorPlay } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AppIcon({ icon, className }: { icon?: string; className?: string }) {
  const [failedSource, setFailedSource] = React.useState<string>();
  const available = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon)[;,]/i.test(icon || '') && failedSource !== icon;
  return (
    <span className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md', className)}>
      {available
        ? <img src={icon} alt="" className="h-full w-full object-contain" onError={() => setFailedSource(icon)} />
        : <MonitorPlay aria-hidden="true" className="h-full w-full p-[15%] text-muted-foreground" />}
    </span>
  );
}
