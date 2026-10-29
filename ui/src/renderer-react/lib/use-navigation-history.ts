import * as React from 'react';
import type { MainView } from '@/components/app-sidebar';

export type NavigationEntry = {
  view: MainView;
  sessionId?: string | null;
  projectId?: string | null;
  appName?: string | null;
  appRoute?: string;
  settingsSection?: 'basic-info' | 'agents';
  settingsAppId?: string | null;
};

export function useNavigationHistory(entry: NavigationEntry, navigate: (entry: NavigationEntry, signal: AbortSignal) => Promise<boolean> | boolean) {
  const [history, setHistory] = React.useState({ entries: [entry], index: 0 });
  const [busy, setBusy] = React.useState(false);
  const pending = React.useRef<{ index: number; key: string; controller: AbortController } | null>(null);
  const key = JSON.stringify(entry);

  React.useLayoutEffect(() => {
    const travel = pending.current;
    pending.current = null;
    setBusy(false);
    if (travel?.key === key) {
      setHistory(current => ({ ...current, index: travel.index }));
      return;
    }
    travel?.controller.abort();
    setHistory(current => {
      if (JSON.stringify(current.entries[current.index]) === key) return current;
      const entries = [...current.entries.slice(0, current.index + 1), entry].slice(-100);
      return { entries, index: entries.length - 1 };
    });
  }, [key]);

  React.useEffect(() => () => pending.current?.controller.abort(), []);

  const travel = async (offset: number) => {
    const index = history.index + offset;
    if (pending.current || index < 0 || index >= history.entries.length) return;
    const target = history.entries[index];
    const request = { index, key: JSON.stringify(target), controller: new AbortController() };
    pending.current = request;
    setBusy(true);
    let opened = false;
    try { opened = await navigate(target, request.controller.signal); }
    finally {
      // A successful navigation is committed by the layout effect once the view changes.
      if (!opened && pending.current === request) { pending.current = null; setBusy(false); }
    }
  };

  return {
    canGoBack: !busy && history.index > 0,
    canGoForward: !busy && history.index < history.entries.length - 1,
    back: () => travel(-1),
    forward: () => travel(1),
  };
}
