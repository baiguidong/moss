import { createMossClient } from '../client/moss-client.mjs';
import { createWebTransport } from '../client/web-transport.mjs';

let environmentGeneration: number | undefined;
async function jsonFetch(url: string, init?: RequestInit) {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { ...init?.headers, ...(environmentGeneration !== undefined ? { 'X-Moss-Generation': String(environmentGeneration) } : {}) } });
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
  environmentGeneration = auth.managed ? auth.environment?.generation || 0 : undefined;
  if (auth.managed && (auth.environment?.operation || auth.hostUnavailable || auth.environment?.state !== 'ready')) { location.replace('/?window=cloud-environment'); await new Promise(() => {}); }
  const updateStatus = mountWebSessionControls(async () => {
    await jsonFetch('/api/logout', { method: 'POST' });
    const { clearUserDrafts } = await import('./lib/web-drafts');
    await clearUserDrafts().catch(() => {});
    localStorage.clear(); sessionStorage.clear(); location.reload();
  });
  const fileUrl = (filePath: string) => `/api/files?path=${encodeURIComponent(filePath)}`;
  const uploadFile = (file: File) => jsonFetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  window.mossWeb = { fileUrl, uploadFile, snapshot: null, managed: !!auth.managed, generation: environmentGeneration };
  let viewId: string;
  try { viewId = sessionStorage.getItem('moss-web-view') || crypto.randomUUID(); sessionStorage.setItem('moss-web-view', viewId); } catch { viewId = crypto.randomUUID(); }
  const transport = createWebTransport({
    viewId, generation: environmentGeneration,
    url: `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/ws${environmentGeneration === undefined ? '' : `?generation=${environmentGeneration}`}`,
    isAuthenticated: async () => { const current = await jsonFetch('/api/auth'); return current.authenticated && auth.managed && current.environment?.generation !== environmentGeneration ? 'changed' : current.authenticated; },
    onStatus(status: string) {
      if (status === 'unauthenticated') void import('./lib/web-drafts').then(module => module.clearUserDrafts()).catch(() => {});
      updateStatus(status);
      window.dispatchEvent(new CustomEvent('moss:connection', { detail: status }));
    },
    onSnapshot(snapshot: any) {
      window.mossWeb!.snapshot = snapshot;
      window.mossWeb!.capabilities = snapshot.capabilities;
      window.mossWeb!.identity = snapshot.identity;
      window.dispatchEvent(new CustomEvent('moss:reconnected', { detail: snapshot }));
    },
  });
  const client = createMossClient(transport) as Window['agentDesktop'];
  const browseFiles: typeof import('./components/web-file-browser').showWebFileBrowser = async options => {
    const { showWebFileBrowser } = await import('./components/web-file-browser');
    return showWebFileBrowser(options);
  };
  client.fs.uploadFile = uploadFile;
  client.authenticateRemoteServer = async payload => {
    const tab = window.open('about:blank', '_blank');
    if (tab) { tab.opener = null; tab.document.title = '正在准备 Moss 授权…'; window.mossWeb!.authorizationWindow = tab; }
    const watch = tab ? setInterval(() => { if (tab.closed) { clearInterval(watch); void client.cancelRemoteServerAuthentication().catch(() => {}); } }, 500) : undefined;
    try { return await transport.invoke('agent:remote-authenticate', payload); }
    finally { clearInterval(watch); if (window.mossWeb!.authorizationWindow === tab) window.mossWeb!.authorizationWindow = undefined; tab?.close(); }
  };
  client.installAppArchive = async () => {
    const chosen = await browseFiles({ kind: 'file', title: '选择 App ZIP 安装包', extensions: ['zip'], uploadFile });
    if (!chosen?.[0]) return { ok: false, canceled: true };
    return transport.invoke('app:install-archive', { filePath: chosen[0].path });
  };
  client.pickFiles = async () => await browseFiles({ kind: 'file', multiple: true, uploadFile }) || [];
  client.pickDirectory = async () => {
    const chosen = await browseFiles({ kind: 'directory', onSelect: async entries => {
      await client.touchWorkspace({ path: entries[0].path });
    } });
    return chosen?.[0]?.path || null;
  };
  client.skillHub.openImportDialog = async () => {
    const chosen = await browseFiles({ kind: 'any', title: '选择技能文件夹或 ZIP 文件', extensions: ['zip'], uploadFile });
    return chosen?.[0] ? { success: true, data: { filePath: chosen[0].path } } : { success: false, error: 'Canceled' };
  };
  client.shell.openExternal = async url => {
    if (/^\/_moss\/resource\/[\w-]{43}\//.test(url)) url = new URL(url, location.origin).href;
    if (!/^(https?:|mailto:)/i.test(url)) throw new Error('不支持此链接。');
    const tab = window.open('about:blank', '_blank');
    if (!tab) throw new Error('浏览器拦截了新页面，请允许弹出窗口后重试。');
    tab.opener = null; tab.location.replace(url); return { ok: true };
  };
  client.shell.openFile = async filePath => {
    const link = document.createElement('a'); link.href = fileUrl(filePath) + '&download'; link.download = '';
    document.body.append(link); link.click(); link.remove(); return '';
  };
  client.shell.showItemInFolder = async filePath => {
    await browseFiles({ kind: 'browse', revealPath: filePath });
    return { ok: true };
  };
  client.openWorkspace = async payload => {
    const session = await client.getSession(payload);
    if (session.agentMode === 'remote-direct') throw new Error('请在会话文件列表中查看远程工作区。');
    if (!session.workspace) throw new Error('此会话尚未设置工作区。');
    await browseFiles({ kind: 'browse', initialPath: session.workspace });
    return { ok: true };
  };
  client.openTerminal = async payload => {
    const tab = window.open('about:blank', '_blank');
    if (!tab) throw new Error('请允许弹出终端页面。');
    tab.opener = null;
    try {
      const result = await transport.invoke('terminal:open', payload);
      tab.location.href = `/?window=terminal&terminalId=${encodeURIComponent(result.terminalId)}`;
      return { ok: true };
    } catch (error) { tab.close(); throw error; }
  };
  client.openAppResource = async uri => {
    const tab = window.open('about:blank', '_blank'); if (!tab) throw new Error('请允许弹出预览页面。'); tab.opener = null;
    try { const file = await client.preview.readFile({ filePath: uri }); const result = await transport.invoke('preview.open', { file }); tab.location.replace(result.url); return { opened: true }; }
    catch (error) { tab.close(); throw error; }
  };
  client.launchApp = async ({ name }) => client.shell.openExternal(`${location.origin}/?window=app&name=${encodeURIComponent(name)}`);
  client.logDownload = async () => { const result = await transport.invoke('log:download'); if (result.path) await client.shell.openFile(result.path); return result; };
  const decoratePreview = async (file: any) => file?.contentType === 'html'
    ? transport.invoke('web:preview-resource', { file }) : file;
  const readPreview = client.preview.readFile;
  client.preview.readFile = async payload => decoratePreview(await readPreview(payload));
  const loadPresentation = client.presentation.load;
  client.presentation.load = async payload => {
    const result = await loadPresentation(payload);
    return result.file ? { ...result, file: await decoratePreview(result.file) } : result;
  };
  client.preview.open = async payload => {
    const tab = window.open('about:blank', '_blank');
    if (!tab) throw new Error('请允许弹出预览页面后重试。');
    tab.opener = null;
    try { const result = await transport.invoke('preview.open', payload); tab.location.replace(result.url); return result; }
    catch (error) { tab.close(); throw error; }
  };
  client.presentation.popout = async payload => {
    const tab = window.open('about:blank', '_blank');
    if (!tab) throw new Error('请允许弹出预览页面后重试。');
    tab.opener = null;
    try {
      const result = await client.presentation.load(payload);
      if (!result.file) throw new Error('此资源没有文件预览。');
      const opened = await transport.invoke('preview.open', { file: result.file });
      tab.location.replace(opened.url); return { ok: true };
    } catch (error) { tab.close(); throw error; }
  };
  const previewListeners = new Set<(payload: any) => void>();
  client.preview.onOpen = callback => { previewListeners.add(callback); return () => { previewListeners.delete(callback); }; };
  client.preview.ready = async () => {
    const id = new URLSearchParams(location.search).get('previewId');
    if (id) { const payload = await transport.invoke('web:preview-get', { id }); for (const fn of previewListeners) fn(payload); }
    return { ok: true };
  };
  client.preview.close = async () => { const id = new URLSearchParams(location.search).get('previewId'); if (id) await transport.invoke('web:preview-close', { id }); window.close(); return { ok: true }; };
  client.preview.sync = async () => ({ ok: true }); // Ownership state is synchronized through the Host.
  window.agentDesktop = client;
  const terminalId = new URLSearchParams(location.search).get('terminalId');
  let terminalRequestId = '';
  let terminalGeneration = 0, sequence = -1;
  let starting = false;
  let queued: Array<{ method: string; payload: any }> = [];
  const terminalListeners = new Map<string, Set<(payload: any) => void>>();
  const deliver = (method: string, payload: any) => {
    if (payload.terminalId !== terminalId) return;
    if (starting) { queued.push({ method, payload }); return; }
    if (payload.generation !== terminalGeneration || payload.sequence <= sequence) return;
    sequence = payload.sequence;
    for (const callback of terminalListeners.get(method) || []) callback({ ...payload, requestId: terminalRequestId });
  };
  for (const method of ['terminal:data', 'terminal:exit']) transport.on(method, (payload: any) => deliver(method, payload));
  const subscribe = (method: string, callback: (payload: any) => void) => {
    if (!terminalListeners.has(method)) terminalListeners.set(method, new Set());
    terminalListeners.get(method)!.add(callback);
    return () => { terminalListeners.get(method)?.delete(callback); };
  };
  window.mossTerminal = {
    start: async payload => {
      terminalRequestId = payload.requestId;
      starting = true;
      try {
        const result = await transport.invoke('terminal:start', { ...payload, terminalId, generation: terminalGeneration });
        terminalGeneration = result.generation; sequence = result.sequence;
        // The snapshot includes all events preceding its response. Later events are delivered after the caller restores it.
        setTimeout(() => { starting = false; const events = queued; queued = []; events.forEach(event => deliver(event.method, event.payload)); }, 0);
        return result;
      } catch (error) { starting = false; queued = []; throw error; }
    },
    write: payload => transport.invoke('terminal:write', { ...payload, terminalId, generation: terminalGeneration }),
    resize: payload => transport.invoke('terminal:resize', { ...payload, terminalId, generation: terminalGeneration }),
    stop: () => Promise.resolve(), // A browser disconnect only detaches its view.
    terminate: () => transport.invoke('terminal:stop', { terminalId, generation: terminalGeneration }),
    onData: callback => subscribe('terminal:data', callback),
    onExit: callback => subscribe('terminal:exit', callback),
  };
}
