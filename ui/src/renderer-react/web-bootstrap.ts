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
  const auth = await jsonFetch('/api/auth');
  if (!auth.authenticated) {
    const root = document.getElementById('root')!;
    root.innerHTML = `<div style="font:15px system-ui;max-width:340px;margin:15vh auto;padding:32px;border:1px solid #ddd;border-radius:16px"><h1>Moss</h1><p>登录我的云电脑</p><form>${auth.mode === 'server' ? '<label>账号<input name="username" autocomplete="username" required></label><label>密码<input name="password" type="password" autocomplete="current-password" required></label>' : '<label>访问密钥<input name="token" type="password" autocomplete="current-password" required></label>'}<button type="submit">登录</button><p role="alert"></p></form><style>input,button{box-sizing:border-box;display:block;width:100%;margin:10px 0 20px;padding:10px}button{cursor:pointer}</style></div>`;
    await new Promise<void>(resolve => {
      const form = root.querySelector('form')!;
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button')!;
        button.disabled = true;
        try {
          await jsonFetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
          root.replaceChildren(); resolve();
        } catch (error) { form.querySelector('[role=alert]')!.textContent = (error as Error).message; }
        finally { button.disabled = false; }
      });
    });
  }
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;right:14px;bottom:5px;z-index:9999;font:11px system-ui;background:var(--background,#fff);border-radius:4px;padding:2px 5px';
  const label = document.createElement('span');
  const logout = document.createElement('button');
  logout.textContent = '退出'; logout.style.marginLeft = '12px';
  logout.onclick = async () => { await jsonFetch('/api/logout', { method: 'POST' }); location.reload(); };
  status.append(label, logout); document.body.append(status);
  const fileUrl = (filePath: string) => `/api/files?path=${encodeURIComponent(filePath)}`;
  const uploadFile = (file: File) => jsonFetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  window.mossWeb = { fileUrl, uploadFile, snapshot: null };
  const transport = createWebTransport({
    url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws`,
    isAuthenticated: async () => (await jsonFetch('/api/auth')).authenticated,
    onStatus(value: string) {
      label.textContent = ({ connected: '我的云电脑', connecting: '正在连接…', disconnected: '连接已断开，正在重连…', unauthenticated: '登录已失效，请刷新', incompatible: '版本已更新，请刷新' })[value] || value;
    },
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
