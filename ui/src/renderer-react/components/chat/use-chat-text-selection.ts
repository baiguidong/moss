import * as React from "react";
import { flushSync } from "react-dom";

const OVERSCAN = 1200;
const FULL_HISTORY_ITEMS = 120;
const FULL_HISTORY_CHARACTERS = 120_000;

export function hasChatTextSelection(scroller: HTMLElement | null) {
  const selection = scroller?.ownerDocument.getSelection();
  return Boolean(scroller && selection && !selection.isCollapsed && selection.rangeCount
    && selection.getRangeAt(0).intersectsNode(scroller));
}

// Keep one Virtuoso instance: switching to a different list during a drag would
// itself unmount the selected nodes. Grow its viewport to retain the visited
// region instead, then release it when the native selection is cleared.
export function useChatTextSelection(itemCount: number, contentCharacters: number) {
  const [scroller, setScroller] = React.useState<HTMLElement | null>(null);
  const [totalHeight, setTotalHeight] = React.useState(0);
  const [selectionActive, setSelectionActive] = React.useState(false);
  const [retainedViewport, setRetainedViewport] = React.useState({ top: OVERSCAN, bottom: OVERSCAN });
  const dragging = React.useRef(false);
  const scrollerRef = React.useCallback((element: HTMLElement | Window | null) => {
    setScroller(element instanceof HTMLElement ? element : null);
  }, []);
  const isSelecting = React.useCallback(
    () => dragging.current || hasChatTextSelection(scroller),
    [scroller],
  );

  React.useEffect(() => {
    if (!scroller) return;
    const doc = scroller.ownerDocument;
    const win = doc.defaultView!;
    let bounds: { top: number; bottom: number } | null = null;

    const updateRetention = (synchronous = false) => {
      const selected = hasChatTextSelection(scroller);
      let next = { top: OVERSCAN, bottom: OVERSCAN };
      if (dragging.current || selected) {
        const top = scroller.scrollTop;
        const bottom = top + scroller.clientHeight;
        bounds = {
          top: Math.min(bounds?.top ?? top, top),
          bottom: Math.max(bounds?.bottom ?? bottom, bottom),
        };
        if (selected) {
          const rect = doc.getSelection()!.getRangeAt(0).getBoundingClientRect();
          const offset = top - scroller.getBoundingClientRect().top;
          bounds.top = Math.min(bounds.top, rect.top + offset);
          bounds.bottom = Math.max(bounds.bottom, rect.bottom + offset);
        }
        // Round upward to avoid rerendering on every pixel of a drag-scroll.
        next = {
          top: Math.ceil((Math.max(0, top - bounds.top) + OVERSCAN) / OVERSCAN) * OVERSCAN,
          bottom: Math.ceil((Math.max(0, bounds.bottom - bottom) + OVERSCAN) / OVERSCAN) * OVERSCAN,
        };
      } else {
        bounds = null;
      }
      const update = () => {
        setSelectionActive(dragging.current || selected);
        setRetainedViewport((current) => (
          current.top === next.top && current.bottom === next.bottom ? current : next
        ));
      };
      // Capture runs before Virtuoso processes the scroll and removes old rows.
      if (synchronous) flushSync(update);
      else update();
    };

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      dragging.current = event.button === 0 && !event.ctrlKey
        && target instanceof Element && scroller.contains(target)
        && !target.closest('button, input, textarea, select, [contenteditable="true"]');
      updateRetention();
    };
    const onPointerUp = () => {
      dragging.current = false;
      updateRetention();
    };
    const onSelectionChange = () => updateRetention();
    const onScroll = () => {
      if (dragging.current || hasChatTextSelection(scroller)) updateRetention(true);
    };

    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("pointerup", onPointerUp, true);
    doc.addEventListener("pointercancel", onPointerUp, true);
    doc.addEventListener("selectionchange", onSelectionChange);
    scroller.addEventListener("scroll", onScroll, true);
    win.addEventListener("blur", onPointerUp);
    return () => {
      dragging.current = false;
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("pointerup", onPointerUp, true);
      doc.removeEventListener("pointercancel", onPointerUp, true);
      doc.removeEventListener("selectionchange", onSelectionChange);
      scroller.removeEventListener("scroll", onScroll, true);
      win.removeEventListener("blur", onPointerUp);
    };
  }, [scroller]);

  const keepFullHistory = itemCount < FULL_HISTORY_ITEMS && contentCharacters < FULL_HISTORY_CHARACTERS;
  const increaseViewportBy = React.useMemo(() => ({
    top: Math.max(retainedViewport.top, keepFullHistory ? totalHeight : 0),
    bottom: Math.max(retainedViewport.bottom, keepFullHistory ? totalHeight : 0),
  }), [retainedViewport, keepFullHistory, totalHeight]);

  return { scrollerRef, isSelecting, selectionActive, increaseViewportBy, totalListHeightChanged: setTotalHeight };
}
