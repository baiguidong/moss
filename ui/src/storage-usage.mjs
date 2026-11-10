import fs from 'node:fs/promises';
import path from 'node:path';

const groups = [
  { id: 'sessions', label: '会话与文件', roots: ['sessions', 'session-env', 'shell-snapshots', 'presentations', 'history.jsonl', 'sessions.db'] },
  { id: 'subagents', label: '子会话', roots: [] },
  { id: 'archived', label: '已归档会话', roots: [] },
  { id: 'projects', label: '项目与工作区', roots: ['projects', 'workspace', 'workspaces', 'app-projects', 'app-authoring', 'app-build', 'bundled-apps-workspace', 'artifacts', 'self-tests', 'minimal-go-agent'] },
  // App packages are downloaded/rebuildable artifacts. Keep them in the cache
  // category so storage users can distinguish them from App-owned data.
  { id: 'app-data', label: '应用数据', roots: ['apps-data', 'apps-runtime', 'app-tasks', 'browser-profiles', 'dbx-mcp'] },
  { id: 'runtimes', label: '运行环境', roots: ['runtimes', 'server'] },
  { id: 'resources', label: '资源与记忆', roots: ['skills', 'assistants', 'agents', 'connectors', 'expert-hub', 'library', 'knowledge', 'local-kb', 'memory', 'workflows', 'plans', 'teams', 'tasks'] },
  { id: 'cache', label: '缓存与可重建内容', roots: ['cache', '.cache', 'caches', 'apps', 'generated-apps', 'generated-app-data', 'app-authoring-previews', 'cloud-transfers', 'app-market', 'mcp', 'browser-binaries', 'whisper-models'] },
  { id: 'history', label: '历史版本', roots: ['workspace-versions', 'turn-observations', 'preview-drafts', 'backups', 'file-history'] },
  { id: 'logs', label: '日志', roots: ['logs', 'debug', 'traces', 'startup-perf', 'desktop-dev.log'] },
  { id: 'other', label: '数据库与其他', roots: [] },
];
const rootGroups = new Map(groups.flatMap(group => group.roots.map(root => [root, group.id])));

function classify(relative, sessionKinds) {
  const parts = relative.split(path.sep), top = parts[0];
  const knownGroup = rootGroups.get(top);
  // A top-level Moss directory is the unit of accounting. Once it has been
  // assigned to a group, nested folders named `cache` must stay with it so a
  // single directory never appears in multiple categories.
  if (knownGroup) {
    if (top === 'sessions' && parts[1] && sessionKinds.has(parts[1])) return { id: sessionKinds.get(parts[1]), entry: `sessions/${parts[1]}` };
    if (top === 'dbx-mcp') return { id: knownGroup, entry: 'moss.dbx (dbx-mcp)' };
    if (['apps', 'generated-apps', 'apps-data', 'apps-runtime', 'app-tasks', 'browser-profiles'].includes(top) && parts[1]) {
      return { id: knownGroup, entry: `${top}/${parts[1]}` };
    }
    return { id: knownGroup, entry: top || '.' };
  }
  // Unknown roots remain visible under Other, including their nested folders.
  return { id: 'other', entry: top || '.' };
}

// Bounded I/O concurrency, without a file-count or elapsed-time cutoff. In a large
// profile apps must not consume a global budget before sessions are even visited.
export async function measureStorage(root, { fileSystem = fs, concurrency = 32, sessionKinds = new Map() } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid scan concurrency');
  const categories = new Map(groups.map(({ id, label }) => [id, { id, label, bytes: 0, complete: true, entries: new Map() }]));
  const pending = [root], inodes = new Set();
  let active = 0, errorCount = 0, allocated = true;
  function entryFor(target) {
    const relative = path.relative(root, target);
    const { id, entry } = classify(relative, sessionKinds), category = categories.get(id);
    // The category total includes directory metadata, but the UI should show
    // concrete children rather than an extra aggregate row such as `apps` or
    // `apps-data`.
    if (!relative.includes(path.sep) && rootGroups.has(relative)) return { category, entry: null };
    if (!category.entries.has(entry)) category.entries.set(entry, { path: entry, bytes: 0, complete: true });
    return { category, entry: category.entries.get(entry) };
  }
  await new Promise(resolve => {
    const pump = () => {
      while (active < concurrency && pending.length) {
        const target = pending.pop();
        active++;
        void (async () => {
          try {
            const stat = await fileSystem.lstat(target);
            const { category, entry } = entryFor(target);
            let bytes = typeof stat.blocks === 'number' ? stat.blocks * 512 : stat.size;
            if (typeof stat.blocks !== 'number') allocated = false;
            if (stat.isFile() && stat.nlink > 1) {
              const identity = `${stat.dev}:${stat.ino}`;
              if (inodes.has(identity)) bytes = 0;
              else inodes.add(identity);
            }
            category.bytes += bytes; if (entry) entry.bytes += bytes;
            if (stat.isDirectory() && !stat.isSymbolicLink()) {
              const names = await fileSystem.readdir(target);
              for (const name of names) pending.push(path.join(target, name));
            }
          } catch (error) {
            // Caches and log files can disappear during a scan. A disappeared
            // child no longer occupies space; an unreadable directory is partial.
            if (target !== root && ['ENOENT', 'ENOTDIR'].includes(error.code)) return;
            errorCount++;
            const { category, entry } = entryFor(target);
            category.complete = false;
            if (entry) entry.complete = false;
            if (target === root) for (const category of categories.values()) category.complete = false;
          }
        })().finally(() => { active--; pump(); });
      }
      if (!active && !pending.length) resolve();
    };
    pump();
  });
  const result = [...categories.values()].map(category => ({ ...category,
    entries: [...category.entries.values()].sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path)),
  }));
  return { root, categories: result, totalBytes: result.reduce((sum, item) => sum + item.bytes, 0),
    complete: errorCount === 0, errorCount, sizeKind: allocated ? 'allocated' : 'logical' };
}
