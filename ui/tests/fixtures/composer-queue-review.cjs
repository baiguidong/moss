const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
app.setPath('userData', process.env.MOSS_PRESENTATION_UI_TEMP);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 940, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
  try {
    await win.loadURL(process.env.MOSS_PRESENTATION_UI_URL);
    const results = await win.webContents.executeJavaScript('window.runComposerQueueReview()');
    console.log('COMPOSER_QUEUE_UI_PASSED: ' + JSON.stringify(results));
    await win.setSize(520, 900);
    const interactions = await win.webContents.executeJavaScript('window.runSessionInteractionReview()');
    console.log('SESSION_INTERACTION_UI_PASSED: ' + JSON.stringify(interactions));
    if (process.env.MOSS_INTERACTIONS_EVIDENCE_DIR) {
      await fs.mkdir(process.env.MOSS_INTERACTIONS_EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.MOSS_INTERACTIONS_EVIDENCE_DIR, 'side-question.png'), (await win.webContents.capturePage()).toPNG());
      await win.setSize(1120, 900);
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(process.env.MOSS_INTERACTIONS_EVIDENCE_DIR, 'side-question-wide.png'), (await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript('window.closeSideWindow()');
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.writeFile(path.join(process.env.MOSS_INTERACTIONS_EVIDENCE_DIR, 'main-composer.png'), (await win.webContents.capturePage()).toPNG());
    }
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
