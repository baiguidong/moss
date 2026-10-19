import * as React from 'react';

type Authorization = { id: string; label: string; url: string | null; status: string; expiresAt: number; originViewId: string | null };
export function WebAuthorizations() {
  const [items, setItems] = React.useState<Authorization[]>([]), [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!window.mossWeb) return;
    let active = true, revision = 0;
    const refresh = () => {
      const current = ++revision;
      void window.agentDesktop.ipcInvoke('web:oauth-list').then((next: Authorization[]) => {
        if (!active || current !== revision) return;
        setItems(next);
        const pending = next.find(item => item.status === 'waiting' && item.url && item.originViewId === window.mossWeb?.snapshot?.viewId);
        const tab = window.mossWeb?.authorizationWindow;
        if (pending && tab && !tab.closed) {
          tab.location.replace(pending.url!); window.mossWeb!.authorizationWindow = undefined;
        }
      }).catch(reason => { if (active) setError(String(reason)); });
    };
    const handler = window.agentDesktop.ipcOn('web:oauth-changed', refresh);
    window.addEventListener('moss:reconnected', refresh); refresh();
    return () => { active = false; window.agentDesktop.ipcOff('web:oauth-changed', handler); window.removeEventListener('moss:reconnected', refresh); };
  }, []);
  if (!window.mossWeb || !items.length) return null;
  return <aside className="fixed right-4 top-16 z-50 w-80 rounded-lg border bg-background p-4 shadow-lg" aria-label="账号授权">
    {items.map(item => <div key={item.id} className="mb-3 text-sm">
      <strong>{item.label}</strong><p className="my-2 text-xs text-muted-foreground">{item.status === 'received' ? '正在验证授权结果…' : item.status === 'canceled' ? '授权已取消' : '在浏览器完成授权，凭据保存在云电脑。'}</p>
      {item.url && item.status === 'waiting' && <a className="mr-3 underline" href={item.url} target="_blank" rel="noopener noreferrer">打开授权页面</a>}
      {['preparing', 'waiting'].includes(item.status) && <button onClick={() => void window.agentDesktop.ipcInvoke('web:oauth-cancel', { id: item.id }).catch(reason => setError(String(reason)))}>取消授权</button>}
    </div>)}
    {error && <p role="alert">{error}</p>}
  </aside>;
}
