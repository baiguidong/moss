import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const REF = 'refs/heads/versions';
const OMIT_DIRS = new Set(['.git', 'node_modules', '.cache', '__pycache__', '.venv', 'venv', '.next', '.nuxt', 'dist', 'build', 'coverage']);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 10000;
const TAG_SCHEMA = 'moss-workspace-version';
const versionTag = number => `${Math.floor((number - 1) / 10) + 1}.${(number - 1) % 10}`;
const tagNumber = tag => /^[1-9]\d*\.[0-9]$/.test(tag)
  ? (Number(tag.split('.')[0]) - 1) * 10 + Number(tag.split('.')[1]) + 1 : 0;
const hash = value => createHash('sha256').update(value).digest('hex');
const exists = async file => { try { await fsp.lstat(file); return true; } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; } };
const inside = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); };

function safePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')
    || (process.platform === 'win32' && /[:<>"|?*]|[. ](?:\/|$)/.test(value))) {
    throw new Error('版本中包含不支持的文件路径。');
  }
  return value;
}

function changesBetween(before, after) {
  const oldFiles = new Map(before.map(file => [file.path, file]));
  const newFiles = new Map(after.map(file => [file.path, file]));
  return [...new Set([...oldFiles.keys(), ...newFiles.keys()])].sort().flatMap(filePath => {
    const oldFile = oldFiles.get(filePath);
    const newFile = newFiles.get(filePath);
    if (oldFile?.oid === newFile?.oid && oldFile?.mode === newFile?.mode) return [];
    return [{ path: filePath, status: !oldFile ? 'added' : !newFile ? 'deleted' : 'modified' }];
  });
}

export function createWorkspaceVersionService({ rootDir, gitPath = () => process.env.MOSS_GIT_PATH || 'git', beforeWrite, assertIdle = () => {} } = {}) {
  const storageRoot = path.resolve(rootDir);
  const queues = new Map();
  const active = new Set();

  async function context(workspace) {
    if (typeof workspace !== 'string' || !workspace) throw new Error('当前会话没有工作区。');
    const root = await fsp.realpath(workspace);
    if (!(await fsp.stat(root)).isDirectory()) throw new Error('工作区不是目录。');
    if (inside(storageRoot, root)) throw new Error('版本存储目录不能用作工作区。');
    const key = process.platform === 'win32' ? root.toLowerCase() : root;
    const directory = path.join(storageRoot, hash(key));
    return { root, key, directory, repo: path.join(directory, 'repository.git'), journal: path.join(directory, 'restore.json') };
  }

  async function run(workspace, operation, mutation = false) {
    const ctx = await context(workspace);
    const previous = queues.get(ctx.key) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      if (mutation) active.add(ctx.key);
      try { if (mutation) assertIdle(ctx.root); return await operation(ctx); }
      finally { if (mutation) active.delete(ctx.key); }
    });
    queues.set(ctx.key, next);
    try { return await next; } finally { if (queues.get(ctx.key) === next) queues.delete(ctx.key); }
  }

  function git(ctx, args, { input, cwd = ctx.directory, index, maxBytes = 32 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) => {
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
      Object.assign(env, {
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_ATTR_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Moss', GIT_AUTHOR_EMAIL: 'workspace@localhost',
        GIT_COMMITTER_NAME: 'Moss', GIT_COMMITTER_EMAIL: 'workspace@localhost',
        ...(index ? { GIT_INDEX_FILE: index } : {}),
      });
      const child = spawn(typeof gitPath === 'function' ? gitPath() : gitPath, [
        '--no-pager', `--git-dir=${ctx.repo}`, '-c', 'core.hooksPath=/dev/null', ...args,
      ], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = [];
      let size = 0;
      let stderr = '';
      let failure;
      const timer = setTimeout(() => { failure = new Error('版本操作超时，请稍后重试。'); child.kill(); }, 60000);
      child.stdout.on('data', chunk => { size += chunk.length; if (size > maxBytes) { failure = new Error('版本数据超过读取上限。'); child.kill(); } else chunks.push(chunk); });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-4000); });
      child.stdin.on('error', () => {});
      child.on('error', error => { clearTimeout(timer); reject(new Error(error.code === 'ENOENT' ? '未找到 Git，请安装 Git 后重试。' : error.message)); });
      child.on('close', code => { clearTimeout(timer); if (failure || code !== 0) reject(failure || new Error(`版本操作失败：${stderr.trim() || code}`)); else resolve(Buffer.concat(chunks)); });
      child.stdin.end(input);
    });
  }

  async function initialize(ctx) {
    await fsp.mkdir(ctx.directory, { recursive: true, mode: 0o700 });
    if (!await exists(path.join(ctx.repo, 'HEAD'))) await git(ctx, ['init', '--bare', '--object-format=sha1', ctx.repo]);
  }

  async function tags(ctx) {
    if (!await exists(path.join(ctx.repo, 'HEAD'))) return [];
    const output = (await git(ctx, ['for-each-ref', '--format=%(refname:strip=2)%00%(objectname)%00%(*objectname)%00%(contents)%00', 'refs/tags'])).toString('utf8').split('\0');
    const result = [];
    for (let i = 0; i + 3 < output.length; i += 4) {
      const tag = output[i].trim();
      if (!tagNumber(tag)) continue;
      let alias;
      try {
        const annotation = JSON.parse(output[i + 3]);
        if (annotation.schema === TAG_SCHEMA && typeof annotation.alias === 'string') alias = annotation.alias;
      } catch {}
      result.push({ tag, id: output[i + 2] || output[i + 1], alias });
    }
    return result;
  }

  async function createTagObject(ctx, id, tag, alias, createdAt) {
    const annotation = JSON.stringify({ schema: TAG_SCHEMA, version: tag, alias });
    return (await git(ctx, ['mktag'], {
      input: `object ${id}\ntype commit\ntag ${tag}\ntagger Moss <workspace@localhost> ${Math.floor(createdAt / 1000)} +0000\n\n${annotation}\n`,
    })).toString().trim();
  }

  async function nextNumber(ctx) {
    return Math.max(0, ...(await tags(ctx)).map(entry => tagNumber(entry.tag))) + 1;
  }

  async function versions(ctx) {
    if (!await exists(path.join(ctx.repo, 'HEAD'))) return [];
    if (!(await git(ctx, ['for-each-ref', '--format=%(objectname)', REF])).toString().trim()) return [];
    const output = (await git(ctx, ['log', '--first-parent', '--format=%H%x00%B%x00', REF])).toString('utf8').split('\0');
    const result = [];
    for (let i = 0; i + 1 < output.length; i += 2) {
      const id = output[i].trim();
      if (id) result.push({ ...JSON.parse(output[i + 1]), id });
    }
    const savedTags = await tags(ctx);
    const occupied = new Set(savedTags.map(entry => entry.tag));
    // Upgrade existing V1/V2 history in place: keep its commits and store names in annotated tags.
    for (const version of [...result].reverse()) {
      let savedTag = savedTags.find(entry => entry.id === version.id && entry.tag === version.tag)
        || savedTags.find(entry => entry.id === version.id);
      const legacyAlias = version.label === `版本 ${version.number}` ? '' : version.label || '';
      if (!savedTag) {
        let number = version.number || 1;
        while (occupied.has(versionTag(number))) number++;
        const tag = versionTag(number);
        const tagId = await createTagObject(ctx, version.id, tag, legacyAlias, version.createdAt);
        await git(ctx, ['update-ref', `refs/tags/${tag}`, tagId, '0'.repeat(40)]);
        savedTag = { tag, id: version.id, alias: legacyAlias };
        savedTags.push(savedTag);
        occupied.add(tag);
      }
      version.tag = savedTag.tag;
      version.number = tagNumber(savedTag.tag);
      version.alias = savedTag.alias ?? legacyAlias;
      version.label = version.alias || version.tag;
    }
    return result;
  }

  async function requireVersion(ctx, id) {
    if (!/^[a-f0-9]{40}$/.test(id || '')) throw new Error('无效的版本。');
    const version = (await versions(ctx)).find(item => item.id === id);
    if (!version) throw new Error('工作区版本不存在。');
    return version;
  }

  async function files(ctx, id) {
    if (!id) return [];
    const output = (await git(ctx, ['ls-tree', '-r', '-z', '--long', id])).toString('utf8');
    return output.split('\0').filter(Boolean).map(line => {
      const separator = line.indexOf('\t');
      const [mode, type, oid, size] = line.slice(0, separator).trim().split(/\s+/);
      if (type !== 'blob' || !['100644', '100755'].includes(mode)) throw new Error('版本包含不支持的文件类型。');
      return { path: safePath(line.slice(separator + 1)), mode, oid, size: Number(size) };
    });
  }

  // Read the filesystem, rather than the Agent edit log, to include shell and external edits.
  async function scan(ctx, capture = false) {
    let staging;
    if (capture) { await fsp.mkdir(ctx.directory, { recursive: true, mode: 0o700 }); staging = await fsp.mkdtemp(path.join(ctx.directory, 'capture-')); }
    const entries = [];
    const excluded = [];
    let total = 0;
    async function walk(directory, prefix = '') {
      const names = (await fsp.readdir(directory)).sort();
      for (const name of names) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const absolute = path.join(directory, name);
        const stat = await fsp.lstat(absolute);
        const reason = name.toLowerCase() === '.git' || inside(storageRoot, absolute) ? '版本内部数据'
          : stat.isSymbolicLink() ? '符号链接'
          : stat.isDirectory() && OMIT_DIRS.has(name) ? '依赖或构建缓存'
          : /^\.env(?:\.|$)/.test(name) && !/\.(example|sample|template)$/.test(name) ? '环境配置'
          : !stat.isDirectory() && !stat.isFile() ? '特殊文件'
          : stat.isFile() && stat.size > MAX_FILE_BYTES ? '超过 50 MB' : '';
        if (reason) { excluded.push({ path: relative, reason }); continue; }
        safePath(relative);
        if (stat.isDirectory()) { await walk(absolute, relative); continue; }
        if (entries.length >= MAX_FILES || total + stat.size > MAX_TOTAL_BYTES) throw new Error('工作区超过版本管理上限（10,000 个文件或 512 MB），请缩小工作区范围。');
        if (!inside(ctx.root, await fsp.realpath(absolute))) throw new Error('文件路径发生变化，请稍后重试。');
        const handle = await fsp.open(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        let content;
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error('文件正在变化，请稍后重试。');
          content = await handle.readFile();
          const after = await handle.stat();
          if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || content.length !== stat.size) throw new Error('文件正在变化，请稍后重试。');
        } finally { await handle.close(); }
        total += content.length;
        const oid = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
        if (staging) await fsp.writeFile(path.join(staging, String(entries.length)), content);
        entries.push({ path: relative, oid, size: content.length, mode: stat.mode & 0o111 ? '100755' : '100644' });
      }
    }
    try { await walk(ctx.root); return { entries, excluded, staging }; }
    catch (error) { if (staging) await fsp.rm(staging, { recursive: true, force: true }); throw error; }
  }

  async function storeSnapshot(ctx, snapshot, label, kind, restoredFrom) {
    await initialize(ctx);
    const previous = (await versions(ctx))[0];
    const oldFiles = await files(ctx, previous?.id);
    const changes = changesBetween(oldFiles, snapshot.entries);
    if (changes.length === 0 && kind === 'manual') return { created: false, reason: 'unchanged', message: '没有文件变化，无需保存版本。' };
    if (previous && changes.length === 0 && kind === 'backup') return { version: previous, created: false };
    const index = path.join(ctx.directory, `index-${randomUUID()}`);
    try {
      if (snapshot.entries.length) {
        const output = (await git(ctx, ['hash-object', '-w', '--no-filters', '--stdin-paths'], {
          cwd: snapshot.staging,
          input: snapshot.entries.map((_, i) => `${i}\n`).join(''),
        })).toString('utf8').trim().split('\n');
        if (output.some((oid, i) => oid !== snapshot.entries[i]?.oid) || output.length !== snapshot.entries.length) throw new Error('文件校验失败，版本未保存。');
      }
      await git(ctx, ['read-tree', '--empty'], { index });
      if (snapshot.entries.length) await git(ctx, ['update-index', '-z', '--index-info'], {
        index, input: snapshot.entries.map(file => `${file.mode} ${file.oid}\t${file.path}\0`).join(''),
      });
      const tree = (await git(ctx, ['write-tree'], { index })).toString().trim();
      const number = await nextNumber(ctx);
      const tag = versionTag(number);
      const info = {
        number, tag,
        kind, createdAt: Date.now(), fileCount: snapshot.entries.length, changedFiles: changes.length,
        ...(restoredFrom ? { restoredFrom } : {}),
      };
      const id = (await git(ctx, ['commit-tree', tree, ...(previous ? ['-p', previous.id] : []), '-m', JSON.stringify(info)])).toString().trim();
      const tagId = await createTagObject(ctx, id, tag, label, info.createdAt);
      // Publish the commit and tag together; a tag collision cannot leave a partially saved version.
      await git(ctx, ['update-ref', '--stdin'], {
        input: `start\nupdate ${REF} ${id} ${previous?.id || '0'.repeat(40)}\ncreate refs/tags/${tag} ${tagId}\nprepare\ncommit\n`,
      });
      return { version: { ...info, id, alias: label, label: label || tag }, created: true };
    } finally { await fsp.rm(index, { force: true }); }
  }

  async function status(ctx) {
    const history = await versions(ctx);
    const snapshot = await scan(ctx);
    let interruptedRestore = null;
    if (await exists(ctx.journal)) interruptedRestore = JSON.parse(await fsp.readFile(ctx.journal, 'utf8'));
    return {
      workspace: ctx.root, versions: history, nextTag: versionTag(await nextNumber(ctx)), changes: changesBetween(await files(ctx, history[0]?.id), snapshot.entries),
      excluded: snapshot.excluded, fileCount: snapshot.entries.length, interruptedRestore,
    };
  }

  function fingerprint(snapshot, head, id) {
    return hash(JSON.stringify({ entries: snapshot.entries, excluded: snapshot.excluded, head, id }));
  }

  async function checkRestorePaths(ctx, target, current) {
    const currentPaths = new Set(current.entries.map(file => file.path));
    for (const file of target) {
      const parts = file.path.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const relative = parts.slice(0, i).join('/');
        const absolute = path.join(ctx.root, relative);
        if (!await exists(absolute)) continue;
        const stat = await fsp.lstat(absolute);
        if (stat.isSymbolicLink()) throw new Error(`无法恢复：${relative} 是符号链接。`);
        if (stat.isFile() && !currentPaths.has(relative)) throw new Error(`无法覆盖未纳入版本管理的文件：${relative}`);
        if (i === parts.length && stat.isDirectory()) {
          if (current.excluded.some(item => item.path.startsWith(`${relative}/`))) throw new Error(`目录 ${relative} 中有未纳入版本管理的内容，不能替换为文件。`);
        }
      }
    }
  }

  async function makePlan(ctx, id, snapshot) {
    const version = await requireVersion(ctx, id);
    const target = await files(ctx, id);
    await checkRestorePaths(ctx, target, snapshot);
    const head = (await versions(ctx))[0]?.id;
    return { version, changes: changesBetween(snapshot.entries, target), token: fingerprint(snapshot, head, id), excluded: snapshot.excluded };
  }

  async function verifySnapshot(ctx, snapshot) {
    assertIdle(ctx.root);
    const current = await scan(ctx);
    if (changesBetween(snapshot.entries, current.entries).length || JSON.stringify(snapshot.excluded) !== JSON.stringify(current.excluded)) {
      throw new Error('工作区文件正在变化，请等待写入结束后重试。');
    }
  }

  async function removeEmptyTree(directory) {
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) throw new Error('目录中出现了新的文件，恢复已停止。');
      await removeEmptyTree(path.join(directory, entry.name));
    }
    await fsp.rmdir(directory);
  }

  async function verifyFile(ctx, relative, expected) {
    const absolute = path.join(ctx.root, relative);
    const present = await exists(absolute);
    if (!present) {
      if (expected) throw new Error(`文件在恢复期间发生变化：${relative}`);
      return;
    }
    const stat = await fsp.lstat(absolute);
    if (stat.isDirectory() && !expected) return;
    if (!expected || !stat.isFile() || stat.size !== expected.size) throw new Error(`文件在恢复期间发生变化：${relative}`);
    const content = await fsp.readFile(absolute);
    const oid = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
    if (oid !== expected.oid) throw new Error(`文件在恢复期间发生变化：${relative}`);
  }

  async function apply(ctx, from, target, notify = true, applied = new Set()) {
    const changes = changesBetween(from, target);
    const fromMap = new Map(from.map(file => [file.path, file]));
    const targetMap = new Map(target.map(file => [file.path, file]));
    for (const change of changes.filter(item => item.status === 'deleted').sort((a, b) => b.path.length - a.path.length)) {
      if (notify) await beforeWrite?.(change.path);
      if (!inside(ctx.root, await fsp.realpath(path.dirname(path.join(ctx.root, change.path))))) throw new Error('恢复路径发生变化。');
      await verifyFile(ctx, change.path, fromMap.get(change.path));
      await fsp.unlink(path.join(ctx.root, change.path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      applied.add(change.path);
    }
    for (const change of changes.filter(item => item.status !== 'deleted')) {
      const file = targetMap.get(change.path);
      const destination = path.join(ctx.root, file.path);
      if (notify) await beforeWrite?.(file.path);
      // Recheck each parent immediately before writing; never follow a newly inserted symlink.
      for (let parent = path.dirname(destination); parent !== ctx.root; parent = path.dirname(parent)) {
        if (await exists(parent) && !(await fsp.lstat(parent)).isDirectory()) throw new Error(`恢复路径发生变化：${file.path}`);
      }
      await verifyFile(ctx, file.path, fromMap.get(file.path));
      if (await exists(destination)) {
        const stat = await fsp.lstat(destination);
        if (stat.isSymbolicLink()) throw new Error(`恢复路径发生变化：${file.path}`);
        if (stat.isDirectory()) await removeEmptyTree(destination);
      }
      await fsp.mkdir(path.dirname(destination), { recursive: true });
      const content = await git(ctx, ['cat-file', 'blob', file.oid], { maxBytes: MAX_FILE_BYTES + 1 });
      const temporary = path.join(path.dirname(destination), `.moss-restore-${randomUUID()}`);
      try {
        await fsp.writeFile(temporary, content, { flag: 'wx', mode: file.mode === '100755' ? 0o755 : 0o644 });
        await fsp.rename(temporary, destination);
        applied.add(file.path);
      } finally { await fsp.rm(temporary, { force: true }); }
    }
  }

  return {
    isActive(workspace) {
      try { const real = fs.realpathSync(workspace); const key = process.platform === 'win32' ? real.toLowerCase() : real; return [...active].some(root => inside(root, key) || inside(key, root)); } catch { return false; }
    },
    status: workspace => run(workspace, status),
    save: (workspace, label = '') => run(workspace, async ctx => {
      if (typeof label !== 'string' || label.length > 100) throw new Error('版本名称不能超过 100 个字符。');
      const snapshot = await scan(ctx, true);
      try { await verifySnapshot(ctx, snapshot); return await storeSnapshot(ctx, snapshot, label.trim(), 'manual'); }
      finally { await fsp.rm(snapshot.staging, { recursive: true, force: true }); }
    }, true),
    listFiles: (workspace, id) => run(workspace, async ctx => { await requireVersion(ctx, id); return files(ctx, id); }),
    previewRestore: (workspace, id) => run(workspace, async ctx => makePlan(ctx, id, await scan(ctx))),
    restore: (workspace, id, token) => run(workspace, async ctx => {
      const snapshot = await scan(ctx, true);
      try {
        const plan = await makePlan(ctx, id, snapshot);
        if (!token || token !== plan.token) throw new Error('工作区已发生变化，请重新查看恢复预览后再确认。');
        if (!plan.changes.length) {
          await fsp.rm(ctx.journal, { force: true });
          return { version: (await versions(ctx))[0] || plan.version, unchanged: true };
        }
        const target = await files(ctx, id);
        const backup = await storeSnapshot(ctx, snapshot, '恢复前自动备份', 'backup');
        await verifySnapshot(ctx, snapshot);
        await fsp.writeFile(ctx.journal, JSON.stringify({ backupId: backup.version.id, targetId: id, createdAt: Date.now() }));
        const applied = new Set();
        try {
          await apply(ctx, snapshot.entries, target, true, applied);
          const after = await scan(ctx, true);
          try {
            if (changesBetween(target, after.entries).length) throw new Error('恢复期间文件发生变化，请重试。');
            const result = await storeSnapshot(ctx, after, `从 ${plan.version.tag} 恢复`, 'restore', id);
            await fsp.rm(ctx.journal, { force: true }).catch(() => {});
            return { ...result, backupVersion: backup.version, changes: plan.changes };
          } finally { await fsp.rm(after.staging, { recursive: true, force: true }); }
        } catch (error) {
          try {
            const current = await scan(ctx);
            const original = new Map(snapshot.entries.map(file => [file.path, file]));
            const expected = new Map(target.map(file => [file.path, file]));
            const rollback = new Map(current.entries.map(file => [file.path, file]));
            // Undo only writes made by this restore. Preserve unrelated external edits.
            for (const filePath of applied) {
              await verifyFile(ctx, filePath, expected.get(filePath));
              if (original.has(filePath)) rollback.set(filePath, original.get(filePath));
              else rollback.delete(filePath);
            }
            const rollbackFiles = [...rollback.values()];
            await checkRestorePaths(ctx, rollbackFiles, current);
            await apply(ctx, current.entries, rollbackFiles, false);
            await fsp.rm(ctx.journal, { force: true });
          } catch {
            throw new Error(`恢复未完成，请从历史中的 ${backup.version.tag}「${backup.version.label}」恢复文件。原因：${error.message}`);
          }
          throw new Error(`恢复失败，已还原恢复前的文件：${error.message}`);
        }
      } finally { await fsp.rm(snapshot.staging, { recursive: true, force: true }); }
    }, true),
    contextNote: workspace => run(workspace, async ctx => {
      const latest = (await versions(ctx))[0];
      if (!latest) return '';
      return `工作区最近保存的版本是 ${latest.tag}${latest.alias ? `「${latest.alias}」` : ''}。当前磁盘文件可能还有后续修改。${latest.kind === 'restore' ? '用户已通过工作区版本管理恢复文件，之前对话中的文件内容可能过期；继续修改前请重新读取相关文件。' : ''}`;
    }),
    // Materialize an immutable revision outside the live workspace for the existing read-only viewers.
    previewFile: (workspace, id, filePath) => run(workspace, async ctx => {
      await requireVersion(ctx, id);
      const entries = await files(ctx, id);
      if (!entries.some(file => file.path === filePath)) throw new Error('该版本中没有此文件。');
      const previewRoot = path.join(ctx.directory, 'previews', id);
      if (!await exists(previewRoot)) {
        await fsp.mkdir(path.dirname(previewRoot), { recursive: true });
        const staging = await fsp.mkdtemp(path.join(ctx.directory, 'preview-'));
        try {
          for (const file of entries) {
            const destination = path.join(staging, file.path);
            await fsp.mkdir(path.dirname(destination), { recursive: true });
            await fsp.writeFile(destination, await git(ctx, ['cat-file', 'blob', file.oid], { maxBytes: MAX_FILE_BYTES + 1 }), { mode: 0o444 });
          }
          await fsp.rename(staging, previewRoot);
        } finally { await fsp.rm(staging, { recursive: true, force: true }); }
      }
      return { root: previewRoot, path: path.join(previewRoot, safePath(filePath)) };
    }),
  };
}
