import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAppResourceFile } from '../src/apps/app-resources.mjs';
test('App resource resolution validates provider availability and app-owned file containment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'moss-app-resources-'));
  try {
    const data = join(root, 'data'); await mkdir(data);
    const file = join(data, 'note.md'), external = join(root, 'private.md'); await writeFile(file, 'note'); await writeFile(external, 'external');
    let result = { kind: 'file', path: file };
    let providers = [{ id: 'notes/provider', appId: 'notes', schemes: ['example-notes'] }];
    const runtime = { dataDir: data, appDataPath: () => data, listContributions: async () => ({ resourceProviders: providers }), resolveContributionInstance: () => ({ id: 'default' }), invokeContribution: async () => result };
    const uri = 'example-notes://document/123';
    expect((await resolveAppResourceFile(runtime, uri)).path).toContain('note.md');
    result = { kind: 'file', path: external }; await expect(resolveAppResourceFile(runtime, uri)).rejects.toThrow('outside');
    await symlink(external, join(data, 'escape.md')); result.path = join(data, 'escape.md'); await expect(resolveAppResourceFile(runtime, uri)).rejects.toThrow('outside');
    providers = []; await expect(resolveAppResourceFile(runtime, uri)).rejects.toThrow('provider');
    await expect(resolveAppResourceFile(runtime, 'javascript://execute')).rejects.toThrow('unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});
