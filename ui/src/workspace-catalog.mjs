import fsp from 'node:fs/promises';
import path from 'node:path';

const RECENT_WORKSPACES_FILE = '.recent.json';
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;
const MAX_NAME_LENGTH = 80;

function workspaceKey(workspacePath) {
  return path.resolve(workspacePath).normalize('NFKC').toLocaleLowerCase();
}

export function validateWorkspaceName(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new Error('工作空间名称不能为空');
  if (name.length > MAX_NAME_LENGTH) throw new Error(`工作空间名称不能超过 ${MAX_NAME_LENGTH} 个字符`);
  if (name === '.' || name === '..' || /[<>:"/\\|?*\u0000-\u001f]/u.test(name)) {
    throw new Error('工作空间名称不能包含路径或特殊字符');
  }
  if (/[. ]$/u.test(name)) throw new Error('工作空间名称不能以空格或句点结尾');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(name)) {
    throw new Error('该名称不能用作工作空间名称');
  }
  return name;
}

export function createWorkspaceCatalog(rootDir, { now = () => Date.now() } = {}) {
  const root = path.resolve(rootDir);
  const recentFile = path.join(root, RECENT_WORKSPACES_FILE);

  const ensureRoot = () => fsp.mkdir(root, { recursive: true });

  const readRecent = async () => {
    try {
      const parsed = JSON.parse(await fsp.readFile(recentFile, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((entry) => {
        const workspacePath = typeof entry?.path === 'string' ? entry.path.trim() : '';
        const updatedAt = Number(entry?.updatedAt);
        return workspacePath && Number.isFinite(updatedAt)
          ? [{ path: path.resolve(workspacePath), updatedAt }]
          : [];
      });
    } catch {
      return [];
    }
  };

  const writeRecent = async (entries) => {
    await ensureRoot();
    const temporaryFile = `${recentFile}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(temporaryFile, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
    await fsp.rename(temporaryFile, recentFile);
  };

  const touch = async (workspacePath) => {
    const requestedPath = String(workspacePath || '').trim();
    if (!requestedPath) throw new Error('工作空间路径不能为空');
    const resolved = path.resolve(requestedPath);
    const stat = await fsp.stat(resolved);
    if (!stat.isDirectory()) throw new Error('所选路径不是文件夹');
    const recent = await readRecent();
    const key = workspaceKey(resolved);
    const next = [
      { path: resolved, updatedAt: now() },
      ...recent.filter((entry) => workspaceKey(entry.path) !== key),
    ].slice(0, MAX_LIMIT);
    await writeRecent(next);
    return {
      name: path.basename(resolved),
      path: resolved,
      updatedAt: next[0].updatedAt,
      managed: path.dirname(resolved) === root,
    };
  };

  const create = async (value) => {
    const name = validateWorkspaceName(value);
    await ensureRoot();
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const duplicate = entries.some((entry) => (
      entry.name !== RECENT_WORKSPACES_FILE
      && entry.name.normalize('NFKC').toLocaleLowerCase() === name.normalize('NFKC').toLocaleLowerCase()
    ));
    if (duplicate) throw new Error('已存在同名工作空间');

    const workspacePath = path.join(root, name);
    try {
      await fsp.mkdir(workspacePath, { recursive: false });
    } catch (error) {
      if (error?.code === 'EEXIST') throw new Error('已存在同名工作空间');
      throw error;
    }
    return touch(workspacePath);
  };

  const list = async ({ query = '', limit = DEFAULT_LIMIT } = {}) => {
    await ensureRoot();
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase();
    const normalizedLimit = Math.max(1, Math.min(MAX_LIMIT, Number(limit) || DEFAULT_LIMIT));
    const recent = await readRecent();
    const recentByPath = new Map(recent.map((entry) => [workspaceKey(entry.path), entry.updatedAt]));
    const candidates = new Map();

    const managedEntries = await fsp.readdir(root, { withFileTypes: true });
    await Promise.all(managedEntries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const workspacePath = path.join(root, entry.name);
      try {
        const stat = await fsp.stat(workspacePath);
        candidates.set(workspaceKey(workspacePath), {
          name: entry.name,
          path: workspacePath,
          updatedAt: recentByPath.get(workspaceKey(workspacePath)) ?? stat.mtimeMs,
          managed: true,
        });
      } catch {}
    }));

    await Promise.all(recent.map(async (entry) => {
      const key = workspaceKey(entry.path);
      if (candidates.has(key)) return;
      try {
        const stat = await fsp.stat(entry.path);
        if (!stat.isDirectory()) return;
        candidates.set(key, {
          name: path.basename(entry.path),
          path: entry.path,
          updatedAt: entry.updatedAt,
          managed: false,
        });
      } catch {}
    }));

    return Array.from(candidates.values())
      .filter((entry) => !normalizedQuery || `${entry.name}\n${entry.path}`.toLocaleLowerCase().includes(normalizedQuery))
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .slice(0, normalizedLimit);
  };

  return Object.freeze({ root, create, list, touch });
}
