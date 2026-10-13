const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');

app.setPath('userData', path.join(process.env.CHAT_SELECTION_TEMP, 'profile'));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1000, height: 800, webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'chat-interactions-preload.cjs') } });
  ipcMain.handle('fixture:input', (_event, input) => win.webContents.sendInputEvent(input));
  ipcMain.handle('fixture:capture', async (_event, name) => {
    if (!process.env.CHAT_SELECTION_SCREENSHOTS || !/^[a-z-]+$/.test(name)) return;
    await fs.mkdir(process.env.CHAT_SELECTION_SCREENSHOTS, { recursive: true });
    await fs.writeFile(path.join(process.env.CHAT_SELECTION_SCREENSHOTS, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: 'Edit', submenu: [{ role: 'copy' }] }]));
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error(event.message);
  });
  try {
    await win.loadURL(process.env.CHAT_SELECTION_URL);
    let ready = false;
    for (let i = 0; i < 150; i++) {
      ready = await win.webContents.executeJavaScript('Boolean(window.selectionFixtureReady)');
      if (ready) break;
      await delay(100);
    }
    assert(ready, 'selection fixture did not load');
    const checks = await win.webContents.executeJavaScript('window.runSelectionChecks()');
    checks.forEach((name) => console.log(`PASS ${name}`));
    const appearanceChecks = await win.webContents.executeJavaScript('window.runAppearanceChecks()');
    appearanceChecks.forEach((name) => console.log(`PASS ${name}`));

    await win.webContents.executeJavaScript('window.prepareChatInteractions()');
    const nativeFile = path.join(process.env.CHAT_SELECTION_TEMP, '报告 (native).txt');
    await fs.writeFile(nativeFile, 'native drag file');
    win.webContents.debugger.attach('1.3');
    const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#native-drag-file' });
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [nativeFile] });
    win.webContents.debugger.detach();
    const interactionChecks = await win.webContents.executeJavaScript('window.runChatInteractionChecks()');
    interactionChecks.forEach(name => console.log(`PASS ${name}`));

    for (const theme of ['light', 'dark']) {
      for (const role of ['user', 'assistant']) {
        const geometry = await win.webContents.executeJavaScript(`window.prepareNativeSelection(${JSON.stringify(theme)}, ${JSON.stringify(role)})`);
        win.webContents.focus();
        win.webContents.sendInputEvent({ type: 'mouseMove', x: geometry.x1, y: geometry.y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x: geometry.x1, y: geometry.y, button: 'left', clickCount: 1 });
        for (let step = 1; step <= 8; step++) {
          win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(geometry.x1 + (geometry.x2 - geometry.x1) * step / 8), y: geometry.y, button: 'left' });
          await delay(15);
        }
        win.webContents.sendInputEvent({ type: 'mouseUp', x: geometry.x2, y: geometry.y, button: 'left', clickCount: 1 });
        const selected = await win.webContents.executeJavaScript('window.getSelection().toString()');
        assert(selected.length >= 8, `${theme} ${role}: mouse drag did not select text`);
        // Use the native edit command behind Electron's copy menu role.
        // Synthetic renderer key events bypass macOS's native menu accelerators.
        win.webContents.copy();
        await delay(100);
        assert.equal(await win.webContents.executeJavaScript('window.nativeCopyText'), selected, 'native copy command did not receive the selection');
        if (process.env.CHAT_SELECTION_SCREENSHOTS) {
          await fs.mkdir(process.env.CHAT_SELECTION_SCREENSHOTS, { recursive: true });
          await fs.writeFile(path.join(process.env.CHAT_SELECTION_SCREENSHOTS, `${theme}-${role}.png`), (await win.webContents.capturePage()).toPNG());
        }
        console.log(`PASS ${theme} ${role}: mouse selection and native copy command`);
      }
    }
    if (process.env.CHAT_SELECTION_SCREENSHOTS) {
      for (const theme of ['light', 'dark']) {
        for (const border of [false, true]) {
          for (const avatar of [true, false]) {
            await win.webContents.executeJavaScript(`window.prepareAppearancePreview(${JSON.stringify(theme)}, ${border}, ${avatar})`);
            await fs.writeFile(path.join(process.env.CHAT_SELECTION_SCREENSHOTS, `appearance-${theme}-${border ? 'border' : 'plain'}-${avatar ? 'avatar' : 'no-avatar'}.png`), (await win.webContents.capturePage()).toPNG());
          }
        }
      }
    }
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (process.env.CHAT_SELECTION_SCREENSHOTS) {
      await fs.mkdir(process.env.CHAT_SELECTION_SCREENSHOTS, { recursive: true });
      await fs.writeFile(path.join(process.env.CHAT_SELECTION_SCREENSHOTS, 'failure.png'), (await win.webContents.capturePage()).toPNG());
    }
    win.destroy();
    app.exit(1);
  }
});
