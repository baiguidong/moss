import * as React from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { CompactionRecord } from '@/lib/compaction';

const compactIcon = new URL('../../assets/compact.svg', import.meta.url).href;

export function CompactionNavigator({ items, onNavigate }: {
  items: { messageId: string; record: CompactionRecord }[];
  onNavigate: (messageId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const closeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedByHover = React.useRef(false);
  const cancelClose = React.useCallback(() => {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  React.useEffect(() => cancelClose, [cancelClose]);
  const changeOpen = (nextOpen: boolean) => {
    cancelClose();
    setOpen(nextOpen);
  };
  const scheduleClose = () => {
    cancelClose();
    // Allow the pointer to cross the gap between the trigger and the portal.
    closeTimer.current = setTimeout(() => setOpen(false), 200);
  };

  if (!items.length) return null;

  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild>
      <button type="button" aria-label={`压缩记录，共 ${items.length} 次`}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-card/95 text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent data-[state=open]:text-accent-foreground"
        onPointerEnter={event => {
          if (event.pointerType !== 'mouse') return;
          if (!open) openedByHover.current = true;
          changeOpen(true);
        }}
        onPointerLeave={event => { if (event.pointerType === 'mouse') scheduleClose(); }}
        onClick={event => {
          // A click after hovering should keep the menu available.
          if (open && openedByHover.current) event.preventDefault();
          openedByHover.current = false;
        }}
        onKeyDown={() => { openedByHover.current = false; cancelClose(); }}
      ><img src={compactIcon} alt="" aria-hidden="true" draggable={false} className="pointer-events-none h-5 w-5" /></button>
    </PopoverTrigger>
    <PopoverContent align="end" side="bottom" sideOffset={6} aria-label="压缩记录"
      className="max-h-[min(20rem,var(--radix-popover-content-available-height))] w-56 overflow-y-auto p-1"
      onPointerEnter={cancelClose} onPointerLeave={event => { if (event.pointerType === 'mouse') scheduleClose(); }}
      onKeyDown={() => { openedByHover.current = false; cancelClose(); }}
      onOpenAutoFocus={event => { if (openedByHover.current) event.preventDefault(); }}
      onCloseAutoFocus={event => { if (openedByHover.current) event.preventDefault(); }}
    >
      <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">压缩记录 · {items.length} 次</p>
      {[...items].reverse().map(({ messageId, record }, index) => (
        <button key={record.id} type="button" onClick={() => { onNavigate(messageId); changeOpen(false); }}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          aria-label={`跳到第 ${record.number} 次压缩${index === 0 ? '（最近）' : ''}`}>
          <span className="flex-1">第 {record.number} 次压缩{index === 0 && <span className="ml-2 text-xs opacity-70">最近</span>}</span>
          <span className="text-xs opacity-70">{record.trigger === 'manual' ? '手动' : record.trigger === 'auto' ? '自动' : ''}</span>
        </button>
      ))}
    </PopoverContent>
  </Popover>;
}
