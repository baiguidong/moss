import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import electron from 'electron';
import { createDesktopDataPaths } from '../../src/desktop-data-layout.mjs';
import { DEFAULT_PROJECT_ICON } from '../../../shared/project-icon.mjs';
const root = process.env.MOSS_PROJECT_CREATION_SMOKE_ROOT;
assert.ok(root && root === process.env.MOSS_HOME);
assert.equal(await readFile(path.join(root, '.smoke-marker'), 'utf8'), 'project creation isolated');
const phase = process.env.MOSS_PROJECT_CREATION_SMOKE_PHASE;
const { app, ipcMain } = electron;
app.setAppPath(fileURLToPath(new URL('../..', import.meta.url)));
const handlers = new Map();
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, callback) => { handlers.set(name, callback); return handle(name, callback); };
const timeout = setTimeout(() => { console.error('Project creation host timed out'); app.exit(1); }, 50_000);
const fail = error => { console.error(error); clearTimeout(timeout); app.exit(1); };
process.on('unhandledRejection', fail);
let checked = false;
const generatedIcon = { kind: 'generated', paths: ['M4 20 12 4l8 16Z'], color: 'violet' };
const manualIcon = { kind: 'builtin', name: 'book', color: 'blue' };
app.on('browser-window-created', (_event, window) => {
  window.show = () => {}; window.showInactive = () => {};
  window.webContents.once('did-finish-load', async () => {
    if (checked) return; checked = true;
    try {
      const invoke = (name, payload) => handlers.get(name)({ sender: window.webContents }, payload);
      const paths = createDesktopDataPaths(root);
      const statePath = path.join(root, '.creation-smoke-state.json');
      if (phase === 'prepare') {
        const skillDirectory = path.join(root, 'skills', 'project-fixture-skill');
        const expertDirectory = path.join(root, 'assistants', 'project-fixture-expert');
        await mkdir(skillDirectory, { recursive: true }); await mkdir(expertDirectory, { recursive: true });
        await writeFile(path.join(skillDirectory, 'SKILL.md'), '---\nname: project-fixture-skill\ndescription: Project fixture\n---\nUse this skill for fixture work.');
        await writeFile(path.join(expertDirectory, '_moss_meta.json'), JSON.stringify({ name: 'project-fixture-expert', display_name: '测试专家', enabled: true }));
        await writeFile(path.join(expertDirectory, 'assistant.md'), 'Use the project instructions and selected skills.');
        const session = await invoke('agent:create-session', { title: '创建项目', projectCreationMode: true, mode: 'boss' });
        assert.equal(session.summary.projectCreationMode, true); assert.equal(session.summary.composerIntent, 'chat');
        const ordinary = await invoke('agent:create-session', { title: '普通会话' });
        await assert.rejects(invoke('project-creation:get-draft', { sessionId: ordinary.summary.id }), /不可用/);
        // Seed the model's preview output; all subsequent work uses production IPC and stores.
        const seed = { id: randomUUID(), sessionId: session.summary.id, version: 1, status: 'awaiting_confirmation', project: { name: '项目草稿', instructions: '', mode: 'boss', permissionMode: 'default', workspaces: [], appServiceIds: [] }, resources: [], createdAt: Date.now(), updatedAt: Date.now() };
        seed.project.icon = generatedIcon;
        await mkdir(path.join(root, 'project-drafts'), { recursive: true });
        await writeFile(path.join(root, 'project-drafts', `${seed.id}.json`), JSON.stringify(seed));
        const draft = await invoke('project-creation:update-draft', { draftId: seed.id, version: seed.version, patch: { name: '通过会话创建', instructions: '始终使用中文输出', skillIds: ['project-fixture-skill'], expertIds: ['project-fixture-expert'], assistantName: 'project-fixture-expert' } });
        assert.equal(draft.resources.length, 2); assert.ok(draft.resources.every(resource => resource.installed));
        assert.deepEqual(draft.project.icon, generatedIcon);
        await assert.rejects(invoke('project-creation:confirm', { draftId: draft.id, version: 1 }), /发生变化/);
        const confirmations = await Promise.all([1, 2].map(() => invoke('project-creation:confirm', { draftId: draft.id, version: draft.version })));
        assert.equal(confirmations[0].status, 'completed'); assert.equal(confirmations[0].project.id, confirmations[1].project.id);
        const project = confirmations[0].project;
        assert.equal(project.creationDraftId, draft.id); assert.equal(project.resourceBindings.length, 2);
        assert.deepEqual(project.icon, generatedIcon);
        const manual = await invoke('project:create', { name: '手动创建图标项目', icon: manualIcon });
        assert.deepEqual(manual.icon, manualIcon);
        const defaulted = await invoke('project:update', { projectId: manual.id, updates: { icon: null } });
        assert.deepEqual(defaulted.icon, DEFAULT_PROJECT_ICON);
        await invoke('project:update', { projectId: manual.id, updates: { icon: manualIcon } });
        await assert.rejects(invoke('project:update', { projectId: manual.id, updates: { icon: { kind: 'generated', paths: ['<svg onload="alert(1)"/>'] } } }), /图标无效/);
        const projectSession = await invoke('agent:create-session', { projectId: project.id });
        assert.deepEqual(projectSession.summary.skillIds, ['project-fixture-skill']);
        assert.equal(projectSession.summary.assistantName, 'project-fixture-expert');
        const manifest = JSON.parse(await readFile(paths.sessionResourceManifestPath(projectSession.summary.id), 'utf8'));
        assert.equal(manifest.experts.length, 1); assert.equal(manifest.skills.length, 1); assert.equal(manifest.instructions, '始终使用中文输出');
        const pendingSession = await invoke('agent:create-session', { title: '待恢复方案', projectCreationMode: true });
        const pending = { ...seed, id: randomUUID(), sessionId: pendingSession.summary.id };
        await writeFile(path.join(root, 'project-drafts', `${pending.id}.json`), JSON.stringify(pending));
        await writeFile(statePath, JSON.stringify({ sessionId: session.summary.id, pendingSessionId: pendingSession.summary.id, projectSessionId: projectSession.summary.id, projectId: project.id, manualProjectId: manual.id, draftId: draft.id, version: draft.version }));
      } else {
        const state = JSON.parse(await readFile(statePath, 'utf8'));
        assert.equal((await invoke('agent:get-session', { sessionId: state.sessionId })).projectCreationMode, true);
        const pending = await invoke('project-creation:get-draft', { sessionId: state.pendingSessionId });
        assert.equal(pending.status, 'awaiting_confirmation');
        const result = await invoke('project-creation:confirm', { draftId: state.draftId, version: state.version });
        assert.equal(result.project.id, state.projectId); assert.equal((await invoke('project:list')).length, 2);
        const project = await invoke('project:get', { projectId: state.projectId });
        assert.equal(project.resourceBindings.length, 2);
        assert.deepEqual(project.icon, generatedIcon);
        assert.deepEqual((await invoke('project:get', { projectId: state.manualProjectId })).icon, manualIcon);
        const manifest = JSON.parse(await readFile(paths.sessionResourceManifestPath(state.projectSessionId), 'utf8'));
        assert.equal(manifest.skills.length, 1);
        const cancelled = await invoke('project-creation:cancel', { draftId: pending.id, version: pending.version });
        assert.equal(cancelled.draft.status, 'cancelled');
      }
      console.log(`PROJECT_CREATION_HOST_PASSED: ${phase}`);
      clearTimeout(timeout); app.quit();
    } catch (error) { fail(error); }
  });
});
try { await import('../../src/main.mjs'); } catch (error) { fail(error); }
