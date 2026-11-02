import * as React from 'react';
import { acquireNativeOverlayVisibility } from '@/lib/native-overlay-visibility';

export function PanelResizeHandle({ onBeginResize, onRestoreSplit, width }: {
  onBeginResize: () => (delta: number) => void;
  onRestoreSplit: () => void;
  width: number;
}) {
  const drag = React.useRef<{ x: number; move: (delta: number) => void; release: () => void } | null>(null);
  const stop = () => {
    drag.current?.release();
    drag.current = null;
    document.body.classList.remove('layout-resizing');
  };
  React.useEffect(() => {
    window.addEventListener('blur', stop);
    return () => { window.removeEventListener('blur', stop); stop(); };
  }, []);

  return <div role="separator" aria-label="调整会话与内容宽度" aria-orientation="vertical"
    aria-valuenow={Math.round(width)} tabIndex={0} title="拖动调整宽度，双击恢复分栏"
    className="session-panel-resize-handle absolute inset-y-0 -left-1.5 z-30 w-3 touch-none cursor-col-resize focus-visible:outline-none"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { x: event.clientX, move: onBeginResize(), release: acquireNativeOverlayVisibility() };
      document.body.classList.add('layout-resizing');
    }}
    onPointerMove={event => drag.current?.move(event.clientX - drag.current.x)}
    onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
    onDoubleClick={onRestoreSplit}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        onBeginResize()(event.key === 'ArrowLeft' ? -32 : 32);
      } else if (event.key === 'Enter') { event.preventDefault(); onRestoreSplit(); }
    }} />;
}
