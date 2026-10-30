const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises'), path = require('node:path');
const assert = require('node:assert/strict');
app.setPath('userData', process.env.MOSS_PRESENTATION_UI_TEMP);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1320, height: 940, webPreferences: { contextIsolation: false, nodeIntegration: false } });
  try {
    await win.loadURL(process.env.MOSS_PRESENTATION_UI_URL);
    const results = await win.webContents.executeJavaScript('window.runPresentationReview()');
    const evaluate = code => win.webContents.executeJavaScript(code);
    const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 80))');
    const bounds = () => evaluate('window.sessionPanelBounds()');
    let mousePressed = false;
    const mouse = async (type, x, y = 420) => {
      if (type === 'mouseDown') mousePressed = true;
      if (type === 'mouseUp') mousePressed = false;
      win.webContents.sendInputEvent({ type, x: Math.round(x), y, button: 'left', modifiers: mousePressed ? ['leftButtonDown'] : [], ...(type === 'mouseDown' || type === 'mouseUp' ? { clickCount: 1 } : {}) });
      await settle();
    };
    for (const [desktop, sidebarWidth, isMacOS] of [[true, 224, true], [true, 68, true], [true, 224, false], [false, 224, true]]) {
      await evaluate(`window.showSessionPanelExample(${desktop}, ${sidebarWidth}, ${isMacOS})`);
      let state = await bounds();
      await mouse('mouseMove', state.presentation.x);
      await mouse('mouseDown', state.presentation.x);
      await mouse('mouseMove', state.split.x + 400);
      state = await bounds();
      assert(state.presentation.width > 560 && !state.tabbed, 'Dragging is still capped at 560px');
      await mouse('mouseMove', state.split.x + 200);
      state = await bounds();
      assert(state.tabbed && state.conversation.width === 0 && state.presentation.width === state.split.width, `Dragging left did not snap the file to full width: ${JSON.stringify(state)}`);
      // Keep the pointer down and drag back over the iframe after the snap.
      await mouse('mouseMove', state.split.x + state.split.width - 440);
      state = await bounds();
      assert(!state.tabbed && state.presentation.width === 440, 'Pointer capture was lost over the preview or when switching layouts');
      await mouse('mouseMove', state.split.x + 200);
      await mouse('mouseUp', state.split.x + 200);
      assert.equal(await evaluate('document.body.classList.contains("layout-resizing")'), false);
      const tabBounds = await evaluate(`Array.from(document.querySelectorAll('[data-session-panel-tabs] button')).map(element => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))`);
      assert(tabBounds.every(rect => rect.left >= 0 && rect.right <= 1320), 'Top tabs overflow the window');
      await evaluate('window.reviewSessionPanelTabs()');
      // Window resizing should switch automatically without persisting full width.
      win.setSize(820, 940); await settle();
      state = await bounds();
      assert(state.tabbed, 'Narrow window left an unreadable conversation column');
      win.setSize(1320, 940); await settle();
      assert.equal((await bounds()).tabbed, false, 'Growing the window did not restore the split');
    }
    results.push('real pointer drag beyond 560px, snap to full-width tabs, reverse drag across iframe, preserved drafts/preview, restore split and window resizing on Mac/Windows/web');
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
      await evaluate('window.showSessionPanelExample()');
      const state = await bounds();
      await mouse('mouseDown', state.presentation.x);
      await mouse('mouseMove', state.split.x + 200);
      await mouse('mouseUp', state.split.x + 200);
      await fs.writeFile(path.join(output, 'session-panel-tabs.png'), (await win.webContents.capturePage()).toPNG());
      for (const [isMacOS, dark] of [[true, false], [true, true], [false, false]]) {
        await win.webContents.executeJavaScript(`window.showWindowToolbarExample(${isMacOS}, ${dark})`);
        await fs.writeFile(path.join(output, `window-toolbar-${isMacOS ? 'mac' : 'windows'}-${dark ? 'dark' : 'light'}.png`), (await win.webContents.capturePage()).toPNG());
      }
      win.setSize(520, 420);
      await win.webContents.executeJavaScript('window.showRetryExample()');
      await fs.writeFile(path.join(output, 'retry-status.png'), (await win.webContents.capturePage()).toPNG());
    }
    console.log('PRESENTATION_UI_PASSED: ' + JSON.stringify(results)); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
