import * as React from 'react';
import { showWebFileBrowser } from './web-file-browser';
export function WebInteractions() {
  const [items, setItems] = React.useState<any[]>([]), [error, setError] = React.useState(''), [busy, setBusy] = React.useState('');
  const capture = React.useRef<{ id: string; canceled: boolean; stream?: MediaStream } | null>(null);
  const startedPicks = React.useRef(new Set<string>());
  React.useEffect(() => {
    const current = capture.current;
    if (current && !items.some(item => item.id === current.id)) { current.canceled = true; current.stream?.getTracks().forEach(track => track.stop()); }
  }, [items]);
  React.useEffect(() => () => { if (capture.current) { capture.current.canceled = true; capture.current.stream?.getTracks().forEach(track => track.stop()); } }, []);
  React.useEffect(() => {
    if (!window.mossWeb) return;
    let active = true, revision = 0;
    const refresh = () => { const serial = ++revision; void window.agentDesktop.ipcInvoke('web:interactions-list').then(items => { if (active && serial === revision) setItems(items); }).catch(() => {}); };
    const handler = window.agentDesktop.ipcOn('web:interactions-changed', refresh);
    window.addEventListener('moss:reconnected', refresh); refresh();
    return () => { active = false; window.agentDesktop.ipcOff('web:interactions-changed', handler); window.removeEventListener('moss:reconnected', refresh); };
  }, []);
  const respond = (id: string, result: any) => window.agentDesktop.ipcInvoke('web:interactions-respond', { id, result });
  const open = async (item: any) => {
    setBusy(item.id); setError('');
    try {
      if (item.kind === 'screen') {
        const current = { id: item.id, canceled: false, stream: undefined as MediaStream | undefined }; capture.current = current;
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        current.stream = stream;
        try {
          if (current.canceled) return;
          const video = document.createElement('video'); video.srcObject = stream; video.muted = true; await video.play();
          if (current.canceled) return;
          const canvas = document.createElement('canvas'), ratio = Math.min(1, 4096 / Math.max(video.videoWidth, video.videoHeight));
          canvas.width = Math.max(1, Math.round(video.videoWidth * ratio)); canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
          canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法生成截图')), 'image/png'));
          if (current.canceled) return;
          const uploaded = await window.mossWeb!.uploadFile(new File([blob], 'screenshot.png', { type: 'image/png' }));
          if (current.canceled) return;
          await respond(item.id, [uploaded.path]); video.srcObject = null;
        } finally { stream.getTracks().forEach(track => track.stop()); if (capture.current === current) capture.current = null; }
      } else if (item.kind === 'pick') {
        const files = await showWebFileBrowser({ ...item.input, uploadFile: window.mossWeb!.uploadFile });
        await respond(item.id, files?.map(item => item.path) || null);
      } else {
        if (item.kind === 'download') await window.agentDesktop.shell.openFile(item.input.path);
        else if (item.kind === 'reveal') await window.agentDesktop.shell.showItemInFolder(item.input.path);
        else await window.agentDesktop.shell.openExternal(item.input.url);
        await respond(item.id, true);
      }
    } catch (error) { if (item.kind === 'screen') { capture.current = null; await respond(item.id, null).catch(() => {}); } setError(String(error)); }
    finally { setBusy(''); }
  };
  React.useEffect(() => {
    const next = items.find(item => item.kind === 'pick' && !startedPicks.current.has(item.id));
    if (!next) return;
    startedPicks.current.add(next.id);
    void open(next);
  }, [items]);
  if (!items.length) return null;
  const visible = items.filter(item => item.kind !== 'pick' || error);
  if (!visible.length) return null;
  return <aside className="fixed bottom-28 right-4 z-50 max-w-sm rounded border bg-background p-3 text-sm shadow" aria-label="待处理文件操作">
    {visible.map(item => <div key={item.id} className="my-2"><p>{item.input.title || (item.kind === 'download' ? '下载到浏览器设备' : '打开链接')}</p>{(item.input.url || item.input.path) && <p className="break-all text-xs text-muted-foreground">{item.input.url || item.input.path}</p>}<button disabled={!!busy} className="mr-3 underline" onClick={() => void open(item)}>继续</button><button disabled={!!busy} onClick={() => void respond(item.id, null).catch(reason => setError(String(reason)))}>取消</button></div>)}
    {error && <p role="alert">{error}</p>}
  </aside>;
}
