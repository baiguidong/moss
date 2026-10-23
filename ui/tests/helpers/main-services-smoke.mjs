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
  if (process.env.MOSS_PROJECT_UI_SMOKE_DIR) window.webContents.setBackgroundThrottling(false);
  window.webContents.once('did-finish-load', async () => {
    if (checked) return;
    checked = true;
    try {
      const invoke = (name, payload) => handlers.get(name)({ sender: window.webContents }, payload);
      const statePath = path.join(root, '.smoke-state.json');
      if (process.env.MOSS_CONNECTOR_APP_SMOKE === '1') {
        const installed = await invoke('app:list');
        assert.deepEqual(installed, [], 'Startup must not install or migrate legacy Apps');
        assert.deepEqual((await invoke('connector-hub:get-installed')).data, [], 'Old connectors stay outside the App inventory');
        const legacy = JSON.parse(await readFile(path.join(root, 'connectors/installed/tencent-map/connector.json'), 'utf8'));
        assert.equal(legacy.appId, undefined, 'Old connector metadata must remain untouched');
        const { getConnectorMcpServers } = await import('../../src/connector-hub-ipc.mjs');
        assert.deepEqual(getConnectorMcpServers(['tencent-map']), {}, 'Uninstalled legacy tools must not execute');
        const source = await readFile(new URL('../../src/main.mjs', import.meta.url), 'utf8');
        assert.ok(!source.includes('combineAppMarketplaces('), 'Only the moss-apps marketplace supplies installs');
        console.log(`CONNECTOR_APP_SMOKE: ${phase} — empty inventory, no legacy migration, no old tools`);
      }

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
        const assistantDir = path.join(root, 'assistants', 'ProjectFixture');
        await mkdir(assistantDir, { recursive: true });
        await writeFile(path.join(assistantDir, '_moss_meta.json'), JSON.stringify({ name: 'ProjectFixture', display_name: '项目测试助手', enabled: true }));
        await writeFile(path.join(assistantDir, 'assistant.md'), 'Fixture assistant instructions.');
        const project = await invoke('project:create', { name: 'Smoke project', assistantName: 'ProjectFixture', expertIds: ['ProjectFixture'], permissionMode: 'acceptEdits' });
        const projectId = project.id;
        assert.equal(project.mode, 'boss');
        assert.equal(project.agentTeamsEnabled, true);
        assert.equal(project.workspaces.length, 1);
        const sharedOne = await invoke('agent:create-session', { projectId, title: 'Project one' });
        const sharedTwo = await invoke('agent:create-session', { projectId, title: 'Project two', assistant_name: '', mode: 'chat', permissionMode: 'plan', agentTeamsEnabled: false, skillIds: [] });
        assert.equal(sharedOne.summary.workspace, project.workspace);
        assert.equal(sharedTwo.summary.workspace, project.workspace);
        assert.equal(sharedOne.summary.composerIntent, 'boss');
        assert.equal(sharedTwo.summary.composerIntent, 'chat');
        assert.equal(sharedOne.summary.agentTeamsEnabled, true);
        assert.equal(sharedTwo.summary.agentTeamsEnabled, false);
        assert.equal(sharedOne.summary.assistantName, 'ProjectFixture');
        assert.equal(sharedTwo.summary.assistantName, null);
        const projectPaths = createDesktopDataPaths(root);
        const inheritedResources = JSON.parse(await readFile(projectPaths.sessionResourceManifestPath(sharedOne.summary.id), 'utf8'));
        const clearedResources = JSON.parse(await readFile(projectPaths.sessionResourceManifestPath(sharedTwo.summary.id), 'utf8'));
        assert.equal(inheritedResources.experts.length, 1);
        assert.deepEqual(clearedResources.experts, [], 'Clearing the assistant must remove its resource scope');
        await assert.rejects(invoke('project:update', { projectId, updates: { appServiceIds: ['["missing.app","service"]'] } }), /子服务/);
        await invoke('project:update', { projectId, updates: { mode: 'chat', permissionMode: 'plan', assistantName: '', expertIds: [], agentTeamsEnabled: false, instructions: 'Future sessions', workspaces: [project.workspace, workspace], defaultWorkspace: workspace } });
        const later = await invoke('agent:create-session', { projectId });
        assert.equal(later.summary.workspace, workspace);
        assert.equal(later.summary.composerIntent, 'chat');
        assert.equal(later.summary.agentTeamsEnabled, false);
        assert.equal(later.summary.assistantName, null);
        assert.equal(later.summary.permissionMode, 'plan');
        assert.equal((await invoke('agent:get-session', { sessionId: sharedOne.summary.id })).composerIntent, 'boss');
        assert.equal((await invoke('agent:get-session', { sessionId: sharedOne.summary.id })).permissionMode, 'acceptEdits');
        const empty = await invoke('project:create', { name: 'Empty maintenance' });
        await invoke('project:organize-memory', { projectId: empty.id });
        await new Promise(resolve => setTimeout(resolve, 100));
        assert.notEqual((await invoke('project:get-memory', { projectId: empty.id })).maintenance.phase, 'running');
        await invoke('project:archive', { projectId: empty.id });

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
        await writeFile(statePath, JSON.stringify({ sessionId, recoveryId, projectId, projectSessionId: sharedOne.summary.id, overrideSessionId: sharedTwo.summary.id, overview: memory.overview }));
        if (process.env.MOSS_PROJECT_UI_SMOKE_DIR) {
          const screenshotDir = process.env.MOSS_PROJECT_UI_SMOKE_DIR;
          await mkdir(screenshotDir, { recursive: true });
          window.setSize(1360, 900);
          const ui = script => window.webContents.executeJavaScript(`(async () => {
            const waitFor = async predicate => { for (let i = 0; i < 100; i++) { const result = predicate(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 50)); } throw new Error('Project UI not ready: ' + document.body.innerText.slice(0, 1200)); };
            const button = text => [...document.querySelectorAll('button')].find(item => item.textContent.trim() === text);
            ${script}
          })()`);
          await writeFile(path.join(screenshotDir, 'startup.png'), (await window.webContents.capturePage()).toPNG());
          await new Promise(resolve => setTimeout(resolve, 600));
          await ui(`(await waitFor(() => document.querySelector('button[title="项目"]'))).click();
            (await waitFor(() => document.querySelector('button[aria-label=\"打开项目：Renamed project\"]'))).click();
            await waitFor(() => button('整理项目'));`);
          await writeFile(path.join(screenshotDir, 'overview.png'), (await window.webContents.capturePage()).toPNG());
          await ui(`document.querySelector('button[aria-label="在右侧展开项目配置"]').click(); await waitFor(() => document.body.innerText.includes('Agent Teams 智能体团队'));`);
          await writeFile(path.join(screenshotDir, 'settings.png'), (await window.webContents.capturePage()).toPNG());
          await ui(`button('会话').click(); (await waitFor(() => document.querySelector('section[aria-label=\"发起项目会话\"] button'))).click(); await waitFor(() => document.querySelector('select[aria-label="项目工作目录"]'));`);
          assert.equal(await ui(`return document.querySelector('select[aria-label="项目工作目录"]').value;`), workspace);
          assert.equal(await ui(`return document.body.innerText.includes('项目 / Renamed project');`), true);
          await writeFile(path.join(screenshotDir, 'composer.png'), (await window.webContents.capturePage()).toPNG());
        }
        console.log('SMOKE_PASSED: prepare — local session, workspace file, direct command, task IPC, project update and asset import');
      } else {
        const { sessionId, recoveryId, projectId, projectSessionId, overrideSessionId, overview } = JSON.parse(await readFile(statePath, 'utf8'));
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
        assert.equal((await invoke('agent:get-session', { sessionId: projectSessionId })).composerIntent, 'boss');
        assert.equal((await invoke('agent:get-session', { sessionId: projectSessionId })).agentTeamsEnabled, true);
        assert.equal((await invoke('agent:get-session', { sessionId: projectSessionId })).assistantName, 'ProjectFixture');
        assert.equal((await invoke('agent:get-session', { sessionId: projectSessionId })).permissionMode, 'acceptEdits');
        assert.equal((await invoke('agent:get-session', { sessionId: overrideSessionId })).composerIntent, 'chat');
        assert.equal((await invoke('agent:get-session', { sessionId: overrideSessionId })).agentTeamsEnabled, false);
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
try {
  if (process.env.MOSS_CONNECTOR_APP_SMOKE === '1' && phase === 'prepare') {
    const hub = await import('../../src/connector-hub-ipc.mjs');
    await hub.initializeBundledConnectorCatalog({ bundledCatalogPath: new URL('../fixtures/connector-catalog/workbuddy-connectors-config.zip', import.meta.url).pathname });
    await hub.installConnector('tencent-map');
  }
  await import('../../src/main.mjs');
} catch (error) { fail(error); }
