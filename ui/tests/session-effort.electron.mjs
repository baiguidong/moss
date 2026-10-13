// Run from ui: env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron tests/session-effort.electron.mjs
import { app, BrowserWindow } from 'electron';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-effort-ui-'));
app.setPath('userData', path.join(temp, 'profile'));
app.on('window-all-closed', () => {});
let server, win;
const watchdog = setTimeout(() => app.exit(1), 60_000);
const wait = () => new Promise(resolve => setTimeout(resolve, 100));
app.whenReady().then(async () => {
  try {
    server = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), cacheDir: path.join(temp, 'vite'), server: { host: '127.0.0.1', port: 0, hmr: false } });
    await server.listen();
    win = new BrowserWindow({ show: false, width: 850, height: 650 });
    const evaluate = code => win.webContents.executeJavaScript(code);
    win.webContents.on('console-message', event => { if (event.level === 'error') console.error(event.message); });
    await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/session-effort.html`);
    for (let i = 0; i < 100 && !await evaluate("Boolean(document.querySelector('[aria-label=\"推理强度：Extra High\"]'))"); i++) await wait();
    await evaluate("document.querySelector('[aria-label=\"推理强度：Extra High\"]').click()");
    for (let i = 0; i < 50 && !await evaluate("Boolean(document.querySelector('[role=slider]'))"); i++) await wait();
    assert.equal(await evaluate("document.querySelector('[role=slider]').getAttribute('aria-valuetext')"), 'Extra High');
    await fs.writeFile('/tmp/moss-effort-selector.png', (await win.webContents.capturePage()).toPNG());
    await evaluate("document.querySelector('[role=slider]').focus()");
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Home' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Home' });
    await wait();
    assert.deepEqual(await evaluate('window.writes.at(-1)'), { sessionId: 'a', effort: 'low' });
    await evaluate("document.querySelector('[aria-label=\"恢复模型默认推理强度\"]').click()"); await wait();
    assert.deepEqual(await evaluate('window.writes.at(-1)'), { sessionId: 'a', effort: null });
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); await wait();
    await evaluate("document.querySelector('[data-switch]').click()"); await wait();
    assert(await evaluate("Boolean(document.querySelector('[aria-label=\"推理强度：Auto\"]'))"));
    assert.equal(await evaluate("document.querySelector('textarea').value"), '');
    await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === '立即整理记忆').click()"); await wait();
    assert(await evaluate("document.body.textContent.includes('长期记忆整理完成。')"));
    console.log('PASS slider, reset, session isolation, no chat command and global Dream control; screenshot /tmp/moss-effort-selector.png');
  } catch (error) {
    console.error(error);
    if (win) await fs.writeFile('/tmp/moss-effort-ui-failure.png', (await win.webContents.capturePage()).toPNG());
    process.exitCode = 1;
  } finally {
    win?.destroy(); await server?.close(); clearTimeout(watchdog); await fs.rm(temp, { recursive: true, force: true }); app.exit(process.exitCode || 0);
  }
});
