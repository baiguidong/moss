// Run only through scripts/test-main-services.mjs, with a disposable MOSS_HOME.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import electron from 'electron';
import { createDesktopDataPaths } from '../../src/desktop-data-layout.mjs';

const root = process.env.MOSS_MAIN_SMOKE_ROOT;
assert.ok(root && root === process.env.MOSS_HOME, 'Smoke tests require an isolated MOSS_HOME');
assert.equal(await readFile(path.join(root, '.main-services-smoke'), 'utf8'), 'isolated smoke test');
const phase = process.env.MOSS_MAIN_SMOKE_PHASE;
assert.ok(['prepare', 'restart'].includes(phase));
const { app, ipcMain } = electron;
const handlers = new Map();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return handle(name, callback); };
let checked = false;
const timeout = setTimeout(() => { console.error('SMOKE_FAILED: Startup timed out'); app.exit(1); }, 45_000);
function fail(error) { console.error('SMOKE_FAILED:', error.stack || error); clearTimeout(timeout); app.exit(1); }
process.on('unhandledRejection', fail);
app.on('browser-window-created', (_event, window) => {
  window.show = () => {};
  window.showInactive = () => {};
  window.webContents.once('did-finish-load', async () => {
    if (checked) return;
    checked = true;
    try {
      const invoke = (name, payload) => handlers.get(name)({ sender: window.webContents }, payload);
      const statePath = path.join(root, '.smoke-state.json');
      if (phase === 'prepare') {
        const workspace = path.join(root, 'smoke-workspace');
        await mkdir(workspace, { recursive: true });
        const filePath = path.join(workspace, 'readme.txt');
        await writeFile(filePath, 'isolated smoke');
        const created = await invoke('agent:create-session', { workspace, title: 'Isolated smoke', agentMode: 'local' });
        const sessionId = created.summary.id;
        assert.equal((await invoke('workspace:read-file', { sessionId, filePath })).content, 'isolated smoke');
        const sent = await invoke('agent:send', { sessionId, prompt: '!printf moss-smoke', mode: 'chat' });
        assert.equal(sent.ok, true);
        assert.equal(sent.bash, true);
        assert.equal(sent.exitCode, 0);
        assert.ok(Array.isArray((await invoke('agent:list-background-tasks', { sessionId })).tasks));
        const project = await invoke('project:create', { name: 'Smoke project' });
        const projectId = project.id;
        await Promise.all([
          invoke('project:update', { projectId, updates: { name: 'Renamed project' } }),
          invoke('project:add-asset', { projectId, sourcePath: filePath }),
        ]);
        const interrupted = await invoke('agent:create-session', { workspace, title: 'Interrupted smoke', agentMode: 'local' });
        const recoveryId = interrupted.summary.id;
        const paths = createDesktopDataPaths(root);
        await mkdir(paths.sessionEngineDir(recoveryId), { recursive: true });
        await writeFile(paths.sessionTranscriptPath(recoveryId, 'smoke-engine'), [
          { type: 'user', uuid: 'smoke-user', message: { content: 'Recover this turn' } },
          { type: 'assistant', message: { content: [{ type: 'text', text: 'Recovered reply' }] } },
        ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
        const memory = await invoke('project:get-memory', { projectId });
        await writeFile(statePath, JSON.stringify({ sessionId, recoveryId, projectId, overview: memory.overview }));
        console.log('SMOKE_PASSED: prepare — local session, workspace file, direct command, task IPC, project update and asset import');
      } else {
        const { sessionId, recoveryId, projectId, overview } = JSON.parse(await readFile(statePath, 'utf8'));
        const sessions = await invoke('agent:list-sessions');
        assert.ok(sessions.some(session => session.id === sessionId));
        const session = await invoke('agent:get-session', { sessionId });
        assert.ok(JSON.stringify(session.history).includes('moss-smoke'));
        const recovered = await invoke('agent:get-session', { sessionId: recoveryId });
        assert.ok(JSON.stringify(recovered.history).includes('Recovered reply'));
        const paths = createDesktopDataPaths(root);
        const manifest = JSON.parse(await readFile(path.join(paths.sessionDir(recoveryId), 'session.json'), 'utf8'));
        assert.equal(manifest.underlyingSessionId, 'smoke-engine');
        assert.equal((await invoke('project:get', { projectId })).name, 'Renamed project');
        assert.equal((await invoke('project:list-assets', { projectId })).length, 1);
        assert.equal((await invoke('project:get-memory', { projectId })).overview, overview);
        await invoke('project:archive', { projectId });
        assert.equal((await invoke('project:list')).length, 0);
        console.log('SMOKE_PASSED: restart — persisted session, interrupted transcript recovery, project/asset/memory reads and archive');
      }
      clearTimeout(timeout);
      app.quit();
    } catch (error) { fail(error); }
  });
});
try { await import('../../src/main.mjs'); } catch (error) { fail(error); }
