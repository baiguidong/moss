import * as React from 'react';

export type AppComposerResource = {
  providerId: string;
  appId: string;
  title: string;
  description?: string;
  ref?: { workflowId: string; revision: number };
  intent?: 'create' | 'edit' | 'use';
  route?: string;
  scope?: string;
  workspace?: string;
};
export const AppComposerContext = React.createContext<{
  selection: AppComposerResource | null;
  select: (resource: AppComposerResource | null) => void;
}>({ selection: null, select: () => {} });
export const resourceContext = (resource: AppComposerResource) => ({ providerId: resource.providerId, intent: resource.intent || 'use', ref: resource.ref });
export const resourceKey = (resource?: AppComposerResource | null) => resource ? `${resource.providerId}:${JSON.stringify(resource.ref)}:${resource.intent || 'use'}` : '';

export function useAppComposerResources(sessionId?: string, workspace?: string, enabled = true) {
  const [items, setItems] = React.useState<AppComposerResource[]>([]);
  const [available, setAvailable] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [offset, setOffset] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [error, setError] = React.useState('');
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => window.agentDesktop.onAppsChanged(() => setRevision(v => v + 1)), []);
  React.useEffect(() => window.agentDesktop.onEvent(({payload}) => { if (payload.subtype === 'app_view') setRevision(v => v + 1) }), []);
  React.useEffect(() => { setOffset(0); setItems([]) }, [sessionId, workspace, query, enabled, revision]);
  React.useEffect(() => {
    let active = true;
    if (!enabled) { setAvailable(false); setItems([]); return }
    const timer = setTimeout(() => {
      void window.agentDesktop.listAppResources({ sessionId, workspace, query, offset }).then(result => {
        if (!active) return;
        setAvailable(result.providers.length > 0); setError(''); setHasMore(result.items.length >= 20);
        setItems(previous => offset ? [...new Map([...previous, ...result.items].map(item => [resourceKey(item), item])).values()] : result.items);
      }).catch(e => { if (active) {setError(e.message); setItems([])} });
    }, 120);
    return () => { active = false; clearTimeout(timer) };
  }, [sessionId, workspace, query, offset, enabled, revision]);
  return { items, available, error, query, search: setQuery, hasMore, more: () => setOffset(v => v + 20), refresh: () => setRevision(v => v + 1) };
}
