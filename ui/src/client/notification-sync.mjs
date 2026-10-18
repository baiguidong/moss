// Events are incremental transport state; reconnect must also reload the
// authoritative list when the Host can no longer replay missed events.
export function subscribeNotificationState({ api, onChanged, reconnectTarget }) {
  let revision = 0;
  let disposed = false;
  const refresh = () => {
    const requestedRevision = ++revision;
    void api.list().then(notifications => {
      if (!disposed && revision === requestedRevision) onChanged(notifications);
    }).catch(() => {});
  };
  const unsubscribe = api.onChanged(payload => {
    revision++;
    if (!disposed) onChanged(payload.notifications);
  });
  reconnectTarget?.addEventListener('moss:reconnected', refresh);
  refresh();
  return () => {
    disposed = true;
    unsubscribe();
    reconnectTarget?.removeEventListener('moss:reconnected', refresh);
  };
}
