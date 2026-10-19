// Disposable desktop test. No model calls, user data or external pages.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';

const root = process.env.MOSS_PRESENTATION_SMOKE_ROOT;
assert.ok(root && root === process.env.MOSS_HOME);
assert.equal(await readFile(path.join(root, '.presentation-smoke'), 'utf8'), 'isolated');
const { app, ipcMain } = electron, handlers = new Map();
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return originalHandle(name, callback); };
const windows = [];
const waitFor = async (read, message) => {
  const end = Date.now() + 10000;
  while (Date.now() < end) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 60)); }
  throw new Error(message);
};
const run = (window, fn, ...args) => window.webContents.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
let tested = false;
const timeout = setTimeout(() => { console.error('PRESENTATION_FAILED: timeout'); app.exit(1); }, 50000);
const fail = error => { console.error('PRESENTATION_FAILED:', error.stack || error); clearTimeout(timeout); app.exit(1); };
process.on('unhandledRejection', fail);
app.on('browser-window-created', (_event, window) => {
  windows.push(window); window.show = () => {}; window.showInactive = () => {};
  window.webContents.once('did-finish-load', async () => {
    if (tested) return; tested = true;
    try {
      const invoke = (name, payload, sender = window.webContents) => handlers.get(name)({ sender }, payload);
      const workspace = path.join(root, 'workspace'); await mkdir(workspace);
      const filePath = path.join(workspace, 'report.md'); await writeFile(filePath, '# Preview smoke\nOriginal content\n');
      const created = await invoke('agent:create-session', { workspace, title: 'Presentation smoke', agentMode: 'local' });
      const sessionId = created.summary.id;
      const tasksDir = path.join(root, 'tasks', sessionId); await mkdir(tasksDir, { recursive: true });
      await writeFile(path.join(tasksDir, '1.json'), JSON.stringify({ id: '1', subject: 'Preview regression', description: '', status: 'in_progress', blockedBy: [] }));
      await invoke('agent:list-session-tasks', { sessionId });
      await waitFor(() => run(window, () => { const title = [...document.querySelectorAll('span')].find(el => el.textContent === 'Presentation smoke'); if (title) { title.click(); return true; } return false; }), 'Session is missing from sidebar');
      await waitFor(() => run(window, () => Boolean(document.querySelector('[aria-label="内容导航"]'))), 'Right panel did not mount');
      await waitFor(() => run(window, () => document.querySelectorAll('[aria-label="会话任务"]').length === 1), 'Session task list did not mount');
      assert.equal(await run(window, () => document.querySelector('[aria-label="会话任务"]').getBoundingClientRect().bottom <= document.querySelector('[aria-label="内容导航"]').getBoundingClientRect().top), true);
      await invoke('presentation:snapshot', { sessionId, activate: true });
      const result = await invoke('presentation:open', { sessionId, input: { items: [{ path: filePath }] } });
      assert.equal(result.ok, true);
      await waitFor(() => run(window, () => document.body.innerText.includes('Preview smoke')), 'Markdown did not render');
      if (process.env.MOSS_PRESENTATION_SMOKE_OUTPUT) { await mkdir(process.env.MOSS_PRESENTATION_SMOKE_OUTPUT, { recursive: true }); await writeFile(path.join(process.env.MOSS_PRESENTATION_SMOKE_OUTPUT, 'right-preview.png'), (await window.webContents.capturePage()).toPNG()); }
      await waitFor(() => run(window, () => { const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === '编辑' && !el.disabled); if (button) { button.click(); return true; } return false; }), 'Editable preview not ready');
      const draft = '# Preview smoke\nUnsaved handoff\n';
      await run(window, value => {
        const textarea = [...document.querySelectorAll('textarea')].find(el => el.value.includes('Original content'));
        if (!textarea) throw new Error('Editor missing');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }, draft);
      await waitFor(async () => (await invoke('presentation:snapshot', { sessionId })).state.dirty, 'Draft was not registered');
      await invoke('presentation:popout', { sessionId, artifactId: result.items[0].artifact_id });
      const preview = await waitFor(() => windows.find(item => item !== window && !item.isDestroyed()), 'Preview window not created');
      await waitFor(() => run(preview, () => document.body.innerText.includes('Unsaved handoff')).catch(() => false), 'Popout lost unsaved content');
      await waitFor(() => run(preview, () => { const button = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === '保存' && !el.disabled); if (button) { button.click(); return true; } return false; }), 'Popout save is unavailable');
      await waitFor(async () => await readFile(filePath, 'utf8') === draft, 'Popout did not save the transferred draft');
      if (process.env.MOSS_PRESENTATION_SMOKE_OUTPUT) { await mkdir(process.env.MOSS_PRESENTATION_SMOKE_OUTPUT, { recursive: true }); await writeFile(path.join(process.env.MOSS_PRESENTATION_SMOKE_OUTPUT, 'editor-handoff.png'), (await preview.webContents.capturePage()).toPNG()); }
      await invoke('presentation:action', { sessionId, action: { type: 'select', id: 'workspace' } });
      await waitFor(() => run(window, () => document.body.innerText.includes('工作区版本') || document.body.innerText.includes('版本')), 'Workspace versions entry lost');
      await invoke('presentation:open', { sessionId, input: { items: [{ path: workspace }] } });
      await waitFor(() => run(window, () => Boolean(document.querySelector('[data-directory-entry]'))), 'Directory renderer is missing');
      if (process.env.MOSS_PRESENTATION_SMOKE_OUTPUT) {
        await mkdir(process.env.MOSS_PRESENTATION_SMOKE_OUTPUT, { recursive: true });
        await writeFile(path.join(process.env.MOSS_PRESENTATION_SMOKE_OUTPUT, 'desktop.png'), (await window.webContents.capturePage()).toPNG());
      }
      console.log('PRESENTATION_PASSED: actual desktop file preview, editor, dirty draft handoff, popout save, workspace versions and directory navigation');
      clearTimeout(timeout); app.exit(0);
    } catch (error) { console.error(await run(window, () => document.body.innerText.slice(-4000)).catch(() => '')); fail(error); }
  });
});
try { await import('../../src/main.mjs'); } catch (error) { fail(error); }
