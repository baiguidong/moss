import { pathToFileURL } from 'node:url';

const windows = new Map();
export async function openAppFilePreview(BrowserWindow, file) {
  const existing = windows.get(file);
  if (existing && !existing.isDestroyed()) {
    // A report opened during the run must display the final saved results too.
    await existing.loadFile(file);
    existing.show(); existing.focus(); return;
  }
  const window = new BrowserWindow({ width: 1240, height: 900, minWidth: 480, minHeight: 500,
    title: 'Moss 文件预览', backgroundColor: '#f3f5f8', show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  windows.set(file, window);
  window.on('closed', () => windows.delete(file));
  const allowed = pathToFileURL(file).href;
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== allowed) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try { await window.loadFile(file); window.show(); }
  catch (error) { window.destroy(); throw error; }
}
