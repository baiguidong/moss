import * as React from 'react';
export function WebAppPreviews() {
  const [items, setItems] = React.useState<Array<{ id: string; title: string }>>([]);
  const [error, setError] = React.useState('');
  React.useEffect(() => {
    if (!window.mossWeb) return;
    let active = true, revision = 0;
    const refresh = () => { const serial = ++revision; void window.agentDesktop.ipcInvoke('web:app-preview-list').then(items => { if (active && serial === revision) setItems(items); }).catch(() => {}); };
    const handler = window.agentDesktop.ipcOn('web:app-previews-changed', refresh);
    window.addEventListener('moss:reconnected', refresh); refresh();
    return () => { active = false; window.agentDesktop.ipcOff('web:app-previews-changed', handler); window.removeEventListener('moss:reconnected', refresh); };
  }, []);
  if (!items.length) return null;
  return <aside className="fixed bottom-16 right-4 z-40 rounded border bg-background p-3 text-sm shadow" aria-label="App 创作预览">{items.map(item => <div key={item.id}><a className="underline" href={`/?window=app&previewRef=${encodeURIComponent(item.id)}`} target="_blank" rel="noopener noreferrer">打开预览：{item.title}</a><button className="ml-3" onClick={() => void window.agentDesktop.ipcInvoke('web:app-preview-close', { id: item.id }).catch(reason => setError(String(reason)))}>结束预览</button></div>)}{error && <p role="alert">{error}</p>}</aside>;
}
