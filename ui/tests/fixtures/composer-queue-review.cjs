const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
app.setPath('userData', process.env.MOSS_PRESENTATION_UI_TEMP);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 940, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error(message); });
  const cdp = win.webContents.debugger;
  const cdpErrors = [];
  try {
    await win.loadURL(process.env.MOSS_PRESENTATION_UI_URL);
    cdp.attach('1.3');
    await cdp.sendCommand('Runtime.enable');
    await cdp.sendCommand('Page.enable');
    cdp.on('message', (_event, method, params) => {
      if (method === 'Runtime.exceptionThrown') cdpErrors.push(params?.exceptionDetails?.text || 'Runtime exception');
    });
    const results = await win.webContents.executeJavaScript('window.runComposerQueueReview()');
    console.log('COMPOSER_QUEUE_UI_PASSED: ' + JSON.stringify(results));
    const before = await cdp.sendCommand('Runtime.evaluate', { expression: `JSON.stringify({
      composer: Boolean(document.querySelector('textarea')),
      buttons: [...document.querySelectorAll('button')].map(button => button.getAttribute('aria-label') || button.textContent?.trim()).filter(Boolean),
    })`, returnByValue: true });
    const beforeState = JSON.parse(before.result?.value || '{}');
    if (!beforeState.composer) throw new Error('CDP could not find the composer textarea');
    if (!beforeState.buttons.some(label => /发送|打开侧问/.test(label))) throw new Error('CDP could not find composer controls');
    const notices = await win.webContents.executeJavaScript('window.runDraftNoticeReview()');
    console.log('DRAFT_NOTICE_UI_PASSED: ' + JSON.stringify(notices));
    await win.setSize(520, 900);
    const interactions = await win.webContents.executeJavaScript('window.runSessionInteractionReview()');
    console.log('SESSION_INTERACTION_UI_PASSED: ' + JSON.stringify(interactions));
    const after = await cdp.sendCommand('Runtime.evaluate', { expression: `JSON.stringify({
      composer: Boolean(document.querySelector('textarea')),
      sideDialog: Boolean(document.querySelector('[aria-label="侧问窗口"]')),
      queueRows: document.querySelectorAll('[aria-label="移除排队消息"]').length,
      text: document.body.innerText.slice(-1200),
    })`, returnByValue: true });
    const afterState = JSON.parse(after.result?.value || '{}');
    if (!afterState.composer || afterState.queueRows < 0 || !afterState.text.includes('主任务')) throw new Error('CDP interaction state inspection failed');
    const metrics = await cdp.sendCommand('Page.getLayoutMetrics');
    if (!metrics.cssVisualViewport || metrics.cssVisualViewport.clientWidth <= 0 || metrics.cssVisualViewport.clientHeight <= 0) throw new Error('CDP viewport metrics missing');
    console.log('SESSION_INTERACTION_CDP_PASSED: ' + JSON.stringify({ before: beforeState, after: { composer: afterState.composer, sideDialog: afterState.sideDialog, queueRows: afterState.queueRows }, viewport: metrics.cssVisualViewport, runtimeErrors: cdpErrors }));
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
    await win.loadURL(process.env.MOSS_PRESENTATION_UI_URL);
    console.log('DRAFT_RELOAD_UI_PASSED: ' + await win.webContents.executeJavaScript('window.runDraftNoticeReloadReview()'));
    const reopened = new BrowserWindow({ show: false, webPreferences: { contextIsolation: false, nodeIntegration: false } });
    win.destroy();
    await reopened.loadURL(process.env.MOSS_PRESENTATION_UI_URL);
    console.log('DRAFT_REOPEN_UI_PASSED: ' + await reopened.webContents.executeJavaScript('window.runDraftNoticeReloadReview()'));
    cdp.detach();
    app.exit(0);
  } catch (error) { try { if (cdp.isAttached()) cdp.detach(); } catch {} console.error(error); app.exit(1); }
});
