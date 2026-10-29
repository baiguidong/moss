export function registerPresentationIpcHandlers({ ipcMain, service, openPreviewWindow, resolveItem, getSessionRecord }) {
  ipcMain.handle('presentation:resolve', async (_event, input) => {
    if (!input || !Array.isArray(input.references) || input.references.length > 32 || input.references.some(ref => typeof ref !== 'string' || !ref || ref.length > 8192)) throw new Error('Invalid reference batch');
    const record = getSessionRecord(input.sessionId);
    return Promise.all(input.references.map(async reference => {
      try { const resource = await resolveItem(record, { path: reference }, { origin: 'manual' }); return { reference, available: true, kind: resource.kind }; }
      catch { return { reference, available: false }; }
    }));
  });
  ipcMain.handle('presentation:refresh', (_event, input) => service.refresh(input.sessionId, { activeOnly: input.activeOnly === true }));
  ipcMain.handle('presentation:snapshot', (_event, input = {}) => service.snapshot(input.sessionId, { activate: input.activate === true }));
  ipcMain.handle('presentation:action', (_event, input) => service.action(input.sessionId, input.action));
  ipcMain.handle('presentation:open', (_event, input) => service.present(input.sessionId, input.input, { origin: 'manual' }));
  ipcMain.handle('presentation:load', (_event, input) => service.load(input.sessionId, input.artifactId));
  ipcMain.handle('presentation:ack', (_event, input) => service.acknowledge(input.sessionId, input));
  ipcMain.handle('presentation:popout', async (_event, input) => {
    const { file } = await service.load(input.sessionId, input.artifactId);
    if (!file) throw new Error('This resource cannot be opened in a separate preview');
    await openPreviewWindow({ file });
    return { ok: true };
  });
}
