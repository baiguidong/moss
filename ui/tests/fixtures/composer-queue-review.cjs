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
      sideDialog: Boolean(document.querySelector('[aria-label="侧问内容"]')),
      queueRows: document.querySelectorAll('[aria-label="移除排队消息"]').length,
      text: document.body.innerText.slice(-1200),
    })`, returnByValue: true });
    const afterState = JSON.parse(after.result?.value || '{}');
    if (!afterState.composer || afterState.queueRows < 0 || !afterState.text.includes('主任务')) throw new Error('CDP interaction state inspection failed');
    const metrics = await cdp.sendCommand('Page.getLayoutMetrics');
    if (!metrics.cssVisualViewport || metrics.cssVisualViewport.clientWidth <= 0 || metrics.cssVisualViewport.clientHeight <= 0) throw new Error('CDP viewport metrics missing');
    console.log('SESSION_INTERACTION_CDP_PASSED: ' + JSON.stringify({ before: beforeState, after: { composer: afterState.composer, sideDialog: afterState.sideDialog, queueRows: afterState.queueRows }, viewport: metrics.cssVisualViewport, runtimeErrors: cdpErrors }));
    await win.webContents.executeJavaScript('window.closeSideWindow()');
    await win.webContents.executeJavaScript(`document.querySelector('button[aria-label^="上下文用量"]').click()`);
    const coords = await win.webContents.executeJavaScript(`(() => {
      const panel = document.querySelector('[role="dialog"]').getBoundingClientRect();
      if (Math.abs(panel.y + panel.height / 2 - innerHeight / 2) > 2) throw Error('Context details not centered');
      const {x, y} = document.querySelector('[data-session-composer-input]').getBoundingClientRect();
      return {x: x + 10, y: y + 8};
    })()`);
    if (process.env.MOSS_INTERACTIONS_EVIDENCE_DIR) {
      await fs.mkdir(process.env.MOSS_INTERACTIONS_EVIDENCE_DIR, { recursive: true });
      await fs.writeFile(path.join(process.env.MOSS_INTERACTIONS_EVIDENCE_DIR, 'context.png'), (await win.webContents.capturePage()).toPNG());
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.sendCommand('Input.dispatchMouseEvent', {type, ...coords, button: 'left', clickCount: 1});
    }
    await cdp.sendCommand('Input.insertText', {text: '继续输入'});
    const resumed = await win.webContents.executeJavaScript(`!document.querySelector('[role="dialog"]') && document.activeElement.value.includes('继续输入')`);
    if (!resumed) throw Error('Clicking the draft did not dismiss context and resume editing');
    console.log('CONTEXT_COMPOSER_FOCUS_PASSED');
    await win.webContents.executeJavaScript(`document.querySelector('.session-model')
      .dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))`);
    await new Promise(resolve => setTimeout(resolve, 120));
    const above = await win.webContents.executeJavaScript(`(() => {
      const menu = document.querySelector('[role="menu"][aria-label="选择模型"]');
      return menu && menu.getBoundingClientRect().bottom <= document.querySelector('.session-model').getBoundingClientRect().top + 1;
    })()`);
    if (!above) throw Error('Model options did not open above the model trigger');
    if (process.env.MOSS_INTERACTIONS_EVIDENCE_DIR) {
      await fs.writeFile(path.join(process.env.MOSS_INTERACTIONS_EVIDENCE_DIR, 'models.png'), (await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript(`[...document.querySelectorAll('[role="menuitemradio"]')]
      .find(item => item.textContent === 'alternative-model').click()`);
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const start = performance.now();
      const check = () => {
        if (!document.querySelector('[role="menuitemradio"]')) return resolve();
        if (performance.now() - start > 2500) return reject(Error('Model menu stayed open after selection'));
        setTimeout(check, 20);
      };
      check();
    })`);
    console.log('MODEL_MENU_POSITION_PASSED');
    for (const label of ['推理强度', '压缩会话']) {
      const point = await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('button[aria-label^="' + ${JSON.stringify(label)} + '"]');
        const bounds = button.getBoundingClientRect();
        return {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
      })()`);
      await cdp.sendCommand('Input.dispatchMouseEvent', {type: 'mouseMoved', ...point});
      await new Promise(resolve => setTimeout(resolve, 300));
      const tooltip = await win.webContents.executeJavaScript(`document.querySelector('[role="tooltip"]')?.textContent`);
      if (!tooltip?.includes(label)) throw Error(label + ' hover tooltip missing');
    }
    await cdp.sendCommand('Input.dispatchMouseEvent', {type: 'mouseMoved', x: 10, y: 10});

    if (process.env.MOSS_INTERACTIONS_EVIDENCE_DIR) {
      await win.webContents.executeJavaScript('window.openSideWindow()');
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
