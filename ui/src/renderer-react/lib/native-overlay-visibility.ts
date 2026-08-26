const NATIVE_OVERLAY_EVENT = 'moss:native-overlay-visibility';

let openOverlayCount = 0;

function publish() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(NATIVE_OVERLAY_EVENT, {
    detail: { open: openOverlayCount > 0 },
  }));
}

export function acquireNativeOverlayVisibility() {
  openOverlayCount += 1;
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openOverlayCount = Math.max(0, openOverlayCount - 1);
    publish();
  };
}

export function isNativeOverlayVisible() {
  return openOverlayCount > 0;
}

export function onNativeOverlayVisibilityChange(callback: (open: boolean) => void) {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    callback(Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open));
  };
  window.addEventListener(NATIVE_OVERLAY_EVENT, handler);
  return () => window.removeEventListener(NATIVE_OVERLAY_EVENT, handler);
}
