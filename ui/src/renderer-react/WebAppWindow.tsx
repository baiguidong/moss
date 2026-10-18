import { WebInteractions } from './components/web-interactions';
import { EmbeddedAppView } from './components/embedded-app-view';
import { HostConfirmations } from './components/host-confirmations';
import { WebAuthorizations } from './components/web-authorizations';
export default function WebAppWindow() {
  const query = new URLSearchParams(location.search);
  return <main className="h-screen bg-background"><HostConfirmations /><WebInteractions /><WebAuthorizations /><EmbeddedAppView appName={query.get('name') || ''} previewRef={query.get('previewRef') || undefined} route={location.hash} /></main>;
}
