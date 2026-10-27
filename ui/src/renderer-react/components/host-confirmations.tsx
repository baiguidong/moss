import * as React from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { isWebUI } from '@/lib/host-environment';
import type { HostConfirmationRequest } from '@/types';
import { AppInstallationReview } from './app-installation-review';
import './host-confirmations.css';

export function HostConfirmations() {
  return <ConfirmationRequests />;
}

function ConfirmationRequests() {
  const web = isWebUI();
  const [requests, setRequests] = React.useState<HostConfirmationRequest[]>([]);
  const [selectedId, select] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const dialog = React.useRef<HTMLDialogElement>(null);
  const cancelButton = React.useRef<HTMLButtonElement>(null);
  const deferred = React.useRef(new Set<string>());
  const request = requests.find(item => item.id === selectedId);
  const refreshRef = React.useRef<() => void>(() => {});
  React.useEffect(() => {
    const api = window.agentDesktop.confirmations;
    if (!api) return;
    let disposed = false, generation = 0;
    const visible = (items: HostConfirmationRequest[]) => web ? items : items.filter(item => item.disclosure?.type === 'app-installation');
    const refresh = () => {
      const current = ++generation;
      void api.list().then(snapshot => { if (!disposed && current === generation) setRequests(visible(snapshot.requests)); })
        .catch(reason => { if (!disposed && current === generation) setError(String(reason)); });
    };
    refreshRef.current = refresh;
    const reconnect = () => {
      const snapshot = window.mossWeb?.snapshot?.confirmations;
      if (snapshot) setRequests(visible(snapshot.requests));
      refresh();
    };
    const open = (event: Event) => { select((event as CustomEvent<string>).detail); refresh(); };
    const off = api.onChanged(refresh);
    window.addEventListener('moss:reconnected', reconnect);
    window.addEventListener('moss:show-confirmation', open);
    reconnect();
    return () => { disposed = true; generation++; off(); window.removeEventListener('moss:reconnected', reconnect); window.removeEventListener('moss:show-confirmation', open); };
  }, [web]);
  React.useEffect(() => {
    if (request) return;
    const next = requests.find(item => !deferred.current.has(item.id)
      && (!item.originViewId || item.originViewId === window.mossWeb?.snapshot?.viewId));
    select(next?.id || null);
  }, [requests, request]);
  React.useEffect(() => { setBusy(false); setError(''); }, [selectedId]);
  React.useEffect(() => {
    if (request) {
      if (!dialog.current?.open) dialog.current?.showModal();
      cancelButton.current?.focus({ preventScroll: true });
    } else if (dialog.current?.open) dialog.current.close();
  }, [request?.id]);
  const respond = async (allowed: boolean) => {
    if (!request || busy) return;
    setBusy(true); setError('');
    try {
      await window.agentDesktop.confirmations.respond({ id: request.id, revision: request.revision, allowed });
      setRequests(items => items.filter(item => item.id !== request.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); refreshRef.current(); }
  };
  const respondRef = React.useRef(respond); respondRef.current = respond;
  React.useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dialog.current?.open
        || Array.from(document.querySelectorAll('dialog:modal')).at(-1) !== dialog.current) return;
      event.preventDefault(); event.stopPropagation(); void respondRef.current(false);
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, []);
  return <>
    {requests.length > 0 && <button type="button" className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-primary/30 bg-card px-4 py-2 text-sm shadow-lg" onClick={() => select(requests[0].id)}><ShieldCheck size={16}/>待确认操作（{requests.length}）</button>}
    <dialog ref={dialog} aria-labelledby="host-confirmation-title" aria-describedby="host-confirmation-message"
      onCancel={event => { event.preventDefault(); void respond(false); }} className="host-confirmation-dialog">
      {request && <div className="host-confirmation-layout">
        <header className="host-confirmation-heading">
          <div><h2 id="host-confirmation-title">{request.title}</h2><button type="button" aria-label="取消并关闭" disabled={busy} onClick={() => void respond(false)}><X size={18}/></button></div>
          <p id="host-confirmation-message">{request.message}</p>
          {web && <p>操作将在云电脑上执行。</p>}
        </header>
        <div className="host-confirmation-scroll" data-confirmation-scroll>
          {request.disclosure ? <AppInstallationReview key={request.id} disclosure={request.disclosure}/> : request.detail && <pre className="host-confirmation-detail">{request.detail}</pre>}
        </div>
        <footer className="host-confirmation-footer">
          {error && <p role="alert" className="host-confirmation-error">{error}</p>}
          <div className="host-confirmation-actions">
            {web ? <button type="button" className="host-confirmation-defer" disabled={busy} onClick={() => { deferred.current.add(request.id); select(null); }}>稍后处理</button> : <span>请确认以上能力与权限</span>}
            <button type="button" ref={cancelButton} autoFocus disabled={busy} onClick={() => void respond(false)}>{request.cancelLabel}</button>
            <button type="button" className="host-confirmation-accept" disabled={busy} onClick={() => void respond(true)}>{busy ? '处理中…' : request.confirmLabel}</button>
          </div>
        </footer>
      </div>}
    </dialog>
  </>;
}
