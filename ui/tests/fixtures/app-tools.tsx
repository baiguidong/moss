import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { AppToolSettingsTable } from '@/components/settings-view';
import type { StoredApp } from '@/types';
import '@/globals.css';

// The integration harness supplies the Desktop API and real Host catalog.
function Fixture() {
  const [apps, setApps] = React.useState<StoredApp[]>([]);
  React.useEffect(() => {
    let active = true;
    const refresh = () => { void window.agentDesktop.listApps().then(next => { if (active) setApps(next); }); };
    const off = window.agentDesktop.onAppsChanged(refresh);
    refresh();
    return () => { active = false; off(); };
  }, []);
  return <main className="mx-auto max-w-6xl p-6"><h1 className="mb-4 text-lg font-semibold">App 提供的工具</h1><AppToolSettingsTable apps={apps} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
