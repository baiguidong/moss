import { expect, test } from 'bun:test';
import { normalizeProjectDefaults, resolveProjectSessionDefaults } from '../src/shared/project-session-defaults.mjs';

test('inherits project configuration with Boss and Teams enabled, independent of global Teams', () => {
  const resolved = resolveProjectSessionDefaults({ id: 'p', instructions: 'Project rules', skillIds: ['s'], expertIds: ['assistant'], appIds: ['app'] }, {}, { permissionMode: 'acceptEdits', agentTeamsEnabled: false }, '/projects/p');
  expect(resolved).toMatchObject({ workspace: '/projects/p', permissionMode: 'acceptEdits', mode: 'boss', assistant_name: 'assistant', appIds: ['app'], projectDefaults: { instructions: 'Project rules', agentTeamsEnabled: true } });
});

test('explicit empty resources, Chat and false override project values; snapshots do not change with project', () => {
  const project = { id: 'p', instructions: 'before', skillIds: ['skill'], expertIds: ['assistant'], connectorIds: ['c'], appIds: ['app'], workspaces: ['/one', '/two'], defaultWorkspace: '/one' };
  const input = { skillIds: [], connectorIds: [], appIds: [], assistant_name: '', agentTeamsEnabled: false, mode: 'chat', workspace: '/two' };
  const first = resolveProjectSessionDefaults(project, input, { permissionMode: 'default' }, '/fallback');
  project.instructions = 'after'; project.skillIds.push('new'); project.expertIds.push('other');
  expect(first).toMatchObject({ workspace: '/two', skillIds: [], connectorIds: [], appIds: [], assistant_name: '', mode: 'chat', projectDefaults: { instructions: 'before', expertIds: [], agentTeamsEnabled: false } });
  const next = resolveProjectSessionDefaults(project, {}, {}, '/fallback');
  expect(next.projectDefaults.instructions).toBe('after');
  expect(next.skillIds).toEqual(['skill', 'new']);
  expect(() => resolveProjectSessionDefaults(project, { workspace: '/outside' }, {}, '/fallback')).toThrow('项目配置');
});

test('choosing another assistant also replaces the inherited assistant resource scope', () => {
  const project = { id: 'p', assistantName: 'original', expertIds: ['original'] };
  expect(resolveProjectSessionDefaults(project, { assistant_name: 'replacement' }, {}, '/p').projectDefaults.expertIds).toEqual(['replacement']);
  expect(resolveProjectSessionDefaults({ ...project, assistantName: '' }, {}, {}, '/p').projectDefaults.expertIds).toEqual([]);
});

test('removing the default directory selects a remaining directory and does not force a deleted path', () => {
  expect(normalizeProjectDefaults({ workspaces: ['/two'], defaultWorkspace: '/one', agentTeamsEnabled: false })).toMatchObject({ defaultWorkspace: '/two', agentTeamsEnabled: false });
});
