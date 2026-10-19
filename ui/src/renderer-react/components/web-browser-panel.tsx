import * as React from 'react';
import { supportsHostFeature } from '../lib/host-environment';
export function WebBrowserPanel({ onReady }: { onReady?: () => void }) {
  const [input, setInput] = React.useState(window.mossWeb?.pendingBrowserUrl || ''), [url, setUrl] = React.useState(''), [error, setError] = React.useState('');
  const open = async (value: string) => {
    setError('');
    try {
      const parsed = new URL(value.includes('://') ? value : `http://${value}`);
      if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
        const result = await window.agentDesktop.ipcInvoke('web:port-open', { url: parsed.href }); setUrl(result.url);
      } else await window.agentDesktop.shell.openExternal(parsed.href);
    } catch (reason) { setError(String(reason)); }
  };
  React.useEffect(() => {
    const handler = (event: Event) => { const url = (event as CustomEvent).detail; setInput(url); void open(url); };
    window.addEventListener('moss:browser-open', handler);
    if (window.mossWeb?.pendingBrowserUrl) void open(window.mossWeb.pendingBrowserUrl);
    return () => window.removeEventListener('moss:browser-open', handler);
  }, []);
  return <div className="flex h-full flex-col"><form className="flex gap-2 border-b p-2" onSubmit={event => { event.preventDefault(); void open(input); }}>
    <input aria-label="云电脑网页地址" className="min-w-0 flex-1 rounded border bg-background px-2 text-sm" value={input} onChange={event => setInput(event.target.value)} placeholder="http://localhost:3000" />
    <button type="submit" className="text-sm">打开</button>{url && <a className="text-sm" href={url} target="_blank" rel="noopener noreferrer">新页面</a>}
  </form>{error && <p role="alert" className="p-3 text-sm">{error}</p>}
    {url ? <iframe title="云电脑端口预览" src={url} onLoad={onReady} sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-downloads" referrerPolicy="no-referrer" className="min-h-0 flex-1 border-0" /> : <p className="p-4 text-sm text-muted-foreground">{supportsHostFeature('portPreview') ? '预览云电脑上运行的网页。公网链接会在你的浏览器新页面打开。' : '此 Host 尚未配置独立端口预览域名。公网链接可在你的浏览器打开。'}</p>}
  </div>;
}
