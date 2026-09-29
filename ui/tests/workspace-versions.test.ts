import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceVersionService } from '../src/workspace-versions/workspace-version-service.mjs';
import { registerWorkspaceVersionIpcHandlers, workspacePathsOverlap } from '../src/workspace-versions/workspace-version-bridge.mjs';

describe('workspace versions with a real isolated Git repository', () => {
  let temp: string;
  let workspace: string;
  let rootDir: string;
  let service: ReturnType<typeof createWorkspaceVersionService>;
  const put = async (file: string, content: string | Buffer) => {
    await mkdir(path.dirname(path.join(workspace, file)), { recursive: true });
    await writeFile(path.join(workspace, file), content);
  };
  const read = (file: string) => readFile(path.join(workspace, file), 'utf8');
  beforeEach(async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'moss-versions-'));
    workspace = path.join(temp, '工作区 #1');
    rootDir = path.join(temp, 'state');
    await mkdir(workspace);
    service = createWorkspaceVersionService({ rootDir });
  });
  afterEach(async () => { await rm(temp, { recursive: true, force: true }); });

  test('saves byte-exact text, binary, empty files and unusual names without initializing the workspace', async () => {
    await put('文档/初稿 "a"\t.txt', 'first\r\nsecond\r\n');
    await put('image.bin', Buffer.from([0, 255, 128, 10]));
    await put('empty', '');
    await put('.gitattributes', '* text eol=lf\n');
    const before = await service.status(workspace);
    expect(before.versions).toEqual([]);
    const saved = await service.save(workspace, '初稿');
    expect(saved).toMatchObject({ created: true, version: { number: 1, label: '初稿', fileCount: 4 } });
    expect((await service.status(workspace)).changes).toEqual([]);
    expect((await readdir(workspace)).includes('.git')).toBe(false);
    const preview = await service.previewFile(workspace, saved.version.id, '文档/初稿 "a"\t.txt');
    expect(await readFile(preview.path, 'utf8')).toBe('first\r\nsecond\r\n');
    const binary = await service.previewFile(workspace, saved.version.id, 'image.bin');
    expect(await readFile(binary.path)).toEqual(Buffer.from([0, 255, 128, 10]));
    expect(await service.save(workspace, '另一个别名')).toMatchObject({ created: false, reason: 'unchanged' });
    const reopened = createWorkspaceVersionService({ rootDir });
    const unchanged = await reopened.status(workspace);
    expect(unchanged.versions.map(version => version.id)).toEqual([saved.version.id]);
    expect(unchanged.versions[0].alias).toBe('初稿');
    expect(unchanged.nextTag).toBe('1.1');
  });

  test('leaves an existing Git branch, staging area, config and commits untouched', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8' });
    git('init', '-q');
    await put('file.txt', 'initial');
    git('add', '.');
    git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-qm', 'initial');
    await put('file.txt', 'staged'); git('add', '.');
    await put('file.txt', 'unstaged');
    const head = git('rev-parse', 'HEAD');
    const index = await readFile(path.join(workspace, '.git/index'));
    const config = await readFile(path.join(workspace, '.git/config'));
    const saved = await service.save(workspace, 'Snapshot');
    await put('file.txt', 'later');
    const plan = await service.previewRestore(workspace, saved.version.id);
    await service.restore(workspace, saved.version.id, plan.token);
    expect(await read('file.txt')).toBe('unstaged');
    expect(git('rev-parse', 'HEAD')).toBe(head);
    expect(await readFile(path.join(workspace, '.git/index'))).toEqual(index);
    expect(await readFile(path.join(workspace, '.git/config'))).toEqual(config);
    expect(git('show', ':file.txt')).toBe('staged');
  });

  test('restores additions/deletions and preserves unsaved changes in a durable backup', async () => {
    await put('plan.md', 'v1'); await put('removed.txt', 'restore me');
    const v1 = (await service.save(workspace, '初稿')).version;
    await put('plan.md', 'v2'); await rm(path.join(workspace, 'removed.txt'));
    const v2 = (await service.save(workspace, '第二版')).version;
    await put('plan.md', 'unsaved'); await put('new.txt', 'new file');
    const historical = await service.previewFile(workspace, v1.id, 'plan.md');
    expect(await readFile(historical.path, 'utf8')).toBe('v1');
    expect(await read('plan.md')).toBe('unsaved');
    const plan = await service.previewRestore(workspace, v1.id);
    expect(plan.changes).toEqual([
      { path: 'new.txt', status: 'deleted' }, { path: 'plan.md', status: 'modified' }, { path: 'removed.txt', status: 'added' },
    ]);
    const result = await service.restore(workspace, v1.id, plan.token);
    expect(result.version).toMatchObject({ number: 4, kind: 'restore', restoredFrom: v1.id });
    expect(result.backupVersion).toMatchObject({ number: 3, kind: 'backup' });
    expect(await read('plan.md')).toBe('v1');
    expect(await read('removed.txt')).toBe('restore me');
    expect(await readdir(workspace)).not.toContain('new.txt');
    const state = await service.status(workspace);
    expect(state.changes).toEqual([]);
    expect(state.versions.map(v => v.id)).toContain(v2.id);
    const backupPlan = await service.previewRestore(workspace, result.backupVersion.id);
    await service.restore(workspace, result.backupVersion.id, backupPlan.token);
    expect(await read('plan.md')).toBe('unsaved');
    expect(await read('new.txt')).toBe('new file');
    expect(await readdir(workspace)).not.toContain('removed.txt');
    expect(await service.contextNote(workspace)).toContain('请重新读取');
  });

  test('rejects stale restore previews, unknown revisions and cross-workspace revisions', async () => {
    await put('a', 'old'); const first = (await service.save(workspace)).version;
    await put('a', 'new');
    const plan = await service.previewRestore(workspace, first.id);
    await put('b', 'arrived after preview');
    await expect(service.restore(workspace, first.id, plan.token)).rejects.toThrow('重新查看');
    expect(await read('a')).toBe('new');
    await expect(service.listFiles(workspace, 'HEAD')).rejects.toThrow('无效');
    const other = path.join(temp, 'other'); await mkdir(other);
    await expect(service.listFiles(other, first.id)).rejects.toThrow('不存在');
    await expect(service.previewFile(workspace, first.id, '../outside')).rejects.toThrow('没有此文件');
  });

  test('serializes saves and checks active tasks at execution time', async () => {
    await put('a', 'one');
    const results = await Promise.all([service.save(workspace, 'a'), service.save(workspace, 'b')]);
    const successful = results.filter(result => result.created);
    const unchanged = results.filter(result => !result.created);
    expect(successful).toHaveLength(1);
    expect(unchanged).toHaveLength(1);
    expect(unchanged[0]).toMatchObject({ reason: 'unchanged', message: '没有文件变化，无需保存版本。' });
    expect(successful[0].version.tag).toBe('1.0');
    const blocked = createWorkspaceVersionService({ rootDir, assertIdle: () => { throw new Error('任务正在运行'); } });
    await expect(blocked.save(workspace)).rejects.toThrow('任务正在运行');
    const version = successful[0].version;
    const plan = await service.previewRestore(workspace, version.id);
    await expect(blocked.restore(workspace, version.id, plan.token)).rejects.toThrow('任务正在运行');
    expect(blocked.isActive(workspace)).toBe(false);
  });

  test('lists excluded content and leaves it intact on restore', async () => {
    await put('a', 'one'); await put('.env', 'private'); await put('.env.example', 'example');
    await put('node_modules/pkg/index.js', 'dependency'); await put('build/output', 'build');
    await put('large.bin', ''); await truncate(path.join(workspace, 'large.bin'), 51 * 1024 * 1024);
    const first = (await service.save(workspace)).version;
    expect(first.fileCount).toBe(2);
    const status = await service.status(workspace);
    expect(status.excluded.map(item => item.path).sort()).toEqual(['.env', 'build', 'large.bin', 'node_modules']);
    await put('.env', 'still private'); await put('a', 'two');
    const plan = await service.previewRestore(workspace, first.id);
    await service.restore(workspace, first.id, plan.token);
    expect(await read('.env')).toBe('still private');
    expect((await lstat(path.join(workspace, 'large.bin'))).size).toBe(51 * 1024 * 1024);
  });

  test('refuses to overwrite excluded files that used to be tracked', async () => {
    await put('a', 'one'); const first = (await service.save(workspace)).version;
    await truncate(path.join(workspace, 'a'), 51 * 1024 * 1024);
    await expect(service.previewRestore(workspace, first.id)).rejects.toThrow('未纳入版本管理');
  });

  test.skipIf(process.platform === 'win32')('does not follow symlinks and shares history through workspace aliases', async () => {
    await put('nested/a', 'saved'); const first = (await service.save(workspace)).version;
    const alias = path.join(temp, 'alias'); await symlink(workspace, alias);
    expect((await service.status(alias)).versions[0].id).toBe(first.id);
    const outside = path.join(temp, 'outside'); await mkdir(outside); await writeFile(path.join(outside, 'a'), 'external');
    await rm(path.join(workspace, 'nested'), { recursive: true }); await symlink(outside, path.join(workspace, 'nested'));
    expect((await service.status(workspace)).excluded).toContainEqual({ path: 'nested', reason: '符号链接' });
    await expect(service.previewRestore(workspace, first.id)).rejects.toThrow('符号链接');
    expect(await readFile(path.join(outside, 'a'), 'utf8')).toBe('external');
    expect(workspacePathsOverlap(alias, workspace)).toBe(true);
    expect(workspacePathsOverlap(workspace, `${workspace}-other`)).toBe(false);
    expect(workspacePathsOverlap(path.parse(workspace).root, workspace)).toBe(true);
  });

  test('handles file/directory transitions and protects excluded directory contents', async () => {
    await put('item', 'file'); const first = (await service.save(workspace)).version;
    await rm(path.join(workspace, 'item')); await put('item/sub', 'nested');
    const second = (await service.save(workspace)).version;
    let plan = await service.previewRestore(workspace, first.id);
    await service.restore(workspace, first.id, plan.token);
    expect(await read('item')).toBe('file');
    plan = await service.previewRestore(workspace, second.id);
    await service.restore(workspace, second.id, plan.token);
    expect(await read('item/sub')).toBe('nested');
    await put('item/node_modules/pkg', 'excluded');
    await expect(service.previewRestore(workspace, first.id)).rejects.toThrow('未纳入版本管理');
  });

  test('rolls back a partially failed restore and retains its backup', async () => {
    await put('a', 'old-a'); await put('b', 'old-b');
    const first = (await service.save(workspace)).version;
    await put('a', 'new-a'); await put('b', 'new-b');
    const failing = createWorkspaceVersionService({ rootDir, beforeWrite: file => { if (file === 'b') throw new Error('simulated disk failure'); } });
    const plan = await failing.previewRestore(workspace, first.id);
    await expect(failing.restore(workspace, first.id, plan.token)).rejects.toThrow('已还原恢复前');
    expect(await read('a')).toBe('new-a'); expect(await read('b')).toBe('new-b');
    const state = await service.status(workspace);
    expect(state.versions[0].kind).toBe('backup');
    expect(state.interruptedRestore).toBeNull();
  });

  test('preserves external edits arriving during a partially failed restore', async () => {
    await put('a', 'old-a'); await put('b', 'old-b');
    const first = (await service.save(workspace)).version;
    await put('a', 'new-a'); await put('b', 'new-b');
    const racing = createWorkspaceVersionService({ rootDir, beforeWrite: async file => {
      if (file === 'b') await put('b', 'external edit during restore');
    } });
    const plan = await racing.previewRestore(workspace, first.id);
    await expect(racing.restore(workspace, first.id, plan.token)).rejects.toThrow('已还原恢复前');
    expect(await read('a')).toBe('new-a');
    expect(await read('b')).toBe('external edit during restore');
  });

  test.skipIf(process.platform === 'win32')('restores the executable bit', async () => {
    await put('run.sh', '#!/bin/sh\n'); await chmod(path.join(workspace, 'run.sh'), 0o755);
    const first = (await service.save(workspace)).version;
    await chmod(path.join(workspace, 'run.sh'), 0o644);
    const plan = await service.previewRestore(workspace, first.id);
    await service.restore(workspace, first.id, plan.token);
    expect((await lstat(path.join(workspace, 'run.sh'))).mode & 0o111).toBe(0o111);
  });

  test('skips unchanged empty workspaces, permits a deletion-only version and reports missing Git', async () => {
    expect(await service.save(workspace, '空白起点')).toMatchObject({ created: false, reason: 'unchanged' });
    expect((await service.status(workspace)).nextTag).toBe('1.0');
    await put('removed', 'delete me');
    await service.save(workspace);
    await rm(path.join(workspace, 'removed'));
    const empty = (await service.save(workspace)).version;
    expect(empty).toMatchObject({ fileCount: 0, tag: '1.1' });
    await put('a', 'new');
    const plan = await service.previewRestore(workspace, empty.id);
    await service.restore(workspace, empty.id, plan.token);
    expect(await readdir(workspace)).toEqual([]);
    const missingGit = createWorkspaceVersionService({ rootDir: path.join(temp, 'missing-git'), gitPath: path.join(temp, 'no-git') });
    await expect(missingGit.save(workspace)).rejects.toThrow('未找到 Git');
    expect(await readdir(workspace)).toEqual([]);
  });

  test('increments real annotated Git tags through 1.9 to 2.0 and stores aliases inside Git', async () => {
    expect((await service.status(workspace)).nextTag).toBe('1.0');
    const saved = [];
    for (let i = 0; i < 12; i++) {
      await put('a', `file contents for revision ${i}`);
      saved.push((await service.save(workspace, i === 10 ? '客户确认版「甲」' : '')).version);
    }
    expect(saved.map(version => version.tag)).toEqual(['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '2.0', '2.1']);
    const repositoryDirectory = path.join(rootDir, (await readdir(rootDir))[0]);
    const repo = path.join(repositoryDirectory, 'repository.git');
    const git = (...args: string[]) => execFileSync('git', [`--git-dir=${repo}`, ...args], { encoding: 'utf8' }).trim();
    expect(git('cat-file', '-t', 'refs/tags/2.0')).toBe('tag');
    expect(git('rev-parse', 'refs/tags/2.0^{}')).toBe(saved[10].id);
    const annotation = JSON.parse(git('for-each-ref', '--format=%(contents)', 'refs/tags/2.0'));
    expect(annotation).toEqual({ schema: 'moss-workspace-version', version: '2.0', alias: '客户确认版「甲」' });
    const commitMetadata = JSON.parse(git('show', '-s', '--format=%B', saved[10].id));
    expect(commitMetadata.label).toBeUndefined();
    expect(await readdir(repositoryDirectory)).toEqual(['repository.git']);
    const reopened = createWorkspaceVersionService({ rootDir });
    const state = await reopened.status(workspace);
    expect(state.nextTag).toBe('2.2');
    expect(state.versions[1]).toMatchObject({ tag: '2.0', alias: '客户确认版「甲」', label: '客户确认版「甲」' });
    expect(state.versions[0]).toMatchObject({ tag: '2.1', alias: '', label: '2.1' });
  }, 30000);

  test('migrates legacy commit-only versions without rewriting commits or dropping names', async () => {
    await put('a', 'legacy contents');
    const first = (await service.save(workspace)).version;
    const repo = path.join(rootDir, (await readdir(rootDir))[0], 'repository.git');
    const git = (...args: string[]) => execFileSync('git', [`--git-dir=${repo}`, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', ...args], { encoding: 'utf8' }).trim();
    const tree = git('rev-parse', `${first.id}^{tree}`);
    const legacyId = git('commit-tree', tree, '-m', JSON.stringify({ number: 1, label: '旧客户版本', kind: 'manual', createdAt: 1700000000000, fileCount: 1, changedFiles: 1 }));
    git('update-ref', 'refs/heads/versions', legacyId);
    git('update-ref', '-d', 'refs/tags/1.0');
    const state = await service.status(workspace);
    expect(state.versions[0]).toMatchObject({ id: legacyId, tag: '1.0', alias: '旧客户版本' });
    expect(git('rev-parse', 'refs/heads/versions')).toBe(legacyId);
    expect(git('cat-file', '-t', 'refs/tags/1.0')).toBe('tag');
    expect(git('rev-parse', 'refs/tags/1.0^{}')).toBe(legacyId);
    expect(await read('a')).toBe('legacy contents');
    await put('a', 'updated legacy contents');
    expect((await service.save(workspace)).version.tag).toBe('1.1');
  });

  test('never overwrites an existing numeric tag', async () => {
    await put('a', 'one');
    const first = (await service.save(workspace)).version;
    const repo = path.join(rootDir, (await readdir(rootDir))[0], 'repository.git');
    execFileSync('git', [`--git-dir=${repo}`, 'update-ref', 'refs/tags/1.1', first.id]);
    expect((await service.status(workspace)).nextTag).toBe('1.2');
    await put('a', 'two');
    expect((await service.save(workspace, '新名字')).version.tag).toBe('1.2');
    expect(execFileSync('git', [`--git-dir=${repo}`, 'rev-parse', 'refs/tags/1.1'], { encoding: 'utf8' }).trim()).toBe(first.id);
  });

  test('excluded-only edits and reverted content do not create a tag or consume the next number', async () => {
    await put('a', 'original');
    await service.save(workspace);
    await put('.env', 'updated config');
    await put('node_modules/pkg/index.js', 'updated dependency');
    await put('a', 'temporary edit');
    await put('a', 'original');
    expect(await service.save(workspace, 'alias only')).toMatchObject({ created: false, reason: 'unchanged' });
    const state = await service.status(workspace);
    expect(state.versions).toHaveLength(1);
    expect(state.nextTag).toBe('1.1');
    const repo = path.join(rootDir, (await readdir(rootDir))[0], 'repository.git');
    expect(execFileSync('git', [`--git-dir=${repo}`, 'tag', '--list'], { encoding: 'utf8' }).trim()).toBe('1.0');
    await put('a', 'actual change');
    expect((await service.save(workspace)).version.tag).toBe('1.1');
  });

  test('IPC returns unchanged saves normally without publishing a saved notification', async () => {
    const handlers = new Map<string, Function>();
    const notifications: string[] = [];
    registerWorkspaceVersionIpcHandlers({
      ipcMain: { handle: (name: string, callback: Function) => handlers.set(name, callback) },
      getSessionRecord: () => ({ workspace, agentMode: 'local' }),
      service,
      readWorkspaceFile: async () => ({}),
      busyReason: () => null,
      onChanged: async (_workspace, reason) => { notifications.push(reason); },
    });
    const save = (label = '') => handlers.get('workspace-versions:save')!(null, { sessionId: 'session', label });
    expect(await save()).toEqual({ created: false, reason: 'unchanged', message: '没有文件变化，无需保存版本。' });
    expect(notifications).toEqual([]);
    await put('a', 'initial');
    expect(await save()).toMatchObject({ created: true, version: { tag: '1.0' } });
    expect(await save('alias only')).toMatchObject({ created: false, reason: 'unchanged' });
    expect(notifications).toEqual(['version-saved']);
    expect(await service.status(workspace)).toMatchObject({ nextTag: '1.1' });
    await expect(save('x'.repeat(101))).rejects.toThrow('版本名称不能超过');
    await put('a', 'modified');
    expect(await save()).toMatchObject({ created: true, version: { tag: '1.1' } });
    expect(notifications).toEqual(['version-saved', 'version-saved']);
  });
});

test('IPC prevents remote access and makes historical previews read-only', async () => {
  const handlers = new Map<string, Function>();
  const notifications: string[] = [];
  const record = { workspace: '/local', agentMode: 'remote-direct' };
  registerWorkspaceVersionIpcHandlers({
    ipcMain: { handle: (name: string, callback: Function) => handlers.set(name, callback) },
    getSessionRecord: () => record,
    service: { previewFile: async () => ({ root: '/snapshot', path: '/snapshot/file' }) },
    readWorkspaceFile: async session => ({ path: '/snapshot/file', content: 'old', metadata: { workspace: session.workspace } }),
    busyReason: () => null,
    onChanged: async (_workspace, reason) => { notifications.push(reason); },
  });
  const status = await handlers.get('workspace-versions:status')!(null, { sessionId: 'session' });
  expect(status.supported).toBe(false);
  await expect(handlers.get('workspace-versions:restore')!(null, { sessionId: 'session' })).rejects.toThrow('远程');
  record.agentMode = 'local';
  const file = await handlers.get('workspace-versions:preview-file')!(null, { sessionId: 'session', versionId: 'v1', filePath: 'file' });
  expect(file.metadata).toMatchObject({ workspace: '/snapshot', previewEditable: false, previewSaveable: false });
});
