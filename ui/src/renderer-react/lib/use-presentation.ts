import * as React from 'react';
import type { PresentationSnapshot } from '@/types';

export function usePresentation(sessionId: string | null, workspace: string | undefined, enabled: boolean, onReveal: () => void) {
  const [snapshot, setSnapshot] = React.useState<PresentationSnapshot | null>(null);
  const [error, setError] = React.useState('');
  const reveal = React.useRef(onReveal); reveal.current = onReveal;
  const current = React.useRef<PresentationSnapshot | null>(null);
  React.useEffect(() => {
    let active = true;
    current.current = null; setSnapshot(null); setError('');
    const accept = (value: PresentationSnapshot | null, live = false) => {
      if (!active || !value || value.sessionId !== sessionId) return;
      if (current.current?.epoch === value.epoch && current.current.version > value.version) return;
      const next = value;
      current.current = next; setSnapshot(next);
      if (live && enabled && value.state.visible && (value.request || value.state.activeOrigin === 'manual')) reveal.current();
    };
    const off = window.agentDesktop.presentation.onChanged(value => accept(value, true));
    void window.agentDesktop.presentation.snapshot({ sessionId: enabled ? sessionId : null, activate: true })
      .then(value => accept(value)).catch(reason => { if (active) setError(String(reason)); });
    const reconnect = () => { void window.agentDesktop.presentation.snapshot({ sessionId: enabled ? sessionId : null, activate: true }).then(value => accept(value)).catch(reason => { if (active) setError(String(reason)); }); };
    window.addEventListener('moss:reconnected', reconnect);
    let refreshTimer: ReturnType<typeof setTimeout>;
    const offFiles = window.agentDesktop.onWorkspaceChanged(event => {
      if (event.sessionId !== sessionId) return;
      clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { void window.agentDesktop.presentation.refresh({ sessionId }).catch(() => {}); }, 350);
    });
    return () => { active = false; off(); offFiles(); clearTimeout(refreshTimer); window.removeEventListener('moss:reconnected', reconnect); };
  }, [sessionId, workspace, enabled]);
  const action = React.useCallback((action: { type: string; id?: string; value?: boolean }) => {
    if (!sessionId) return;
    void window.agentDesktop.presentation.action({ sessionId, action }).catch(reason => setError(String(reason)));
  }, [sessionId]);
  return { snapshot: snapshot?.sessionId === sessionId ? snapshot : null, action, error };
}
