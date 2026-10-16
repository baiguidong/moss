// Regression: uninitialized WebContentsView targets used to prevent a fresh
// Playwright CDP connection after opening/closing blank browser panel tabs.
import assert from 'node:assert/strict';
import { app, BrowserWindow, WebContentsView } from 'electron';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(tmpdir(), 'moss-blank-cdp-'));
app.setPath('userData', home);
app.commandLine.appendSwitch('remote-debugging-port', '0');
const views = [];
let window, manager;
app.on('window-all-closed', () => {});
const watchdog = setTimeout(() => { console.error('Blank CDP test timed out'); app.exit(1); }, 15000);
void app.whenReady().then(async () => {
try {
  const { createBrowserViewManager } = await import(process.argv[3]
    ? pathToFileURL(path.resolve(process.argv[3])).href : '../src/browser-view-manager.mjs');
  window = new BrowserWindow({ show: false });
  await window.loadURL('data:text/html,<p>main-ready</p>');
  manager = createBrowserViewManager({
    createView: options => { const view = new WebContentsView(options); views.push(view); return view; },
    getWindow: () => window,
  });
  const state = manager.openTab({ sessionId: 'test' });
  assert.equal(state.tabs.length, 2);
  const port = (await readFile(path.join(home, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
  const start = Date.now();
  const code = `import assert from 'node:assert/strict';
    const {chromium} = await import(${JSON.stringify(pathToFileURL(path.resolve(process.argv[2])).href)});
    const browser = await chromium.connectOverCDP('http://127.0.0.1:${port}', {timeout:5000});
    try { const main = browser.contexts().flatMap(context=>context.pages()).find(page=>page.url().startsWith('data:'));
      assert.equal(await main.locator('p').innerText(), 'main-ready');
    } finally { await browser.close(); }`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 8000,
  });
  assert.ok(views.every(view => view.webContents.getURL() === 'about:blank'));
  console.log(`PASS: fresh CDP connected with two blank browser tabs in ${Date.now() - start} ms`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  manager?.disposeAll();
  clearTimeout(watchdog);
  if (process.exitCode) app.exit(process.exitCode);
  else app.quit();
}
}).catch(error => { console.error(error.message); app.exit(1); });
