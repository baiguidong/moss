const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
app.setPath('userData', process.env.MOSS_PRESENTATION_UI_TEMP);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 940, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  try {
    await win.loadURL(process.env.MOSS_PRESENTATION_UI_URL);
    const results = await win.webContents.executeJavaScript('window.runPresentationReview()');
    const output = process.env.MOSS_PRESENTATION_SMOKE_OUTPUT;
    if (output) {
      await fs.mkdir(output, { recursive: true });
      for (const mode of ['workspace', 'results', 'expanded', 'diff']) {
        await win.webContents.executeJavaScript(`window.showPresentationExample(${JSON.stringify(mode)})`);
        await fs.writeFile(path.join(output, `conversation-${mode}.png`), (await win.webContents.capturePage()).toPNG());
      }
      await fs.writeFile(path.join(output, 'ui-scenarios.json'), JSON.stringify(results, null, 2));
      for (const width of [320, 440, 560]) {
        await win.webContents.executeJavaScript(`window.showCompactPreviewExample(${width})`);
        await fs.writeFile(path.join(output, `compact-preview-${width}.png`), (await win.webContents.capturePage()).toPNG());
      }
      await win.webContents.executeJavaScript('window.showCompactPreviewExample(320, true)');
      await fs.writeFile(path.join(output, 'compact-preview-dark.png'), (await win.webContents.capturePage()).toPNG());
      win.setSize(520, 420);
      await win.webContents.executeJavaScript('window.showRetryExample()');
      await fs.writeFile(path.join(output, 'retry-status.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('PRESENTATION_UI_PASSED: ' + JSON.stringify(results)); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
