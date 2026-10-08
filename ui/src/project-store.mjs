import fsp from 'node:fs/promises';
import path from 'node:path';
import { withDesktopProjectLayout } from './desktop-data-layout.mjs';
import { normalizeProjectId, normalizeProjectRecord, normalizeProjectMemoryIndex } from './shared/project-normalization.mjs';
import { normalizeStringList } from './shared/string-list.mjs';
import { readJsonFile, readJsonFileAsync, writeJsonFileAsync, writeJsonFileAtomicAsync } from './shared/json-files.mjs';
import { runInKeyedQueue } from './shared/keyed-queue.mjs';

const PROJECT_FILE_NAME = 'project.json';

const PROJECT_ASSET_INDEX_NAME = 'assets.json';

const PROJECT_EVENT_INDEX_NAME = 'events.json';

const PROJECT_DECISION_INDEX_NAME = 'decisions.json';

const PROJECT_MEMORY_INDEX_NAME = 'index.json';

const PROJECT_MEMORY_OVERVIEW_NAME = 'overview.md';

const PROJECT_RUNTIME_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

const PROJECT_RUNTIME_RUN_LIMIT = 50;

/** Project files; all record writers share the queue owned by Main. */
export function createProjectStore({
  DESKTOP_DATA_PATHS,
  projectRecordQueues,
  mossLog,
}) {
  function getProjectDir(projectId) {
    return DESKTOP_DATA_PATHS.projectDir(normalizeProjectId(projectId));
  }

  function getProjectFilePath(projectId) {
    return path.join(getProjectDir(projectId), PROJECT_FILE_NAME);
  }

  function getProjectWorkspaceDir(projectId) {
    return DESKTOP_DATA_PATHS.projectWorkspaceDir(normalizeProjectId(projectId));
  }

  function getProjectAssetsDir(projectId) {
    return getProjectWorkspaceDir(projectId);
  }

  function getProjectAssetIndexPath(projectId) {
    return path.join(getProjectDir(projectId), PROJECT_ASSET_INDEX_NAME);
  }

  function getProjectEventIndexPath(projectId) {
    return path.join(getProjectDir(projectId), PROJECT_EVENT_INDEX_NAME);
  }

  function getProjectDecisionIndexPath(projectId) {
    return path.join(getProjectDir(projectId), PROJECT_DECISION_INDEX_NAME);
  }

  function getProjectMemoryDir(projectId) {
    return path.join(getProjectDir(projectId), 'memory');
  }

  function getProjectMemoryIndexPath(projectId) {
    return path.join(getProjectMemoryDir(projectId), PROJECT_MEMORY_INDEX_NAME);
  }

  function getProjectMemoryOverviewPath(projectId) {
    return path.join(getProjectMemoryDir(projectId), PROJECT_MEMORY_OVERVIEW_NAME);
  }

  function getProjectMemorySessionsDir(projectId) {
    return path.join(getProjectMemoryDir(projectId), 'sessions');
  }

  function getProjectSessionMemoryPath(projectId, sessionId) {
    return path.join(getProjectMemorySessionsDir(projectId), `${sessionId}.md`);
  }

  function getProjectSessionFinalizerResultPath(projectId, sessionId) {
    return path.join(getProjectMemorySessionsDir(projectId), `${sessionId}.json`);
  }

  function getProjectRunsDir(projectId) {
    return DESKTOP_DATA_PATHS.projectRunsDir(normalizeProjectId(projectId));
  }

  async function pruneProjectRuntimeRuns(projectId, now = Date.now()) {
    const runsDir = getProjectRunsDir(projectId);
    let entries = [];
    try {
      entries = await fsp.readdir(runsDir, { withFileTypes: true });
    } catch {
      return;
    }
    const runs = (await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const runPath = path.join(runsDir, entry.name);
        const stat = await fsp.stat(runPath).catch(() => null);
        return stat ? { path: runPath, mtimeMs: stat.mtimeMs } : null;
      })))
      .filter(Boolean)
      .sort((left, right) => right.mtimeMs - left.mtimeMs);
    await Promise.all(runs
      .filter((run, index) => (
        index >= PROJECT_RUNTIME_RUN_LIMIT || now - run.mtimeMs > PROJECT_RUNTIME_RUN_RETENTION_MS
      ))
      .map((run) => fsp.rm(run.path, { recursive: true, force: true })));
  }

  function getProjectSessionsDir(projectId) {
    return path.join(getProjectDir(projectId), 'sessions');
  }

  function readProjectSync(projectId) {
    try {
      const id = normalizeProjectId(projectId);
      return normalizeProjectRecord(readJsonFile(getProjectFilePath(id), null), id);
    } catch {
      return null;
    }
  }

  async function readProject(projectId) {
    const id = normalizeProjectId(projectId);
    return normalizeProjectRecord(await readJsonFileAsync(getProjectFilePath(id), null), id);
  }

  async function writeProject(project) {
    const next = withDesktopProjectLayout(project);
    await writeJsonFileAtomicAsync(getProjectFilePath(next.id), next);
    return next;
  }

  async function ensureProjectStructure(projectId) {
    const projectDir = getProjectDir(projectId);
    await Promise.all([
      fsp.mkdir(projectDir, { recursive: true }),
      fsp.mkdir(getProjectMemoryDir(projectId), { recursive: true }),
      fsp.mkdir(getProjectMemorySessionsDir(projectId), { recursive: true }),
      fsp.mkdir(getProjectAssetsDir(projectId), { recursive: true }),
      fsp.mkdir(getProjectSessionsDir(projectId), { recursive: true }),
      fsp.mkdir(getProjectRunsDir(projectId), { recursive: true }),
    ]);
  }

  async function mutateProjectRecord(projectId, mutation) {
    const id = normalizeProjectId(projectId);
    return runInKeyedQueue(projectRecordQueues, id, async () => {
      const existing = await readProject(id);
      if (!existing) throw new Error('Project not found.');
      const next = normalizeProjectRecord(await mutation(existing), id);
      if (!next) throw new Error('Invalid project update.');
      await writeProject(next);
      return next;
    });
  }

  async function touchProject(projectId, timestamp = Date.now()) {
    return mutateProjectRecord(projectId, (project) => ({
      ...project,
      updatedAt: Math.max(project.updatedAt || 0, timestamp),
    }));
  }

  async function touchProjectBestEffort(projectId, timestamp = Date.now(), reason = 'update') {
    try {
      return await touchProject(projectId, timestamp);
    } catch (error) {
      mossLog('warn', 'project', 'Unable to update project timestamp after primary write', {
        projectId,
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async function getProjectMemory(projectId) {
    const id = normalizeProjectId(projectId);
    await ensureProjectStructure(id);
    const index = normalizeProjectMemoryIndex(await readJsonFileAsync(getProjectMemoryIndexPath(id), null));
    let overview = '';
    try {
      overview = (await fsp.readFile(getProjectMemoryOverviewPath(id), 'utf8')).trim();
    } catch {}
    return {
      ...index,
      overview,
      overviewPath: getProjectMemoryOverviewPath(id),
    };
  }

  function getProjectSessionFinalizerResultSync(projectId, sessionId) {
    const raw = readJsonFile(getProjectSessionFinalizerResultPath(projectId, sessionId), null);
    if (!raw || typeof raw !== 'object') return null;
    return {
      completedAt: Number.isFinite(raw.completedAt) ? raw.completedAt : null,
      conclusion: typeof raw.conclusion === 'string' ? raw.conclusion : '',
      memoryVersion: Number.isFinite(raw.memoryVersion) ? raw.memoryVersion : 0,
      assetIds: normalizeStringList(raw.assetIds),
      result: raw.result && typeof raw.result === 'object' ? raw.result : null,
    };
  }

  async function linkSessionToProject(projectId, sessionRecord) {
    await ensureProjectStructure(projectId);
    await writeJsonFileAsync(path.join(getProjectSessionsDir(projectId), `${sessionRecord.id}.json`), {
      sessionId: sessionRecord.id,
      boundAt: Date.now(),
    });
  }

  async function unlinkSessionFromProject(projectId, sessionId) {
    try {
      await fsp.unlink(path.join(getProjectSessionsDir(projectId), `${sessionId}.json`));
    } catch {}
  }

  return {
    ensureProjectStructure,
    linkSessionToProject,
    unlinkSessionFromProject,
    getProjectAssetIndexPath,
    getProjectAssetsDir,
    getProjectDecisionIndexPath,
    getProjectDir,
    getProjectEventIndexPath,
    getProjectMemory,
    getProjectMemoryIndexPath,
    getProjectMemoryOverviewPath,
    getProjectRunsDir,
    getProjectSessionFinalizerResultPath,
    getProjectSessionFinalizerResultSync,
    getProjectSessionMemoryPath,
    getProjectSessionsDir,
    getProjectWorkspaceDir,
    mutateProjectRecord,
    pruneProjectRuntimeRuns,
    readProject,
    readProjectSync,
    touchProjectBestEffort,
    writeProject,
  };
}
