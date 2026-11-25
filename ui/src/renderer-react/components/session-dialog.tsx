import * as React from 'react';
import { createPortal } from 'react-dom';
import { Grip, X } from 'lucide-react';

export function SessionDialog({ title, children, onClose, wide, draggable = false, closeLabel = '关闭', className = '' }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  draggable?: boolean;
  closeLabel?: string;
  className?: string;
}) {
  const panel = React.useRef<HTMLDivElement>(null);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const drag = React.useRef<{ x: number; y: number } | null>(null);
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable || event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX - offset.x, y: event.clientY - offset.y };
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !panel.current) return;
    const maxX = Math.max(0, (window.innerWidth - panel.current.offsetWidth) / 2);
    const maxY = Math.max(0, (window.innerHeight - panel.current.offsetHeight) / 2);
    setOffset({
      x: Math.min(maxX, Math.max(-maxX, event.clientX - drag.current.x)),
      y: Math.min(maxY, Math.max(-maxY, event.clientY - drag.current.y)),
    });
  };
  const titleId = React.useId();
  const dismiss = React.useRef(onClose);
  dismiss.current = onClose;
  const previous = React.useRef<HTMLElement | null>(null);
  const close = React.useCallback(() => {
    dismiss.current();
    const target = document.querySelector<HTMLElement>('textarea[data-session-composer-input]:not(:disabled)');
    (target || previous.current)?.focus({ preventScroll: true });
  }, []);

  React.useLayoutEffect(() => {
    previous.current = document.activeElement as HTMLElement;
    const field = panel.current?.querySelector<HTMLElement>('[data-initial-focus]:not(:disabled)');
    (field || panel.current)?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!event.composedPath().includes(panel.current!)) dismiss.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing && !document.querySelector('dialog:modal')) {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [close]);

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div ref={panel} role="dialog" aria-labelledby={titleId} tabIndex={-1}
        style={draggable ? { transform: `translate(${offset.x}px, ${offset.y}px)`, maxHeight: '74dvh' } : undefined}
        className={`pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl outline-none ${wide ? 'max-w-[680px]' : 'max-w-[440px]'}`}>
        <div className={`flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2.5 ${draggable ? 'cursor-grab touch-none select-none active:cursor-grabbing' : ''}`}
          onPointerDown={startDrag} onPointerMove={moveDrag} onLostPointerCapture={() => { drag.current = null; }}>
          <h2 id={titleId} className="flex-1 text-sm font-semibold">{title}</h2>
          {draggable && <Grip className="size-4 text-muted-foreground" aria-label="拖动移动窗口" />}
          <button type="button" aria-label={closeLabel} onClick={close} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
        </div>
        <div className={`min-h-0 overflow-y-auto ${className}`}>{children}</div>
      </div>
    </div>, document.body);
}
