import fs from 'node:fs';

const ACTION_TITLES = { terminal: '终端', new: '新会话', resume: '跟随会话' };
const quoteShell = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const quotePowerShell = (value) => `'${String(value).replace(/'/g, "''")}'`;
const dimension = (value, fallback) => Number.isFinite(value)
  ? Math.min(500, Math.max(2, Math.floor(value))) : fallback;

export function buildTerminalLaunch({
  action, session, transcriptPath, cliPath, nodePath,
  env = process.env, platform = process.platform, fileExists = fs.existsSync,
}) {
  if (!Object.hasOwn(ACTION_TITLES, action)) throw new Error('未知终端操作。');
  if (!session || session.agentMode === 'remote-direct') {
    throw new Error('内置终端仅支持本地会话。');
  }
  const cwd = session.workspace;
  if (!cwd || !fileExists(cwd)) throw new Error('会话工作目录不存在。');
  const shell = platform === 'win32' ? 'powershell.exe' : env.SHELL || '/bin/bash';
  const terminalEnv = Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string'));
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']) {
    delete terminalEnv[key];
  }
  terminalEnv.TERM = 'xterm-256color';
  terminalEnv.COLORTERM = 'truecolor';
  let args = platform === 'win32' ? ['-NoLogo'] : ['-l'];
  if (action !== 'terminal') {
    if (!cliPath || !fileExists(cliPath)) throw new Error('Moss CLI 尚未构建，请先运行桌面构建。');
    if (!nodePath || !fileExists(nodePath)) throw new Error('Node.js 运行时尚未就绪。');
    const cliArgs = [nodePath, cliPath];
    if (action === 'resume') {
      if (session.busy) throw new Error('请等待当前回复完成后再跟随会话。');
      if (session.resumeReadOnlyReason) throw new Error(session.resumeReadOnlyReason);
      if (!session.underlyingSessionId || !transcriptPath || !fileExists(transcriptPath)) {
        throw new Error('当前会话尚无可恢复的记录。');
      }
      cliArgs.push('--resume', transcriptPath);
    }
    if (platform === 'win32') {
      // EncodedCommand preserves paths containing spaces, quotes and shell metacharacters.
      const command = `& ${cliArgs.map(quotePowerShell).join(' ')}`;
      args = ['-NoLogo', '-NoExit', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
    } else {
      args = ['-l', '-i', '-c', `${cliArgs.map(quoteShell).join(' ')}; exec ${quoteShell(shell)} -l`];
    }
  }
  return { shell, args, cwd, env: terminalEnv, title: `${ACTION_TITLES[action]} · ${session.title || 'Moss'}` };
}

export function createTerminalManager({ loadPty = () => import('node-pty') } = {}) {
  const windows = new Map();

  function getEntry(owner) {
    const entry = windows.get(owner.id);
    if (!entry || entry.owner !== owner || owner.isDestroyed()) throw new Error('终端窗口已关闭。');
    return entry;
  }

  function stopEntry(entry) {
    entry.requestId = null;
    const pty = entry.pty;
    entry.pty = null;
    entry.subscriptions?.forEach((subscription) => subscription.dispose());
    entry.subscriptions = [];
    if (pty) {
      try { pty.kill(); } catch { /* Already exited. */ }
    }
  }

  return {
    attach(owner, launch) {
      const entry = { owner, launch, pty: null, requestId: null, subscriptions: [] };
      windows.set(owner.id, entry);
      owner.once('destroyed', () => { stopEntry(entry); windows.delete(owner.id); });
      owner.on('did-navigate', () => stopEntry(entry));
    },
    async start(owner, { requestId, cols, rows } = {}) {
      if (typeof requestId !== 'string' || !requestId) throw new Error('缺少终端请求 ID。');
      const entry = getEntry(owner);
      stopEntry(entry);
      entry.requestId = requestId;
      const module = await loadPty();
      if (entry.requestId !== requestId || owner.isDestroyed()) return null;
      const { shell, args, cwd, env, title } = entry.launch;
      const pty = (module.default || module).spawn(shell, args, {
        name: 'xterm-256color', cols: dimension(cols, 100), rows: dimension(rows, 30), cwd, env,
      });
      entry.pty = pty;
      const send = (channel, payload) => {
        if (entry.pty === pty && !owner.isDestroyed()) owner.send(channel, { requestId, ...payload });
      };
      entry.subscriptions = [
        pty.onData((data) => send('terminal:data', { data })),
        pty.onExit(({ exitCode }) => {
          send('terminal:exit', { exitCode });
          if (entry.pty === pty) entry.pty = null;
        }),
      ];
      return { title, cwd, shell };
    },
    write(owner, { requestId, data } = {}) {
      const entry = getEntry(owner);
      if (entry.requestId === requestId && typeof data === 'string') entry.pty?.write(data);
    },
    resize(owner, { requestId, cols, rows } = {}) {
      const entry = getEntry(owner);
      if (entry.requestId === requestId) entry.pty?.resize(dimension(cols, 100), dimension(rows, 30));
    },
    stop(owner, { requestId } = {}) {
      const entry = getEntry(owner);
      if (entry.requestId === requestId) stopEntry(entry);
    },
    dispose() {
      for (const entry of windows.values()) stopEntry(entry);
      windows.clear();
    },
  };
}

export function registerTerminalIpc({
  ipcMain, app, BrowserWindow, canOpen, resolveLaunch, preloadPath, rendererHtml, rendererDevServerUrl,
}) {
  const manager = createTerminalManager();
  const terminalWindows = new Set();
  ipcMain.handle('terminal:open', async (event, payload) => {
    if (!canOpen(event.sender)) throw new Error('请从会话顶部打开终端。');
    const launch = await resolveLaunch(payload);
    const window = new BrowserWindow({
      width: 1080, height: 720, minWidth: 600, minHeight: 360,
      title: launch.title, backgroundColor: '#10151c', autoHideMenuBar: true,
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: false },
    });
    terminalWindows.add(window);
    window.once('closed', () => terminalWindows.delete(window));
    manager.attach(window.webContents, launch);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (navigation) => navigation.preventDefault());
    try {
      if (rendererDevServerUrl) {
        const url = new URL(rendererDevServerUrl);
        url.searchParams.set('window', 'terminal');
        await window.loadURL(url.toString());
      } else {
        await window.loadFile(rendererHtml, { query: { window: 'terminal' } });
      }
      return { ok: true };
    } catch (error) {
      window.destroy();
      throw error;
    }
  });
  for (const method of ['start', 'write', 'resize', 'stop']) {
    ipcMain.handle(`terminal:${method}`, (event, payload) => manager[method](event.sender, payload));
  }
  app.on('will-quit', () => manager.dispose());
  return manager;
}
