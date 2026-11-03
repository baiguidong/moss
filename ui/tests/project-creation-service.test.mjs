import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProjectCreationService, normalizeCreationPlan } from '../src/project-creation-service.mjs';
import { createProjectCreationResources } from '../src/project-creation-resources.mjs';
import { resolveProjectSessionDefaults } from '../src/shared/project-session-defaults.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'moss-project-creation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const local = new Map(), market = new Map(), projects = new Map();
  const installs = [], events = [];
  const state = { authorized: false, createCalls: 0, failInstall: '', failAfterWrite: false, validSession: true };
  const resource = (kind, id, extras = {}) => ({ kind, id, displayName: id, version: '1.0.0', ...extras });
  const add = (kind, id, extras = {}) => { market.set(`${kind}:${id}`, resource(kind, id, extras)); };
  const resources = createProjectCreationResources({
    installed: async kind => [...local.values()].filter(entry => entry.kind === kind),
    search: async (kind, query, limit) => [...market.values()].filter(entry => entry.kind === kind && entry.id.includes(query)).slice(0, limit),
    detail: async (kind, id) => market.get(`${kind}:${id}`),
    install: async (kind, entry) => {
      installs.push(entry.id);
      if (state.failInstall === entry.id) throw new Error('download unavailable');
      if (state.waitInstall) await state.waitInstall;
      local.set(`${kind}:${entry.id}`, { ...entry });
      return { ok: true };
    },
    validateApp: async (entry, ids) => {
      if (!state.authorized) throw new Error('请连接 App');
      if (entry.toolSelection === 'services' && ids.some(id => !entry.services?.some(service => service.id === id))) throw new Error('服务不存在');
    },
  });
  const options = { directory, resources, assertSession: id => { assert.equal(id, 'creation-session'); if (!state.validSession) throw new Error('session deleted'); },
    readProject: async id => projects.get(id) || null,
    createProject: async (input, internal) => {
      state.createCalls++;
      const project = { ...input, id: internal.id };
      projects.set(project.id, project);
      if (state.failAfterWrite) throw new Error('interrupted after project write');
      return project;
    },
    emit: draft => events.push(draft),
  };
  let service = createProjectCreationService(options);
  return { directory, state, installs, local, market, projects, events, add, resources,
    get service() { return service; }, restart: () => { service = createProjectCreationService(options); },
    propose: input => service.propose({ name: '用户研究', ...input }, 'creation-session'),
    confirm: draft => service.confirm({ draftId: draft.id, version: draft.version }),
  };
}

test('preview never installs; confirmation creates with resources inherited by new project sessions', async t => {
  const f = await fixture(t); f.add('skill', 'research'); f.add('expert', 'analyst', { runtimeId: 'runtime-analyst' });
  const draft = await f.propose({ skillIds: ['research'], expertIds: ['analyst'], assistantName: 'analyst', instructions: '中文输出', workspaces: ['/tmp'], mode: 'chat' });
  assert.equal(f.installs.length, 0); assert.equal(f.projects.size, 0);
  const result = await f.confirm(draft);
  assert.equal(result.status, 'completed'); assert.equal(Object.hasOwn(result.draft, 'firstTaskSessionId'), false);
  const defaults = resolveProjectSessionDefaults(result.project, {}, {}, '/tmp');
  assert.deepEqual(defaults.skillIds, ['research']); assert.equal(defaults.assistant_name, 'runtime-analyst');
  assert.equal(defaults.projectDefaults.instructions, '中文输出'); assert.equal(defaults.mode, 'chat');
});

test('concurrent and repeated confirmations create and launch only once', async t => {
  const f = await fixture(t); f.add('skill', 'research');
  const draft = await f.propose({ skillIds: ['research'] });
  const results = await Promise.all([f.confirm(draft), f.confirm(draft), f.confirm(draft)]);
  assert.equal(new Set(results.map(result => result.project.id)).size, 1);
  assert.equal(f.state.createCalls, 1); assert.deepEqual(f.installs, ['research']);
});

test('edited configuration invalidates old confirmation and old model revision', async t => {
  const f = await fixture(t); const draft = await f.propose({});
  const next = await f.service.update({ draftId: draft.id, version: draft.version, patch: { name: '新名称', workspace: '/tmp' } });
  await assert.rejects(f.confirm(draft), /发生变化/);
  await assert.rejects(f.propose({ version: draft.version }), /版本已变化/);
  const result = await f.confirm(next);
  assert.equal(result.project.name, '新名称'); assert.equal(result.project.defaultWorkspace, '/tmp');
  assert.deepEqual(result.project.workspaces, ['/tmp']);
});

test('generated icons stay in the draft until confirmation and icon edits require reconfirmation', async t => {
  const f = await fixture(t);
  const icon = { kind: 'generated', paths: ['M4 20 12 4l8 16Z'], color: 'violet' };
  const draft = await f.propose({ icon });
  assert.deepEqual(draft.project.icon, icon);
  assert.equal(f.projects.size, 0);
  f.restart();
  const restored = await f.service.get({ sessionId: 'creation-session' });
  assert.deepEqual(restored.project.icon, icon);
  const renamed = await f.service.update({ draftId: draft.id, version: draft.version, patch: { name: '新方案' } });
  assert.deepEqual(renamed.project.icon, icon);
  const editedIcon = { kind: 'builtin', name: 'search', color: 'blue' };
  const edited = await f.service.update({ draftId: draft.id, version: renamed.version, patch: { icon: editedIcon } });
  await assert.rejects(f.confirm(renamed), /发生变化/);
  assert.equal(f.projects.size, 0);
  assert.deepEqual((await f.confirm(edited)).project.icon, editedIcon);
});

test('confirmation creates the exact generated icon; invalid proposals do not overwrite the draft', async t => {
  const f = await fixture(t);
  const icon = { kind: 'generated', paths: ['M3 12h18M12 3v18'], color: 'teal' };
  const draft = await f.propose({ icon });
  await assert.rejects(f.service.update({ draftId: draft.id, version: draft.version, patch: { icon: { kind: 'generated', paths: ['<svg/>'] } } }), /图标无效/);
  assert.deepEqual((await f.confirm(draft)).project.icon, icon);
});

test('partial installation failure leaves no project and retries only unfinished resources after restart', async t => {
  const f = await fixture(t); f.add('skill', 'one'); f.add('skill', 'two');
  f.state.failInstall = 'two';
  const draft = await f.propose({ skillIds: ['one', 'two'] });
  const failed = await f.confirm(draft);
  assert.equal(failed.status, 'failed'); assert.equal(f.projects.size, 0);
  f.restart(); f.state.failInstall = '';
  const recovered = await f.service.get({ sessionId: 'creation-session' });
  assert.equal(recovered.resources[0].status, 'installed');
  const completed = await f.confirm(recovered);
  assert.equal(completed.status, 'completed'); assert.deepEqual(f.installs, ['one', 'two', 'two']);
});

test('lost response after project write recovers reserved project identity', async t => {
  const f = await fixture(t); f.state.failAfterWrite = true;
  const draft = await f.propose({});
  assert.equal((await f.confirm(draft)).status, 'failed');
  f.restart();
  const result = await f.confirm(draft);
  assert.equal(result.status, 'completed'); assert.equal(result.draft.error, null); assert.equal(f.state.createCalls, 1);
});

test('App authorization pauses creation and resumes without reinstalling', async t => {
  const f = await fixture(t); f.add('app', 'mail');
  const draft = await f.propose({ appIds: ['mail'] });
  const waiting = await f.confirm(draft);
  assert.equal(waiting.status, 'awaiting_authorization'); assert.equal(waiting.draft.pendingActions[0].appId, 'mail');
  assert.equal(f.projects.size, 0);
  f.restart(); f.state.authorized = true;
  const result = await f.confirm(draft);
  assert.equal(result.status, 'completed'); assert.deepEqual(result.project.appIds, ['mail']); assert.deepEqual(f.installs, ['mail']);
});

test('service Apps require an explicit service selection and never grant all services', async t => {
  const f = await fixture(t); f.state.authorized = true;
  const first = JSON.stringify(['docs', 'read']), second = JSON.stringify(['docs', 'write']);
  f.add('app', 'docs', { toolSelection: 'services', services: [{ id: first, title: 'Read' }, { id: second, title: 'Write' }] });
  const draft = await f.propose({ appIds: ['docs'] });
  assert.equal((await f.confirm(draft)).status, 'awaiting_authorization');
  const edited = await f.service.update({ draftId: draft.id, version: draft.version, patch: { appServiceIds: [first] } });
  const { project } = await f.confirm(edited);
  assert.deepEqual(project.appIds, []); assert.deepEqual(project.appServiceIds, [first]);
  assert.deepEqual(resolveProjectSessionDefaults(project, {}, {}, '/tmp').appServiceIds, [first]);
});

test('cancel is durable and requires a new preview before confirmation', async t => {
  const f = await fixture(t); const draft = await f.propose({});
  const { draft: cancelled } = await f.service.cancel({ draftId: draft.id, version: draft.version });
  f.restart();
  await assert.rejects(f.confirm(cancelled), /取消/);
  const revised = await f.propose({ version: cancelled.version, name: '恢复方案' });
  assert.equal(revised.id, draft.id); assert.equal((await f.confirm(revised)).status, 'completed');
});

test('in-progress confirmation rejects editing and cancellation', async t => {
  const f = await fixture(t); f.add('skill', 'slow');
  let release; f.state.waitInstall = new Promise(resolve => { release = resolve; });
  const draft = await f.propose({ skillIds: ['slow'] });
  const confirmation = f.confirm(draft);
  await assert.rejects(f.service.update({ draftId: draft.id, version: draft.version, patch: { name: 'edit' } }), /正在创建/);
  await assert.rejects(f.service.cancel({ draftId: draft.id, version: draft.version }), /正在创建/);
  release(); assert.equal((await confirmation).status, 'completed');
});

test('resource version changes require a fresh review before installation', async t => {
  const f = await fixture(t); f.add('skill', 'research');
  const draft = await f.propose({ skillIds: ['research'] });
  f.add('skill', 'research', { version: '2.0.0' });
  const result = await f.confirm(draft);
  assert.equal(result.status, 'awaiting_confirmation'); assert.equal(result.draft.version, 2);
  assert.equal(f.installs.length, 0); await assert.rejects(f.confirm(draft), /发生变化/);
  assert.equal((await f.confirm(result.draft)).status, 'completed');
});

test('repeated confirmation does not duplicate a created project', async t => {
  const f = await fixture(t);
  const draft = await f.propose({});
  const result = await f.confirm(draft);
  assert.equal(result.status, 'completed');
  f.restart(); await f.confirm(draft);
  assert.equal(f.state.createCalls, 1);
});

test('deleted creation sessions cannot install or create', async t => {
  const f = await fixture(t); const draft = await f.propose({}); f.state.validSession = false;
  await assert.rejects(f.confirm(draft), /session deleted/); assert.equal(f.projects.size, 0);
});

test('installed builtin/custom experts are discovered by exact identity', async t => {
  const f = await fixture(t);
  f.local.set('expert:builtin', { kind: 'expert', id: 'builtin', displayName: 'Builtin Expert', isBuiltin: true });
  const result = await f.resources.discover({ action: 'list_installed', kind: 'expert', query: 'Builtin' });
  assert.equal(result.resources[0].source, 'builtin');
  await assert.rejects(f.resources.inspect({ kind: 'expert', id: 'Builtin Expert' }), /找不到/);
  await assert.rejects(f.resources.discover({ action: 'install', kind: 'expert', id: 'builtin' }), /确认项目方案/);
});

test('invalid directory, service and default expert inputs cannot enter a draft', () => {
  assert.throws(() => normalizeCreationPlan({ name: 'test', workspaces: ['relative'] }), /绝对路径/);
  assert.throws(() => normalizeCreationPlan({ name: 'test', appServiceIds: ['write'] }), /服务选择/);
  assert.throws(() => normalizeCreationPlan({ name: 'test', assistantName: 'unknown' }), /默认专家/);
});

test('a recoverable project write cannot be edited into a different plan', async t => {
  const f = await fixture(t); f.state.failAfterWrite = true;
  const draft = await f.propose({}); await f.confirm(draft);
  await assert.rejects(f.service.update({ draftId: draft.id, version: draft.version, patch: { name: 'different' } }), /已经创建/);
  assert.equal((await f.confirm(draft)).project.name, '用户研究');
});

test('resources changed while another installation is pending require review', async t => {
  const f = await fixture(t); f.add('skill', 'local'); f.add('skill', 'slow');
  f.local.set('skill:local', f.market.get('skill:local'));
  const draft = await f.propose({ skillIds: ['local', 'slow'] });
  let release; f.state.waitInstall = new Promise(resolve => { release = resolve; });
  const confirmation = f.confirm(draft);
  // Wait for the second resource to enter installation, then revoke the first.
  while (!f.installs.includes('slow')) await new Promise(resolve => setTimeout(resolve, 1));
  f.local.set('skill:local', { ...f.local.get('skill:local'), enabled: false }); release();
  const result = await confirmation;
  assert.equal(result.status, 'awaiting_confirmation'); assert.equal(f.projects.size, 0);
});

test('interrupted execution can be edited or cancelled after restart if no project was written', async t => {
  const f = await fixture(t); const draft = await f.propose({});
  await writeFile(path.join(f.directory, `${draft.id}.json`), JSON.stringify({ ...draft, status: 'installing' }));
  f.restart();
  const edited = await f.service.update({ draftId: draft.id, version: draft.version, patch: { name: '修订方案' } });
  assert.equal(edited.status, 'awaiting_confirmation');
  assert.equal((await f.service.cancel({ draftId: edited.id, version: edited.version })).draft.status, 'cancelled');
  assert.equal(f.installs.length, 0);
});
