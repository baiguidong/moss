import * as React from 'react';

export function WebAppFrame({ embedId, url, onReady, onError }: { embedId: string; url: string; onReady: () => void; onError: (error: string) => void }) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const callbacks = React.useRef({ onReady, onError }); callbacks.current = { onReady, onError };
  React.useEffect(() => {
    const node = frame.current!;
    let active = true, loaded = false, inflight = 0;
    let channel: MessageChannel;
    const load = () => {
      if (loaded) {
        active = false; channel?.port1.close();
        void window.agentDesktop.closeEmbeddedApp({ embedId }).catch(() => {});
        callbacks.current.onError('App 页面已导航，请刷新此 App 以建立新连接。'); return;
      }
      loaded = true; channel = new MessageChannel();
      channel.port1.onmessage = async ({ data }) => {
        if (!active || !data || typeof data.id !== 'string' || data.id.length > 128 || typeof data.method !== 'string') return;
        if (++inflight > 64) { inflight--; channel.port1.postMessage({ id: data.id, ok: false, error: 'Too many App requests' }); return; }
        try {
          const value = await window.agentDesktop.ipcInvoke('web:app-request', { embedId, method: data.method, input: data.input });
          if (active) channel.port1.postMessage({ id: data.id, ok: true, value });
        } catch (error) { if (active) channel.port1.postMessage({ id: data.id, ok: false, error: String(error) }); }
        finally { inflight--; }
      };
      // The sandbox makes the child an opaque origin. Only this iframe receives
      // the port; it never receives the root client or authenticated cookies.
      node.contentWindow!.postMessage({ type: 'moss:app-port' }, '*', [channel.port2]);
      callbacks.current.onReady();
    };
    const eventHandler = window.agentDesktop.ipcOn('web:app-event', (event: any) => {
      if (active && event.embedId === embedId) channel?.port1.postMessage({ type: 'event', method: event.method, payload: event.payload });
    });
    const closeHandler = window.agentDesktop.ipcOn('web:app-closed', (event: any) => {
      if (event.embedId === embedId && active) { active = false; channel?.port1.close(); callbacks.current.onError('App 已关闭、停用或更新，请刷新后重新打开。'); }
    });
    node.addEventListener('load', load);
    return () => { active = false; node.removeEventListener('load', load); channel?.port1.close(); window.agentDesktop.ipcOff('web:app-event', eventHandler); window.agentDesktop.ipcOff('web:app-closed', closeHandler); };
  }, [embedId]);
  return <iframe ref={frame} title="App 页面" src={url} sandbox="allow-scripts allow-forms allow-modals" referrerPolicy="no-referrer" className="h-full w-full border-0" />;
}
