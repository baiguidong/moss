import * as React from 'react';

export function useAppAuthoring() {
  const [state, setState] = React.useState<{available:boolean;reason:string|null}>({ available: false, reason: null });
  React.useEffect(() => {
    let active = true;
    const refresh = () => { void window.agentDesktop.getAppAuthoring?.().then(value => { if (active) setState(value); }).catch(() => { if (active) setState({ available: false, reason: 'unavailable' }); }); };
    refresh();
    const off = window.agentDesktop.onAppsChanged?.(refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; off?.(); window.removeEventListener('focus', refresh); };
  }, []);
  return state;
}
