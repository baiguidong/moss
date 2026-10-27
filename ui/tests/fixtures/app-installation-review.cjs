const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
app.setPath('userData', process.env.MOSS_INSTALLATION_UI_TEMP);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1040, height: 820, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  try {
    await win.loadURL(process.env.MOSS_INSTALLATION_UI_URL);
    const disclosure = JSON.parse(await fs.readFile(path.join(process.env.MOSS_INSTALLATION_UI_TEMP, 'disclosure.json'), 'utf8'));
    const results = await win.webContents.executeJavaScript(`window.runInstallationReview(${JSON.stringify(disclosure)})`);
    const output = process.env.MOSS_INSTALLATION_UI_OUTPUT;
    if (output) await fs.mkdir(output, { recursive: true });
    for (const [name, width, height, theme, stress] of [
      ['desktop', 1040, 820, 'light', false], ['short', 800, 500, 'light', false],
      ['compact', 520, 420, 'light', false], ['mobile', 390, 600, 'light', false],
      ['dark', 1040, 820, 'dark', false], ['many-tools', 800, 500, 'light', true],
    ]) {
      win.setContentSize(width, height);
      await win.webContents.executeJavaScript(`window.showInstallationExample(${JSON.stringify(theme)}, ${stress})`);
      results.push(await win.webContents.executeJavaScript(`window.checkInstallationBounds(${JSON.stringify(name)})`));
      if (output) await fs.writeFile(path.join(output, `install-confirmation-${name}.png`), (await win.webContents.capturePage()).toPNG());
    }
    if (output) await fs.writeFile(path.join(output, 'install-confirmation-scenarios.json'), JSON.stringify(results, null, 2));
    console.log('INSTALLATION_UI_PASSED: ' + JSON.stringify(results));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
