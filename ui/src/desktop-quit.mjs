// Let a preview veto closing (for example, for unsaved edits) before services stop.
export function closeWindowBeforeQuit(window) {
  if (!window || window.isDestroyed()) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const contents = window.webContents;
    const cleanup = () => {
      window.off('closed', onClosed);
      contents.off('will-prevent-unload', onPrevented);
    };
    const finish = closed => { cleanup(); resolve(closed); };
    const onClosed = () => finish(true);
    const onPrevented = () => finish(false);
    window.once('closed', onClosed);
    contents.once('will-prevent-unload', onPrevented);
    try { window.close(); } catch (error) { cleanup(); reject(error); }
  });
}
