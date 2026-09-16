import electron from 'electron';

const { ipcMain } = electron;

export function registerPreviewIpcHandlers({
  openPreviewWindow,
  syncPreviewWindow,
  closePreviewWindow,
  markPreviewWindowReady,
}) {
  ipcMain.handle('preview.open', async (_event, data) => {
    await openPreviewWindow?.(data);
    return { ok: true };
  });

  ipcMain.handle('preview.sync', async (_event, data) => {
    syncPreviewWindow?.(data);
    return { ok: true };
  });

  ipcMain.handle('preview.ready', async (event) => {
    markPreviewWindowReady?.(event.sender);
    return { ok: true };
  });

  ipcMain.handle('preview.close', async () => {
    closePreviewWindow?.();
    return { ok: true };
  });
}
