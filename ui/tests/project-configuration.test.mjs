import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateProjectWorkspace, prepareProjectWorkspaces } from '../src/project-workspaces.mjs';
import { normalizeGeneratedProjectInstructions, refreshProjectSessionInstructions } from '../src/shared/project-instructions.mjs';
import { normalizeCreationPlan } from '../src/project-creation-service.mjs';
import { createProjectCreationResources } from '../src/project-creation-resources.mjs';

test('missing nested workspace can be previewed, then created and retried; files and dangling links are rejected', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'project-workspaces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'new', 'workspace');
  await validateProjectWorkspace(directory);
  await assert.rejects(stat(directory), { code: 'ENOENT' });
  await prepareProjectWorkspaces([directory]);
  await prepareProjectWorkspaces([directory]);
  assert.equal((await stat(directory)).isDirectory(), true);
  await writeFile(path.join(root, 'file'), 'existing content');
  await assert.rejects(validateProjectWorkspace(path.join(root, 'file', 'child')), /不可用/);
  await assert.rejects(validateProjectWorkspace('relative/path'), /绝对路径/);
  await symlink(path.join(root, 'missing'), path.join(root, 'link'));
  await assert.rejects(validateProjectWorkspace(path.join(root, 'link', 'child')), /无效链接/);
});

test('generated Markdown survives JSON persistence with real line breaks and leaves code escapes intact', () => {
  const instructions = normalizeGeneratedProjectInstructions('## 协作规则\\n\\n- 使用中文\\n- 以最新资料为准');
  assert.equal(instructions, '## 协作规则\n\n- 使用中文\n- 以最新资料为准');
  assert.equal(JSON.parse(JSON.stringify({ instructions })).instructions, instructions);
  assert.equal(normalizeGeneratedProjectInstructions('```markdown\n## 规则\n\n- 中文\n```'), '## 规则\n\n- 中文');
  const code = '## 示例\n\n```js\nconst separator = "\\n";\n```';
  assert.equal(normalizeGeneratedProjectInstructions(code), code);
  assert.equal(normalizeGeneratedProjectInstructions('输出字面量 \\n'), '输出字面量 \\n');
  assert.equal(normalizeCreationPlan({ name: 'New' }).project.permissionMode, 'bypassPermissions');
  assert.equal(normalizeCreationPlan({ name: 'New', permissionMode: 'plan' }).project.permissionMode, 'plan');
  const literal = '## Literal example\\n\\n- Preserve typed escapes';
  assert.equal(normalizeCreationPlan({ name: 'Edited', instructions: literal }, { generated: false }).project.instructions, literal);
});

test('refreshing instructions at the next turn preserves session resources, permissions and history', () => {
  const session = { projectDefaults: { instructions: 'old', skillIds: ['chosen'] }, projectResourceManifest: { instructions: 'old', skills: ['chosen'] }, permissionMode: 'plan', history: ['old message'] };
  assert.equal(refreshProjectSessionInstructions({ instructions: '# 新规则\n\n- 中文' }, session), true);
  assert.equal(session.projectDefaults.instructions, '# 新规则\n\n- 中文');
  assert.deepEqual(session.projectDefaults.skillIds, ['chosen']);
  assert.deepEqual(session.projectResourceManifest.skills, ['chosen']);
  assert.equal(session.permissionMode, 'plan');
  assert.deepEqual(session.history, ['old message']);
  assert.equal(refreshProjectSessionInstructions({ instructions: '# 新规则\n\n- 中文' }, session), false);
  assert.equal(refreshProjectSessionInstructions({ instructions: 'changed' }, { ...session, isSubAgent: true }), false);
  assert.equal(refreshProjectSessionInstructions({ instructions: '' }, session), true);
});

test('resource catalog merges local and marketplace identities and remains usable when the market fails', async () => {
  let offline = false;
  const resources = createProjectCreationResources({
    installed: async () => [{ id: 'local', displayName: '本地' }, { id: 'shared', displayName: '同名', runtimeId: 'shared-runtime' }],
    browse: async ({ page }) => { if (offline) throw new Error('offline'); return { entries: page === 1 ? [{ id: 'shared' }, { id: 'remote', displayName: '同名' }] : [{ id: 'remote-2' }], total: 3, hasMore: page === 1 }; },
  });
  const first = await resources.list({ kind: 'skill' });
  assert.deepEqual(first.resources.map(entry => [entry.id, entry.installed]), [['local', true], ['shared', true], ['remote', false]]);
  assert.equal((await resources.inspect({ kind: 'skill', id: 'shared-runtime' })).id, 'shared');
  assert.equal((await resources.list({ kind: 'skill', page: 2 })).resources[0].id, 'remote-2');
  offline = true;
  const local = await resources.list({ kind: 'skill' });
  assert.equal(local.resources.length, 2);
  assert.match(local.warning, /offline/);
});

test('saving a selection installs exact missing resources and resolves runtime IDs; retries skip completed installations', async () => {
  const local = new Map(); const calls = [];
  let fail = true;
  const market = { skill: { id: 'skill-id', runtimeId: 'skill-runtime', version: '1' }, expert: { id: 'expert-id', runtimeId: 'expert-runtime', version: '2' }, app: { id: 'app-id', version: '3' } };
  const resources = createProjectCreationResources({
    installed: async kind => [...local.values()].filter(entry => entry.kind === kind),
    detail: async (kind, id) => market[kind].id === id ? market[kind] : null,
    install: async (kind, entry) => { calls.push(entry.id); if (kind === 'app' && fail) throw new Error('download failed'); local.set(entry.id, { ...entry, kind }); },
    validateApp: async () => {},
  });
  const selection = { skillIds: ['skill-id'], expertIds: ['expert-id'], assistantName: 'expert-id', appIds: ['app-id'] };
  await assert.rejects(resources.prepare(selection), /download failed/);
  fail = false;
  const resolved = await resources.prepare(selection);
  assert.deepEqual(calls, ['skill-id', 'expert-id', 'app-id', 'app-id']);
  assert.deepEqual(resolved.skillIds, ['skill-runtime']);
  assert.deepEqual(resolved.expertIds, ['expert-runtime']);
  assert.equal(resolved.assistantName, 'expert-runtime');
  assert.deepEqual(resolved.appIds, ['app-id']);
  await resources.prepare(resolved);
  assert.equal(calls.length, 4);
});

test('editing a project can retain a disabled App without silently enabling it', async () => {
  const resources = createProjectCreationResources({
    installed: async () => [{ id: 'disabled-app', enabled: false }],
    validateApp: async () => { throw new Error('App needs configuration'); },
  });
  const project = { appIds: ['disabled-app'], instructions: 'old' };
  assert.deepEqual((await resources.prepare({ ...project, instructions: 'new' }, project)).appIds, ['disabled-app']);
  await assert.rejects(resources.prepare(project), /configuration/);
});
