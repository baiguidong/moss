import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAppResourceFile } from '../src/apps/app-resources.mjs';
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs';
import { createPresentationResolver } from '../src/presentation/resource-resolver.mjs';
import { createPresentationService } from '../src/presentation/presentation-service.mjs';
test('App resource resolution validates provider availability and app-owned file containment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-app-resources-'));
  try {
    const data = join(root, 'data'); await mkdir(data);
    const file = join(data, 'note.md'), external = join(root, 'private.md'); await writeFile(file, 'note'); await writeFile(external, 'external');
    let result = { kind: 'file', path: file };
    let providers = [{ id: 'notes/provider', appId: 'notes', schemes: ['example-notes'] }];
    const runtime = { getActivePackage: async () => ({ manifest: {} }), dataDir: data, appDataPath: () => data, listContributions: async () => ({ resourceProviders: providers }), resolveContributionInstance: () => ({ id: 'default' }), invokeContribution: async () => result };
    const uri = 'example-notes://document/123';
    expect((await resolveAppResourceFile(runtime, uri)).path).toContain('note.md');
    result = { kind: 'file', path: external }; await expect(resolveAppResourceFile(runtime, uri)).rejects.toThrow('outside');
    await symlink(external, join(data, 'escape.md')); result.path = join(data, 'escape.md'); await expect(resolveAppResourceFile(runtime, uri)).rejects.toThrow('outside');
    providers = []; await expect(resolveAppResourceFile(runtime, uri)).rejects.toThrow('provider');
    await expect(resolveAppResourceFile(runtime, 'javascript://execute')).rejects.toThrow('unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('global App results present without composer selection and respect effective scope overrides', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-global-app-result-'));
  const runtime = new AppRuntimeHost({ rootDir: root });
  const manifest = { id: 'sheets', version: '1.0.0', toolScope: 'global', toolLoading: 'always',
    contributes: { resourceProviders: [{ id: 'files', schemes: ['example-sheets'] }] } };
  try {
    await runtime.state.initialize();
    runtime.getActivePackage = async () => ({ manifest, root });
    await runtime.installations.upsert(manifest.id, { enabled: true, activeVersion: '1.0.0', grants: [] });
    const data = join(root, 'artifacts'); await mkdir(data);
    await writeFile(join(data, 'preview.html'), '<table><tr><td>餐饮</td><td>0</td></tr></table>');
    await writeFile(join(data, 'budget.xlsx'), 'xlsx fixture');
    runtime.resolveContributionInstance = () => ({ id: 'default' });
    runtime.appDataPath = () => data;
    runtime.invokeContribution = async (_kind, _id, { uri }) => ({ kind: 'file', name: uri.endsWith('/xlsx') ? 'budget.xlsx' : '预算预览',
      path: join(data, uri.endsWith('/xlsx') ? 'budget.xlsx' : 'preview.html') });
    const session = { id: 'budget', agentMode: 'local', workspace: root, appIds: [] };
    const resolver = createPresentationResolver({ readWorkspaceFile: async () => { throw new Error('unused'); },
      resolveResourceFile: (uri, record) => resolveAppResourceFile(runtime, uri, record) });
    const service = createPresentationService({ storageRoot: join(root, 'presentation'), getSessionRecord: () => session, waitMs: 0, ...resolver });
    await service.beginTurn(session.id, 'turn');
    const input = { items: [{ resource_uri: 'example-sheets://work/preview', role: 'primary' }, { resource_uri: 'example-sheets://work/xlsx', role: 'supporting' }] };
    expect((await service.present(session.id, input, { turnId: 'turn' })).ok).toBe(true);
    const snapshot = await service.snapshot(session.id);
    expect(snapshot.resources.map(resource => [resource.title, resource.isResult])).toEqual([['预算预览', true], ['budget.xlsx', true]]);
    const restored = createPresentationService({ storageRoot: join(root, 'presentation'), getSessionRecord: () => session, waitMs: 0, ...resolver });
    expect((await restored.snapshot(session.id)).resources).toHaveLength(2);
    const context = { appId: manifest.id, assertCurrent() {} };
    await runtime.toolScopeSettings(context, 'session');
    await expect(resolveAppResourceFile(runtime, input.items[0].resource_uri, session)).rejects.toThrow('not enabled');
    expect((await resolveAppResourceFile(runtime, input.items[0].resource_uri, { ...session, appIds: ['sheets'] })).appId).toBe('sheets');
    // Explicit user navigation still opens an installed App's history.
    expect((await resolveAppResourceFile(runtime, input.items[0].resource_uri)).appId).toBe('sheets');
    await runtime.toolScopeSettings(context, 'global', 'on-demand');
    expect((await resolveAppResourceFile(runtime, input.items[0].resource_uri, session)).appId).toBe('sheets');
    await runtime.installations.upsert(manifest.id, { enabled: false });
    await expect(resolveAppResourceFile(runtime, input.items[0].resource_uri, session)).rejects.toThrow('provider');
  } finally { await rm(root, { recursive: true, force: true }); }
});
