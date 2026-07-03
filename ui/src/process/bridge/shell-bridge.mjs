import electron from 'electron';

const { ipcMain, shell } = electron;

export function registerShellIpcHandlers() {
  ipcMain.handle('shell.open-file', async (_event, filePath) => {
    return await shell.openPath(filePath);
  });

  ipcMain.handle('shell.open-external', async (_event, url) => {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return { ok: false, error: 'Invalid URL' };
    }
    const allowedProtocols = new Set(['http:', 'https:', 'mailto:']);
    if (!allowedProtocols.has(parsed.protocol)) {
      return { ok: false, error: `Protocol not allowed: ${parsed.protocol}` };
    }
    await shell.openExternal(parsed.href);
    return { ok: true };
  });

  ipcMain.handle('shell.show-item-in-folder', async (_event, filePath) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  });
}
