// Explicit, local smoke test. Uses an isolated profile and the real bundled Cua
// adapter. The permission button is exercised only when grants already exist.
// It never changes the user's Moss settings.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';

const root = process.env.MOSS_CUA_SMOKE_ROOT;
assert.ok(root && root === process.env.MOSS_HOME);
assert.equal(await fs.readFile(path.join(root, '.computer-use-smoke'), 'utf8'), 'isolated');
const { app, ipcMain } = electron;
const handlers = new Map();
const original = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, handler) => { handlers.set(name, handler); return original(name, handler); };
let checked = false;
const timeout = setTimeout(() => app.exit(2), 55000);
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {};
  window.webContents.once('did-finish-load', async () => {
    if (checked) return; checked = true;
    try {
      const invoke = (name, payload) => handlers.get(name)({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, payload);
      assert.equal((await invoke('computer-use:status')).enabled, false);
      const enabled = await invoke('computer-use:enable', { enabled: true });
      assert.equal(enabled.enabled, true);
      await fs.writeFile(path.join(root, 'native-status.json'), JSON.stringify(enabled, null, 2));
      assert.equal(enabled.permissions?.hostIdentity, true, enabled.error);
      if (enabled.permissions.accessibility && enabled.permissions.screenRecording) assert.equal(enabled.phase, 'ready');
      else console.log('CUA_REQUIRES_USER_GRANTS: UI and host startup passed; actual control awaits macOS grants');
      assert.equal(handlers.has('computer-use:self-test'), false);
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '设置')?.click()`);
      await new Promise(resolve => setTimeout(resolve, 300));
      await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '工具')?.click()`);
      await new Promise(resolve => setTimeout(resolve, 300));
      const rendered = await window.webContents.executeJavaScript(`({text:document.body.innerText, button:!!document.querySelector('[aria-label="开启电脑操控"]')})`);
      assert.equal(rendered.button, true, rendered.text.slice(-2500));
      assert.ok(rendered.text.includes('computer_use'));
      for (const removed of ['用计算器检查连接', '截图自检', 'Electron（开发模式）', 'Moss 会读取并操作你允许的应用']) assert.ok(!rendered.text.includes(removed));
      assert.equal(await window.webContents.executeJavaScript(`!!document.getElementById('computer-use')`), false);
      assert.ok(await window.webContents.executeJavaScript(`['系统权限', '已允许的应用'].every(text => document.getElementById('app-control-settings')?.innerText.includes(text))`));
      assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="computer_use 常驻"]')?.checked`));
      if (enabled.permissions.accessibility && enabled.permissions.screenRecording) {
        await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '发起系统授权')?.click()`);
        let notice = false;
        for (let i = 0; i < 100; i++) {
          notice = await window.webContents.executeJavaScript(`document.body.innerText.includes('两项系统权限均已开启')`);
          if (notice) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert.equal(notice, true, 'Permission button must show explicit already-granted feedback');
        console.log('CUA_PERMISSION_BUTTON_PASSED: visible feedback without development or self-test instructions');
      }
      await window.webContents.executeJavaScript(`document.getElementById('app-control-settings')?.scrollIntoView()`);
      await new Promise(resolve => setTimeout(resolve, 250));
      await fs.writeFile(path.join(root, 'settings.png'), (await window.webContents.capturePage()).toPNG());
      await window.webContents.executeJavaScript(`document.querySelector('[aria-label="computer_use 常驻"]')?.closest('tr')?.scrollIntoView({block:'center'})`);
      await new Promise(resolve => setTimeout(resolve, 200));
      await fs.writeFile(path.join(root, 'built-in-tools.png'), (await window.webContents.capturePage()).toPNG());
      const disabled = await invoke('computer-use:enable', { enabled: false });
      assert.equal(disabled.enabled, false); assert.equal(disabled.active, null);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="computer_use 关闭"]')?.checked`));
      console.log('CUA_UI_PASSED: settings, enable/disable, isolated native host');
      clearTimeout(timeout); app.quit();
    } catch (error) { console.error('CUA_SMOKE_FAILED:', error); clearTimeout(timeout); app.exit(1); }
  });
});
await import('../../src/main.mjs');
