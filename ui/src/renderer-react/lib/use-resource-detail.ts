import * as React from 'react';

/** Keep the source list mounted so returning restores its filters, page and scroll. */
export function useResourceDetail<T>() {
  const [detail, setDetail] = React.useState<T | null>(null);
  const trigger = React.useRef<HTMLElement | null>(null);
  const request = React.useRef(0);
  React.useEffect(() => () => { request.current++; }, []);
  React.useLayoutEffect(() => {
    if (!detail) trigger.current?.focus({ preventScroll: true });
  }, [detail]);
  const open = (value: T) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    request.current++;
    setDetail(value);
  };
  const close = () => {
    request.current++;
    setDetail(null);
  };
  return { detail, setDetail, open, close, request };
}
