import fsp from 'node:fs/promises';
import path from 'node:path';

import { createDesktopDataPaths } from './desktop-data-layout.mjs';

const MAX_MEMORY_FILE_BYTES = 512 * 1024;
const MAX_MEMORY_FILES = 500;
const FRONTMATTER_HEAD_BYTES = 64 * 1024;

function normalizeId(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

function normalizeMarkdownPath(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/\\/g, '/') : '';
  const parts = normalized.split('/');
  if (
    !normalized
    || normalized.length > 4096
    || path.posix.isAbsolute(normalized)
    || path.win32.isAbsolute(normalized)
    || !normalized.toLowerCase().endsWith('.md')
    || parts.some((part) => !part || part === '.' || part === '..' || part.length > 255)
  ) {
    throw new Error('Invalid memory path.');
  }
  return parts.join('/');
}

function stripQuotes(value) {
  const text = String(value || '').trim();
  if (
    text.length >= 2
    && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}

export function parseMemoryDocumentHead(raw, relativePath) {
  const content = typeof raw === 'string' ? raw : '';
  const metadata = {};
  let body = content;
  if (content.startsWith('---\n') || content.startsWith('---\r\n')) {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (match) {
      for (const line of match[1].split(/\r?\n/)) {
        const field = line.match(/^([a-zA-Z][\w-]*):\s*(.*)$/);
        if (!field) continue;
        metadata[field[1].toLowerCase()] = stripQuotes(field[2]);
      }
      body = content.slice(match[0].length);
    }
  }
  const isIndex = relativePath === 'MEMORY.md';
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || '';
  const fileName = path.posix.basename(relativePath, path.posix.extname(relativePath));
  return {
    title: isIndex ? '记忆索引' : metadata.name || heading || fileName,
    description: metadata.description || '',
    type: isIndex ? 'index' : metadata.type || 'memory',
    isIndex,
  };
}

export function parseMemoryIndexPaths(raw) {
  const content = typeof raw === 'string' ? raw : '';
  const paths = new Set();
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)\r\n]+)\)/g)) {
    let target = String(match[1] || '').trim();
    if (target.startsWith('<') && target.endsWith('>')) {
      target = target.slice(1, -1).trim();
    } else {
      target = target.replace(/\s+["'].*$/, '').trim();
    }
    target = target.replace(/^\.\/+/, '');
    try {
      paths.add(normalizeMarkdownPath(target));
    } catch {}
  }
  return paths;
}

async function readFileHead(filePath, limit = FRONTMATTER_HEAD_BYTES) {
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    const { bytesRead } = await handle.read(buffer, 0, limit, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

async function fileMetadata(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return null;
    return {
      bytes: stat.size,
      updatedAt: stat.mtimeMs,
      readable: stat.size <= MAX_MEMORY_FILE_BYTES,
    };
  } catch {
    return null;
  }
}

async function listGlobalMemoryFiles(root) {
  const result = [];
  let indexedPaths = new Set();
  try {
    indexedPaths = parseMemoryIndexPaths(await readFileHead(path.join(root, 'MEMORY.md')));
  } catch {}

  async function walk(directory, prefix = '') {
    if (result.length >= MAX_MEMORY_FILES) return;
    let entries = [];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    for (const entry of entries) {
      if (result.length >= MAX_MEMORY_FILES) break;
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const metadata = await fileMetadata(fullPath);
      if (!metadata) continue;
      let document = parseMemoryDocumentHead('', relativePath);
      if (metadata.readable) {
        try {
          document = parseMemoryDocumentHead(await readFileHead(fullPath), relativePath);
        } catch {}
      }
      result.push({
        id: relativePath,
        path: relativePath,
        ...document,
        indexed: document.isIndex || indexedPaths.has(relativePath),
        ...metadata,
      });
    }
  }

  await walk(root);
  return result.sort((a, b) => {
    if (a.isIndex !== b.isIndex) return a.isIndex ? -1 : 1;
    if (a.indexed !== b.indexed) return a.indexed ? -1 : 1;
    return b.updatedAt - a.updatedAt || a.title.localeCompare(b.title, 'zh-CN');
  });
}

function getSessionMemoryPath(paths, session) {
  if (!session?.id || !session?.sessionId || session.agentMode === 'remote-direct') return null;
  const transcriptPath = paths.sessionTranscriptPath(session.id, session.sessionId);
  return path.join(
    path.dirname(transcriptPath),
    path.basename(transcriptPath, path.extname(transcriptPath)),
    'session-memory',
    'summary.md',
  );
}

async function listProjectHistory(paths, projectId, sessionsById) {
  const directory = path.join(paths.projectDir(projectId), 'memory', 'sessions');
  let entries = [];
  try {
    entries = await fsp.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const history = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const sessionId = entry.name.slice(0, -3);
    try {
      normalizeId(sessionId, 'session id');
    } catch {
      continue;
    }
    const metadata = await fileMetadata(path.join(directory, entry.name));
    if (!metadata) continue;
    const session = sessionsById.get(sessionId);
    history.push({
      id: sessionId,
      sessionId,
      title: session?.title || '项目会话沉淀',
      conclusion: session?.projectConclusion || '',
      ...metadata,
    });
  }
  return history.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readBoundedMarkdown(filePath) {
  const metadata = await fileMetadata(filePath);
  if (!metadata) throw new Error('记忆内容不存在。');
  if (!metadata.readable) throw new Error('记忆内容超过 512 KB，无法在应用内展示。');
  const content = await fsp.readFile(filePath, 'utf8');
  if (Buffer.byteLength(content, 'utf8') > MAX_MEMORY_FILE_BYTES) {
    throw new Error('记忆内容在读取时发生变化，请刷新后重试。');
  }
  return { content, ...metadata };
}

async function resolveExistingFileWithin(root, relativePath) {
  const resolvedRoot = await fsp.realpath(root);
  const candidate = path.resolve(root, relativePath);
  const resolvedCandidate = await fsp.realpath(candidate);
  const boundary = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (!resolvedCandidate.startsWith(boundary)) {
    throw new Error('记忆路径超出允许范围。');
  }
  return resolvedCandidate;
}

export function createMemoryCatalog({
  mossHome,
  listProjects,
  getProjectMemory,
  listSessions,
  getRemoteMemoryCatalog,
  readRemoteGlobalMemory,
  readRemoteSessionMemory,
}) {
  const paths = createDesktopDataPaths(mossHome);
  const globalMemoryRoot = path.join(paths.home, 'memory');

  async function getCatalog() {
    const [localGlobalFiles, projects, sessions, remoteCatalog] = await Promise.all([
      listGlobalMemoryFiles(globalMemoryRoot),
      Promise.resolve(listProjects()),
      Promise.resolve(listSessions()),
      typeof getRemoteMemoryCatalog === 'function'
        ? Promise.resolve(getRemoteMemoryCatalog()).catch(() => null)
        : null,
    ]);
    const visibleSessions = Array.isArray(sessions) ? sessions : [];
    const sessionsById = new Map(visibleSessions.map((session) => [session.id, session]));
    const remoteGlobalFiles = Array.isArray(remoteCatalog?.global?.files)
      ? remoteCatalog.global.files.map((entry) => ({
          ...entry,
          id: `remote:${entry.id || entry.path}`,
          source: 'remote',
        }))
      : [];
    const globalFiles = [
      ...localGlobalFiles.map((entry) => ({ ...entry, source: 'local' })),
      ...remoteGlobalFiles,
    ];
    const remoteSessionsById = new Map(
      (Array.isArray(remoteCatalog?.sessions) ? remoteCatalog.sessions : [])
        .map((entry) => [entry?.sessionId, entry]),
    );

    const projectEntries = await Promise.all((Array.isArray(projects) ? projects : []).map(async (project) => {
      const projectId = normalizeId(project.id, 'project id');
      const [memory, history] = await Promise.all([
        getProjectMemory(projectId),
        listProjectHistory(paths, projectId, sessionsById),
      ]);
      return {
        id: projectId,
        name: project.name,
        updatedAt: project.updatedAt,
        version: memory.version,
        memoryUpdatedAt: memory.updatedAt,
        finalizedSessionCount: memory.finalizedSessionCount,
        hasOverview: Boolean(memory.overview?.trim()),
        history,
      };
    }));

    const sessionEntries = await Promise.all(visibleSessions
      .filter((session) => !session.isSubAgent)
      .map(async (session) => {
        let metadata = null;
        let summaryPath = null;
        if (session.agentMode === 'remote-direct') {
          metadata = remoteSessionsById.get(session.sessionId) || null;
        } else {
          try {
            summaryPath = getSessionMemoryPath(paths, session);
            metadata = summaryPath ? await fileMetadata(summaryPath) : null;
          } catch {}
        }
        return {
          id: session.id,
          title: session.title,
          projectId: session.projectId || null,
          projectName: session.projectName || null,
          agentMode: session.agentMode === 'remote-direct' ? 'remote-direct' : 'local',
          busy: Boolean(session.busy),
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          hasSummary: session.agentMode === 'remote-direct'
            ? metadata?.exists === true
            : Boolean(metadata),
          summaryUpdatedAt: metadata?.updatedAt || null,
          bytes: metadata?.bytes || 0,
          readable: metadata?.readable ?? true,
        };
      }));

    return {
      generatedAt: Date.now(),
      global: {
        rootLabel: remoteCatalog
          ? '~/.moss/memory + Moss Server / memory'
          : '~/.moss/memory',
        files: globalFiles,
      },
      projects: projectEntries.sort((a, b) => (b.memoryUpdatedAt || b.updatedAt) - (a.memoryUpdatedAt || a.updatedAt)),
      sessions: sessionEntries.sort((a, b) => (b.summaryUpdatedAt || b.updatedAt) - (a.summaryUpdatedAt || a.updatedAt)),
    };
  }

  async function readEntry(payload = {}) {
    if (payload.scope === 'global') {
      const relativePath = normalizeMarkdownPath(payload.path);
      if (payload.source === 'remote') {
        if (typeof readRemoteGlobalMemory !== 'function') {
          throw new Error('远程记忆不可用。');
        }
        return readRemoteGlobalMemory(relativePath);
      }
      const filePath = await resolveExistingFileWithin(globalMemoryRoot, relativePath);
      return readBoundedMarkdown(filePath);
    }

    if (payload.scope === 'project') {
      const projectId = normalizeId(payload.projectId, 'project id');
      if (payload.kind === 'overview') {
        const memory = await getProjectMemory(projectId);
        return {
          content: memory.overview || '',
          updatedAt: memory.updatedAt,
          bytes: Buffer.byteLength(memory.overview || '', 'utf8'),
          readable: true,
        };
      }
      const sessionId = normalizeId(payload.sessionId, 'session id');
      const projectSessionsRoot = path.join(paths.projectDir(projectId), 'memory', 'sessions');
      const filePath = await resolveExistingFileWithin(projectSessionsRoot, `${sessionId}.md`);
      return readBoundedMarkdown(filePath);
    }

    if (payload.scope === 'session') {
      const sessionId = normalizeId(payload.sessionId, 'session id');
      const session = (await Promise.resolve(listSessions())).find((entry) => entry.id === sessionId);
      if (!session) throw new Error('会话不存在。');
      if (session.agentMode === 'remote-direct') {
        if (!session.sessionId || typeof readRemoteSessionMemory !== 'function') {
          throw new Error('远程会话摘要尚未同步到本机。');
        }
        const result = await readRemoteSessionMemory(session.sessionId);
        if (!result?.exists) throw new Error('该会话尚未生成摘要。');
        return result;
      }
      const summaryPath = getSessionMemoryPath(paths, session);
      if (!summaryPath) throw new Error('该会话尚未生成摘要。');
      const engineRoot = paths.sessionEngineDir(session.id);
      const filePath = await resolveExistingFileWithin(engineRoot, path.relative(engineRoot, summaryPath));
      return readBoundedMarkdown(filePath);
    }

    throw new Error('Invalid memory scope.');
  }

  return { getCatalog, readEntry };
}
