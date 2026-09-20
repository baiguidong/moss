import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceCatalog, validateWorkspaceName } from '../src/workspace-catalog.mjs';

describe('workspace catalog', () => {
  let tempDir = '';
  let currentTime = 100;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'moss-workspaces-'));
    currentTime = 100;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test('creates named workspaces under the managed root and rejects duplicates', async () => {
    const root = path.join(tempDir, '.moss', 'workspaces');
    const catalog = createWorkspaceCatalog(root, { now: () => currentTime });

    const created = await catalog.create('客户调研');
    expect(created).toMatchObject({
      name: '客户调研',
      path: path.join(root, '客户调研'),
      managed: true,
    });
    await expect(catalog.create('客户调研')).rejects.toThrow('已存在同名工作空间');
  });

  test('lists managed and local workspaces by recent use with a default limit', async () => {
    const root = path.join(tempDir, '.moss', 'workspaces');
    const catalog = createWorkspaceCatalog(root, { now: () => currentTime });
    await catalog.create('较早项目');
    currentTime = 200;
    await catalog.create('最近项目');
    const localFolder = path.join(tempDir, 'Desktop');
    await mkdir(localFolder);
    currentTime = 300;
    await catalog.touch(localFolder);

    expect((await catalog.list()).map((entry) => entry.name))
      .toEqual(['Desktop', '最近项目', '较早项目']);
    expect((await catalog.list({ query: '项目', limit: 1 })).map((entry) => entry.name))
      .toEqual(['最近项目']);
  });

  test('validates workspace names before touching the filesystem', () => {
    expect(validateWorkspaceName('  正常名称  ')).toBe('正常名称');
    expect(() => validateWorkspaceName('../outside')).toThrow('不能包含路径');
    expect(() => validateWorkspaceName('')).toThrow('不能为空');
  });
});

