// Run with Electron and an existing report.html argument. No model calls.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';
import { openAppFilePreview } from '../src/apps/app-file-preview.mjs';

const file = process.argv[2];
assert.ok(file?.endsWith('report.html'), 'Pass an existing HTML report');
const output = await mkdtemp(path.join(tmpdir(), 'moss-report-preview-'));
const timeout = setTimeout(() => { console.error('Report UI verification timed out'); app.exit(1); }, 30_000);
app.whenReady().then(async () => {
try {
  await openAppFilePreview(BrowserWindow, file);
  const window = BrowserWindow.getAllWindows()[0];
  const evaluate = expression => window.webContents.executeJavaScript(expression);
  await evaluate('Promise.all([...document.images].filter(image=>image.src).map(image=>{image.loading="eager";return image.decode().catch(()=>{});} ))');
  assert.equal(await evaluate('typeof window.agentDesktop'), 'undefined');
  assert.ok(await evaluate('document.querySelectorAll(".case").length > 0'));
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'));
  await writeFile(path.join(output, 'desktop.png'), (await window.webContents.capturePage()).toPNG());
  await evaluate('document.querySelector("[data-filter=failed]").click()');
  assert.ok(await evaluate('[...document.querySelectorAll(".case:not([hidden])")].every(card=>card.dataset.status === "failed")'));
  await evaluate('document.querySelector("[data-filter=all]").click(); document.getElementById("search").value="not-a-test-12345"; document.getElementById("search").dispatchEvent(new Event("input"))');
  assert.equal(await evaluate('document.querySelectorAll(".case:not([hidden])").length'), 0);
  await evaluate('document.getElementById("search").value=""; document.getElementById("search").dispatchEvent(new Event("input")); document.querySelector(".shot").click()');
  assert.equal(await evaluate('document.getElementById("viewer").open'), true);
  await evaluate('document.querySelector("#viewer button").click()');
  await evaluate('document.body.dataset.previousReport = "stale"');
  await openAppFilePreview(BrowserWindow, file);
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  assert.equal(await evaluate('document.body.dataset.previousReport'), undefined, 'Reopening must reload the latest saved report');
  window.setMinimumSize(320, 400); window.setContentSize(390, 844);
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.ok(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Mobile report must fit the viewport');
  await writeFile(path.join(output, 'mobile.png'), (await window.webContents.capturePage()).toPNG());
  console.log(`REPORT_UI_PASSED: desktop/mobile layout, filters, search, screenshot zoom, reusable sandboxed report window. ${output}`);
  clearTimeout(timeout);
  app.quit();
} catch (error) { console.error(error); app.exit(1); }
});
