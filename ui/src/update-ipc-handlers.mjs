export function registerUpdateHandlers({ ipcMain, getWindow, coordinator, openExternal }) {
  const handlers = {
    'update:get-state': () => coordinator.getState(),
    'update:check': () => coordinator.check(),
    'update:download': params => coordinator.download(params?.candidateId),
    'update:cancel': () => coordinator.cancel(),
    'update:dismiss': params => coordinator.dismiss(params?.version),
    'update:set-auto-download': params => coordinator.setAutoDownload(params?.enabled),
    'update:open-downloaded': params => coordinator.open(params?.downloadId),
    'update:show-downloaded': params => coordinator.open(params?.downloadId, true),
    'update:install': params => coordinator.install(params?.candidateId),
    'update:open-release-page': async () => {
      await openExternal(coordinator.getState().releasePage);
      return coordinator.getState();
    },
  };
  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, params) => {
      const window = getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        return { success: false, msg: '更新请求来源无效。' };
      }
      try { return { success: true, data: await handler(params) }; }
      catch (error) { return { success: false, msg: error instanceof Error ? error.message : String(error) }; }
    });
  }
}
