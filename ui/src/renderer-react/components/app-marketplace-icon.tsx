import { useState } from 'react';
import { Store } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AppMarketplaceIcon({ icon, className }: { icon?: string; className?: string }) {
  const [failedSource, setFailedSource] = useState<string>();
  return <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary', className)}>
    {icon && failedSource !== icon ? <img src={icon} alt="" className="h-full w-full object-contain" onError={() => setFailedSource(icon)} /> : <Store className="h-1/2 w-1/2" />}
  </span>;
}
