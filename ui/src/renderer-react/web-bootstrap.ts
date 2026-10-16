import { createMossClient } from '../client/moss-client.mjs';
import { createWebTransport } from '../client/web-transport.mjs';

async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || '请求失败');
  return body;
}

export async function initializeHostClient() {
  if (window.agentDesktop) return;
  const { showWebLogin, mountWebSessionControls } = await import('./web-interface');
  const auth = await jsonFetch('/api/auth');
  if (!auth.authenticated) {
    await showWebLogin(auth.mode, values => jsonFetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
    }));
  }
  const updateStatus = mountWebSessionControls(async () => {
    await jsonFetch('/api/logout', { method: 'POST' });
    localStorage.clear(); sessionStorage.clear(); location.reload();
  });
  const fileUrl = (filePath: string) => `/api/files?path=${encodeURIComponent(filePath)}`;
  const uploadFile = (file: File) => jsonFetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  window.mossWeb = { fileUrl, uploadFile, snapshot: null };
  const transport = createWebTransport({
    url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`,
    isAuthenticated: async () => (await jsonFetch('/api/auth')).authenticated,
    onStatus: updateStatus,
    onSnapshot(snapshot: unknown) {
      window.mossWeb!.snapshot = snapshot;
      window.dispatchEvent(new CustomEvent('moss:reconnected', { detail: snapshot }));
    },
  });
  const client = createMossClient(transport) as Window['agentDesktop'];
  client.fs.uploadFile = uploadFile;
  client.pickFiles = () => new Promise((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.multiple = true;
    input.onchange = async () => {
      try { resolve(await Promise.all(Array.from(input.files || []).map(uploadFile))); }
      catch (error) { reject(error); }
    };
    input.oncancel = () => resolve([]); input.click();
  });
  client.pickDirectory = async () => {
    const chosen = window.prompt('输入云电脑内的目录绝对路径');
    return chosen?.trim() || null;
  };
  client.shell.openExternal = async url => {
    if (!/^(https?:|mailto:)/i.test(url)) throw new Error('不支持此链接。');
    window.open(url, '_blank', 'noopener,noreferrer'); return { ok: true };
  };
  client.shell.openFile = async filePath => { window.open(fileUrl(filePath), '_blank', 'noopener,noreferrer'); return ''; };
  client.shell.showItemInFolder = async () => { throw new Error('请在工作区文件列表中查看云端文件。'); };
  client.openWorkspace = async () => { throw new Error('请在工作区文件列表中查看云端目录。'); };
  client.openTerminal = async payload => {
    const tab = window.open('about:blank', '_blank');
    if (!tab) throw new Error('请允许弹出终端页面。');
    try {
      const result = await transport.invoke('terminal:open', payload);
      tab.location.href = `/?window=terminal&terminalId=${encodeURIComponent(result.terminalId)}`;
      return { ok: true };
    } catch (error) { tab.close(); throw error; }
  };
  window.agentDesktop = client;
  const terminalId = new URLSearchParams(location.search).get('terminalId');
  const requestId = terminalId || crypto.randomUUID();
  const subscribe = (method: string, callback: (payload: any) => void) => {
    const fn = (payload: any) => { if (payload.terminalId === terminalId) callback({ ...payload, requestId: terminalRequestId }); };
    transport.on(method, fn); return () => transport.off(method, fn);
  };
  let terminalRequestId = requestId;
  window.mossTerminal = {
    start: async payload => {
      terminalRequestId = payload.requestId;
      return transport.invoke('terminal:start', { ...payload, terminalId, requestId });
    },
    write: payload => transport.invoke('terminal:write', { ...payload, terminalId }),
    resize: payload => transport.invoke('terminal:resize', { ...payload, terminalId }),
    stop: () => Promise.resolve(), // A browser disconnect does not terminate its shell.
    onData: callback => subscribe('terminal:data', callback),
    onExit: callback => subscribe('terminal:exit', callback),
  };
}
