import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import lockfile from 'proper-lockfile';
import { normalizeProjectId } from './shared/project-normalization.mjs';
import { redactProjectMemorySecrets } from './shared/project-memory.mjs';
import { readJsonFileAsync, writeJsonFileAtomicAsync, writeTextFileAtomicAsync } from './shared/json-files.mjs';
import { projectMemoryExtractionPrompt, projectMemoryConsolidationPrompt, parseProjectMemoryJson } from './shared/project-memory-prompts.mjs';

const HOUR = 60 * 60 * 1000;
export const PROJECT_MEMORY_DEFAULTS = { idleMs: 6 * HOUR, cooldownMs: 6 * HOUR, retryMs: 60_000, maxAgeMs: 10 * 24 * HOUR, batchSize: 2 };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const safeId = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid memory source id.');
  return value;
};
const memoryAssets = assets => assets.map(asset => ({ id: asset.id, name: asset.name, sourceSessionId: asset.sourceSessionId,
  path: asset.path, contentHash: asset.contentHash, description: String(asset.description || '').slice(0, 1000) }))
  .sort((a, b) => a.id.localeCompare(b.id));
// Bounded incremental folds preserve complete records without putting all history in one request.
function batches(records, budget = 26000) {
  const result = [];
  let batch = [], size = 0;
  for (const record of records) {
    const length = JSON.stringify(record).length;
    if (batch.length && size + length > budget) { result.push(batch); batch = []; size = 0; }
    batch.push(record); size += length;
  }
  if (batch.length) result.push(batch);
  return result;
}

/** Project-scoped extraction and consolidation; never owns the source session runtime. */
export function createProjectMemoryService({
  getProjectDir, readProject, listSources, readSource, getMemory, listAssets = async () => [],
  readAssetsForCommit = listAssets,
  withProjectCommit = async (_id, commit) => commit(),
  query, getLanguage = () => 'chinese', onChanged = () => {}, now = Date.now, options = {},
}) {
  const config = { ...PROJECT_MEMORY_DEFAULTS, ...options };
  const running = new Map(), timers = new Map(), statuses = new Map();
  let stopped = false;
  const root = id => path.join(getProjectDir(normalizeProjectId(id)), 'memory');
  const statePath = id => path.join(root(id), 'maintenance.json');
  const loadState = async id => {
    const [state, snapshot] = await Promise.all([readJsonFileAsync(statePath(id), {}), readJsonFileAsync(path.join(root(id), 'snapshot.json'), {})]);
    return (snapshot.updatedAt || 0) > (state.lastRunAt || 0)
      ? { ...state, fingerprint: snapshot.fingerprint, lastRunAt: snapshot.updatedAt, nextRunAt: snapshot.updatedAt + config.cooldownMs, failures: 0, error: '' }
      : state;
  };
  const notify = id => { try { onChanged(id); } catch { /* Observers cannot fail a commit. */ } };
  const setStatus = (id, status) => { statuses.set(id, status); notify(id); };
  const membersOf = sources => sources.filter(source => !source.deleted && !source.isSubAgent);

  async function projectFor(id) {
    const project = await readProject(id);
    if (!project || project.archivedAt) throw new Error('Project not found.');
    return project;
  }

  async function readRecords(id, directory) {
    let entries;
    try { entries = await fs.readdir(path.join(root(id), directory), { withFileTypes: true }); } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const value = await readJsonFileAsync(path.join(root(id), directory, entry.name), null);
      if (value && typeof value === 'object') records.push(value);
    }
    return records;
  }
  const readNotes = async id => (await readRecords(id, 'notes')).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));

  async function getStatus(projectId) {
    const id = normalizeProjectId(projectId);
    await projectFor(id);
    const state = await loadState(id);
    return { phase: state.error || state.sourceError ? 'failed' : 'idle', message: '', lastRunAt: state.lastRunAt || null,
      nextRunAt: state.nextRunAt || null, error: state.error || state.sourceError || '', ...statuses.get(id) };
  }

  function schedule(id, delayMs) {
    if (stopped) return;
    const delay = Math.min(Math.max(1000, delayMs), 2 ** 31 - 1);
    if (timers.get(id)?.due <= now() + delay) return;
    clearTimeout(timers.get(id)?.timer);
    const timer = setTimeout(() => { timers.delete(id); void run(id).catch(() => {}); }, delay);
    timer.unref?.();
    timers.set(id, { timer, due: now() + delay });
  }

  async function consider(projectId, excludeSessionId = null) {
    const id = normalizeProjectId(projectId);
    const project = await readProject(id);
    if (stopped || !project || project.archivedAt) return;
    const [sources, records, state, notes, snapshot, assets, failedSources] = await Promise.all([
      listSources(id), readRecords(id, 'extractions'), loadState(id), readNotes(id),
      readJsonFileAsync(path.join(root(id), 'snapshot.json'), null), listAssets(id), readRecords(id, 'failures'),
    ]);
    const members = membersOf(sources);
    const cached = new Map(records.map(record => [record.id, record]));
    const failures = new Map(failedSources.map(record => [record.id, record]));
    const eligible = members.filter(source => !source.busy && source.id !== excludeSessionId
      && now() - source.updatedAt <= config.maxAgeMs && cached.get(source.id)?.sourceUpdatedAt !== source.updatedAt);
    const needsConsolidation = records.some(record => members.some(source => source.id === record.id)
      && snapshot?.sourceHashes?.[record.id] !== record.sourceHash)
      || notes.some(note => !snapshot?.noteIds?.includes(note.id))
      || Object.keys(snapshot?.sourceHashes || {}).some(sourceId => !members.some(source => source.id === sourceId));
    const assetsChanged = digest(memoryAssets(assets)) !== (snapshot?.assetsHash || digest([]));
    const assetsDue = assetsChanged ? Math.max(0, (project.updatedAt || 0) + config.idleMs - now()) : Infinity;
    const extractionDue = Math.min(...eligible.map(source => Math.max(0, source.updatedAt + config.idleMs - now(),
      failures.get(source.id)?.sourceUpdatedAt === source.updatedAt ? failures.get(source.id).nextRetryAt - now() : 0)));
    const consolidationDue = needsConsolidation || assetsChanged
      ? Math.max(needsConsolidation ? 0 : assetsDue, (state.nextRunAt || 0) - now()) : Infinity;
    // Codex's consolidation cooldown does not prevent phase-one extraction.
    const earliest = Math.min(extractionDue, consolidationDue);
    if (Number.isFinite(earliest)) schedule(id, earliest);
  }

  async function perform(id, { force = false, excludeSessionId = null }, signal) {
    let release;
    let state = {};
    try {
      const project = await projectFor(id);
      await fs.mkdir(root(id), { recursive: true });
      try { release = await lockfile.lock(root(id), { stale: 300_000, update: 30_000, retries: 0 }); } catch (error) {
        if (error.code === 'ELOCKED') {
          setStatus(id, { phase: 'idle', message: '项目正在其他窗口整理。' });
          schedule(id, config.retryMs);
          return { skipped: 'running' };
        }
        throw error;
      }
      state = await loadState(id);
      setStatus(id, { phase: 'running', message: '正在提炼会话记录…', error: '' });
      signal.throwIfAborted();
      const allSources = membersOf(await listSources(id));
      const members = new Set(allSources.map(source => source.id));
      const candidates = allSources.filter(source => !source.busy && source.id !== excludeSessionId
        && (force || (now() - source.updatedAt >= config.idleMs && now() - source.updatedAt <= config.maxAgeMs)))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      let extractedCount = 0;
      let processedCount = 0;
      for (const source of candidates) {
        signal.throwIfAborted();
        const file = path.join(root(id), 'extractions', `${safeId(source.id)}.json`);
        const cached = await readJsonFileAsync(file, null);
        if (cached?.sourceUpdatedAt === source.updatedAt) continue;
        const failurePath = path.join(root(id), 'failures', `${safeId(source.id)}.json`);
        const failure = await readJsonFileAsync(failurePath, null);
        if (!force && failure?.sourceUpdatedAt === source.updatedAt && failure.nextRetryAt > now()) continue;
        if (!force && processedCount >= config.batchSize) break;
        processedCount++;
        try {
        const transcript = await readSource(source);
        signal.throwIfAborted();
        const sourceHash = digest(transcript || '');
        let summary = transcript?.trim() ? cached?.summary || '' : '';
        if (transcript?.trim() && cached?.sourceHash !== sourceHash) {
          summary = parseProjectMemoryJson(await query({ project, source, signal, stage: 'extract',
            prompt: projectMemoryExtractionPrompt({ project, source, transcript, language: getLanguage() }),
          }), 'summary', 12000, true);
          extractedCount++;
        }
        signal.throwIfAborted();
        await projectFor(id);
        const current = (await listSources(id)).find(item => item.id === source.id);
        if (!current || current.deleted || current.isSubAgent || current.busy || current.updatedAt !== source.updatedAt) continue;
        await writeJsonFileAtomicAsync(file, { id: source.id, title: source.title, summary, sourceHash,
          sourceUpdatedAt: source.updatedAt, generatedAt: now() });
        await fs.rm(failurePath, { force: true });
        // Existing memory browsers can still open the per-session Markdown view.
        await writeTextFileAtomicAsync(path.join(root(id), 'sessions', `${safeId(source.id)}.md`),
          `# ${String(source.title || source.id).replace(/[\r\n]/g, ' ')}\n\nSource: ${source.id}\n\n${summary}\n`).catch(() => {});
        } catch (error) {
          signal.throwIfAborted();
          const failures = failure?.sourceUpdatedAt === source.updatedAt ? (failure.failures || 0) + 1 : 1;
          await writeJsonFileAtomicAsync(failurePath, { id: source.id, sourceUpdatedAt: source.updatedAt, failures,
            nextRetryAt: now() + Math.min(config.retryMs * 2 ** Math.min(failures - 1, 8), config.cooldownMs),
            error: redactProjectMemorySecrets(error.message || String(error)) });
        }
      }
      const failedSources = (await readRecords(id, 'failures')).filter(failure =>
        allSources.some(source => source.id === failure.id && source.updatedAt === failure.sourceUpdatedAt));
      const sourceError = failedSources.length ? `${failedSources.length} 个会话暂未提炼，将自动重试：${failedSources[0].error}` : '';
      state = { ...state, sourceError };
      const sources = (await readRecords(id, 'extractions')).filter(source => members.has(source.id))
        .sort((a, b) => a.id.localeCompare(b.id));
      const notes = await readNotes(id);
      // Asset mutations share the project commit queue. The commit reader must not
      // acquire the asset queue again (asset writers acquire it before this queue).
      const assetProject = await projectFor(id);
      const assets = memoryAssets(await listAssets(id));
      const sourceHashes = Object.fromEntries(sources.map(source => [source.id, source.sourceHash]));
      const fingerprint = digest({ sourceHashes, notes, assets });
      const previous = await getMemory(id);
      const snapshot = await readJsonFileAsync(path.join(root(id), 'snapshot.json'), {});
      const unchanged = snapshot.fingerprint === fingerprint;
      if (unchanged || (!snapshot.fingerprint && !sources.length && !notes.length && !assets.length)) {
        state = { ...state, failures: 0, error: '' };
        await writeJsonFileAtomicAsync(statePath(id), state);
        setStatus(id, { phase: sourceError ? 'failed' : 'completed', message: sourceError || '暂无需要整理的新内容。', error: sourceError,
          lastRunAt: state.lastRunAt || null, nextRunAt: state.nextRunAt || null });
        return { skipped: unchanged ? 'unchanged' : 'empty', memory: previous };
      }
      if (!force && state.nextRunAt > now()) {
        await writeJsonFileAtomicAsync(statePath(id), state);
        setStatus(id, { phase: 'idle', message: '会话摘要已保存，等待下次项目整合。', error: sourceError, nextRunAt: state.nextRunAt });
        return { skipped: 'cooldown', extractedCount };
      }
      setStatus(id, { phase: 'running', message: '正在整合项目沉淀…', error: '' });
      const removedSourceIds = Object.keys(snapshot.sourceHashes || {}).filter(sourceId => !members.has(sourceId));
      const removedAssetIds = (snapshot.assetIds || []).filter(assetId => !assets.some(asset => asset.id === assetId));
      const changedSources = sources.filter(source => snapshot.sourceHashes?.[source.id] !== source.sourceHash);
      const inputs = [
        ...batches(changedSources).map(batch => ({ sources: batch })),
        ...(snapshot.assetsHash !== digest(assets) ? batches(assets).map(batch => ({ assets: batch })) : []),
        // Always apply all correction/forget notes LAST, so refreshed sources cannot restore old claims.
        ...batches(notes).map(batch => ({ notes: batch })),
      ];
      if (!inputs.length) inputs.push({});
      let overview = previous.overview || '';
      for (const input of inputs) {
        signal.throwIfAborted();
        overview = parseProjectMemoryJson(await query({ project, signal, stage: 'consolidate',
          prompt: projectMemoryConsolidationPrompt({ project, sources: [], notes: [], assets: [], ...input,
            removedSourceIds, removedAssetIds, previous: overview, language: getLanguage() }),
        }), 'overview', 12000, true);
      }
      return await withProjectCommit(id, async () => {
      signal.throwIfAborted();
      const currentProject = await projectFor(id);
      const latestNotes = await readNotes(id);
      const latestSources = membersOf(await listSources(id));
      const latestMembers = new Set(latestSources.map(source => source.id));
      const latestAssets = memoryAssets(await readAssetsForCommit(id));
      if (currentProject.updatedAt !== assetProject.updatedAt || digest(assets) !== digest(latestAssets)
        || digest(notes) !== digest(latestNotes) || sources.some(source => !latestMembers.has(source.id))
        || sources.some(source => latestSources.find(item => item.id === source.id)?.updatedAt !== allSources.find(item => item.id === source.id)?.updatedAt)) {
        schedule(id, config.retryMs);
        setStatus(id, { phase: 'idle', message: '来源已更新，已重新安排整理。', error: '' });
        return { skipped: 'superseded' };
      }
      const updatedAt = now();
      const nextSnapshot = { version: (previous.version || 0) + 1, updatedAt, lastSessionId: sources.at(-1)?.id || previous.lastSessionId || null,
        finalizedSessionCount: Math.max(previous.finalizedSessionCount || 0, sources.length), overview,
        sourceIds: sources.map(source => source.id), sourceHashes, noteIds: notes.map(note => note.id), assetIds: assets.map(asset => asset.id), assetsHash: digest(assets), fingerprint };
      // The snapshot is authoritative. Compatibility files and maintenance metadata are recoverable.
      await writeJsonFileAtomicAsync(path.join(root(id), 'snapshot.json'), nextSnapshot);
      state = { fingerprint, lastRunAt: updatedAt, nextRunAt: updatedAt + config.cooldownMs, failures: 0, error: '', sourceError };
      await Promise.allSettled([
        writeTextFileAtomicAsync(path.join(root(id), 'overview.md'), `${overview}\n`),
        writeJsonFileAtomicAsync(statePath(id), state),
      ]);
      setStatus(id, { phase: 'completed', message: sourceError ? '已整合可用来源，其余会话将自动重试。' : '项目整理完成。', lastRunAt: updatedAt, nextRunAt: state.nextRunAt, error: sourceError });
      return { memory: nextSnapshot, extractedCount };
      });
    } catch (error) {
      const projectStillExists = await readProject(id).catch(() => null);
      if (!signal.aborted && projectStillExists && !projectStillExists.archivedAt) {
        const failures = (state.failures || 0) + 1;
        const nextRunAt = now() + Math.min(config.retryMs * 2 ** Math.min(failures - 1, 8), config.cooldownMs);
        const message = redactProjectMemorySecrets(error.message || String(error));
        setStatus(id, { phase: 'failed', message: '整理未完成，已保留上次沉淀。', error: message, nextRunAt });
        await writeJsonFileAtomicAsync(statePath(id), { ...state, failures, nextRunAt, error: message }).catch(() => {});
        schedule(id, nextRunAt - now());
      } else setStatus(id, { phase: 'canceled', message: '整理已停止。', error: '' });
      throw error;
    } finally { if (release) await release().catch(() => {}); }
  }

  function run(projectId, options = {}) {
    const id = normalizeProjectId(projectId);
    if (stopped) return Promise.reject(new Error('项目记忆服务已停止。'));
    if (running.has(id)) return running.get(id).promise;
    clearTimeout(timers.get(id)?.timer); timers.delete(id);
    const controller = new AbortController();
    const promise = perform(id, options, controller.signal).finally(() => {
      running.delete(id);
      if (!stopped) void consider(id).catch(() => {});
    });
    running.set(id, { controller, promise });
    return promise;
  }

  async function start(projectId, options = {}) {
    const id = normalizeProjectId(projectId);
    await projectFor(id);
    setStatus(id, { phase: 'running', message: '准备整理项目…', error: '' });
    void run(id, options).catch(() => {});
    return getStatus(id);
  }

  async function addNote(projectId, { text, sessionId = null } = {}) {
    const id = normalizeProjectId(projectId);
    await projectFor(id);
    const note = redactProjectMemorySecrets(text).trim();
    if (!note || note.length > 12000) throw new Error('记忆修正不能为空，且不能超过 12000 字符。');
    if (sessionId && !(await listSources(id)).some(source => source.id === sessionId && !source.deleted)) throw new Error('会话不属于当前项目。');
    const record = { id: `note-${randomUUID()}`, text: note, sessionId, createdAt: now() };
    await withProjectCommit(id, async () => {
      await projectFor(id);
      await writeJsonFileAtomicAsync(path.join(root(id), 'notes', `${record.id}.json`), record);
    });
    notify(id);
    void consider(id).catch(() => {});
    return record;
  }

  async function read(projectId, { action = 'read', sourceId, query: search, limit = 20, offset = 0 } = {}) {
    const id = normalizeProjectId(projectId);
    await projectFor(id);
    const count = Math.max(1, Math.min(50, Number(limit) || 20));
    const startAt = Math.max(0, Number(offset) || 0);
    if (action === 'read' && !sourceId) {
      const memory = await getMemory(id);
      const notes = await readNotes(id);
      const pending = notes.filter(note => !memory.noteIds?.includes(note.id));
      return { ...memory, corrections: pending.slice(startAt, startAt + Math.min(count, 5)), correctionCount: pending.length };
    }
    const memberIds = new Set(membersOf(await listSources(id)).map(source => source.id));
    const records = (await readRecords(id, 'extractions')).filter(source => memberIds.has(source.id));
    if (sourceId) {
      const record = records.find(source => source.id === safeId(sourceId));
      if (!record) throw new Error('记忆来源不存在或已移出项目。');
      return record;
    }
    const needle = String(search || '').trim().toLocaleLowerCase();
    return records.filter(source => !needle || `${source.title}\n${source.summary}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => b.sourceUpdatedAt - a.sourceUpdatedAt).slice(startAt, startAt + count)
      .map(source => ({ id: source.id, title: source.title, updatedAt: source.sourceUpdatedAt,
        ...(action === 'search' ? { excerpt: source.summary.slice(Math.max(0, source.summary.toLocaleLowerCase().indexOf(needle) - 250),
          Math.max(0, source.summary.toLocaleLowerCase().indexOf(needle) - 250) + 1500) } : {}) }));
  }

  return {
    run, start, getStatus, addNote, read, consider,
    isRunning: () => running.size > 0,
    async stop() {
      stopped = true;
      for (const { timer } of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const run of running.values()) run.controller.abort();
      await Promise.allSettled([...running.values()].map(run => run.promise));
    },
  };
}
