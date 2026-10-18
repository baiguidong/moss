// Browser regression for the real Radix selector and native HTML confirmation.
// Uses an isolated renderer harness; no user settings or model calls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const harness = await fs.mkdtemp(path.join(uiRoot, 'tests', '.web-permissions-'));
let vite, browser;
try {
  await fs.writeFile(path.join(harness, 'index.html'), '<html><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>');
  await fs.writeFile(path.join(harness, 'main.tsx'), `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { PermissionModeSelector } from '@/components/permission-mode-selector';
    import { BrowserPanel } from '@/components/browser-panel';
    import { UpdateModal } from '@/components/update-modal';
    import '@/globals.css';
    window.mossWeb = {};
    window.permissionChanges = [];
    window.nativeCalls = [];
    window.agentDesktop = {
      ipcOn: () => () => {}, ipcOff: () => {},
      browser: new Proxy({}, { get: (_, name) => () => { window.nativeCalls.push(name); throw Error('Native browser called'); } }),
      update: new Proxy({}, { get: (_, name) => () => { window.nativeCalls.push(name); throw Error('Native updater called'); } }),
    };
    function Harness() {
      const [value, setValue] = React.useState('default');
      const [disabled, setDisabled] = React.useState(false);
      const [sessionId, setSession] = React.useState('one');
      window.permissionHarness = { setValue, setDisabled, setSession };
      return <main className="p-8">
        <PermissionModeSelector key={sessionId} value={value} disabled={disabled} onChange={mode => { window.permissionChanges.push({ sessionId, mode }); setValue(mode); }} />
        <BrowserPanel sessionId={sessionId} />
        <UpdateModal />
      </main>;
    }
    createRoot(document.getElementById('root')).render(<Harness />);
  `);
  vite = await createServer({ root: uiRoot, configFile: path.join(uiRoot, 'vite.config.ts'), logLevel: 'error',
    server: { port: 0, strictPort: false, hmr: false } });
  await vite.listen();
  browser = await chromium.launch({ channel: process.env.MOSS_WEB_TEST_BROWSER || 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${vite.httpServer.address().port}/tests/${path.basename(harness)}/index.html`);
  const modal = page.getByRole('dialog', { name: '启用完全放行？' });
  const open = async () => {
    await page.getByTitle('选择权限模式', { exact: true }).click();
    await page.getByRole('menuitemradio', { name: /完全放行/ }).click();
    await modal.waitFor({ state: 'visible' });
  };
  const unchanged = async () => assert.deepEqual(await page.evaluate(() => window.permissionChanges), []);
  await open();
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), '取消');
  await page.keyboard.press('Enter');
  await modal.waitFor({ state: 'hidden' }); await unchanged();
  await open();
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' }); await unchanged();
  await open();
  await modal.getByRole('button', { name: '取消', exact: true }).click();
  await modal.waitFor({ state: 'hidden' }); await unchanged();
  await open();
  await page.evaluate(() => window.permissionHarness.setSession('two'));
  await modal.waitFor({ state: 'hidden' }); await unchanged();
  await open();
  await page.evaluate(() => window.permissionHarness.setDisabled(true));
  await modal.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.permissionHarness.setDisabled(false));
  await page.getByTitle('选择权限模式', { exact: true }).waitFor();
  assert.equal(await modal.isVisible(), false); await unchanged();
  await open();
  await page.evaluate(() => window.permissionHarness.setValue('acceptEdits'));
  await modal.waitFor({ state: 'hidden' }); await unchanged();
  await open();
  if (process.env.MOSS_WEB_TEST_OUTPUT) {
    await fs.mkdir(process.env.MOSS_WEB_TEST_OUTPUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.MOSS_WEB_TEST_OUTPUT, 'permission-confirmation.png') });
  }
  await modal.getByRole('button', { name: '确定启用', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.permissionChanges), [{ sessionId: 'two', mode: 'bypassPermissions' }]);
  assert.deepEqual(await page.evaluate(() => window.nativeCalls), []);
  assert.deepEqual(errors, []);
  console.log('Web permission dialog: cancellation, Escape, default focus, session change, disabled/value invalidation and explicit approval passed. Native browser/updater were not invoked.');
} finally {
  await browser?.close();
  await vite?.close();
  await fs.rm(harness, { recursive: true, force: true });
}
