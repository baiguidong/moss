import { readFile, stat } from 'node:fs/promises';

export async function readTranscriptHistory(filePath, { isDisplayEntry, requireComplete = false }) {
  let raw;
  try { raw = await readFile(filePath, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const history = [];
  const lines = raw.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch {
      // Only an unfinished tail needs a retry. Historical malformed lines
      // should not prevent the rest of the transcript from ever syncing.
      if (requireComplete && index === lines.length - 1) return null;
      continue;
    }
    if (isDisplayEntry(entry)) history.push(entry);
  }
  return history;
}

const fingerprint = (filePath, info) => `${filePath}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;

// SQLite and renderer histories are caches. Poll only sessions opened in this
// desktop; read the JSONL again only when its file identity or contents change.
export function createLocalTranscriptSync({
  getPath, readHistory, applyHistory, invalidateRuntime,
  canSync = () => true, onError = () => {}, intervalMs = 1000,
}) {
  const entries = new Map();
  let timer = null;
  let disposed = false;

  function watch(record) {
    if (!entries.has(record)) entries.set(record, { fingerprint: null, pending: null, revision: 0 });
    if (!timer) {
      timer = setInterval(() => {
        for (const record of entries.keys()) void refresh(record).catch(error => onError(error, record));
      }, intervalMs);
      timer.unref?.();
    }
    return entries.get(record);
  }

  async function refresh(record) {
    if (disposed) return false;
    const filePath = getPath(record);
    if (!filePath || record.deleted) return false;
    const entry = watch(record);
    if (entry.pending) return entry.pending;
    if (!canSync(record)) return false;
    const revision = entry.revision;
    const isCurrent = () => entries.get(record) === entry && entry.revision === revision
      && !record.deleted && getPath(record) === filePath && canSync(record);
    entry.pending = (async () => {
      let info;
      try { info = await stat(filePath); } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
      if (!isCurrent()) return false;
      const nextFingerprint = fingerprint(filePath, info);
      if (entry.fingerprint === nextFingerprint) return true;
      const history = await readHistory(record);
      if (!Array.isArray(history) || !isCurrent()) return false;
      // A read can overlap an append, replacement or truncation. Retry on the
      // next poll instead of publishing a partial snapshot as authoritative.
      let afterRead;
      try { afterRead = await stat(filePath); } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
      if (fingerprint(filePath, afterRead) !== nextFingerprint || !isCurrent()) return false;
      invalidateRuntime(record);
      applyHistory(record, history, { modifiedAt: info.mtimeMs });
      entry.fingerprint = nextFingerprint;
      return true;
    })();
    try { return await entry.pending; } finally { entry.pending = null; }
  }

  async function acknowledge(record) {
    if (disposed) return;
    const filePath = getPath(record);
    if (!filePath || record.deleted) return;
    const entry = watch(record);
    const revision = ++entry.revision;
    try {
      const info = await stat(filePath);
      if (entries.get(record) === entry && entry.revision === revision && getPath(record) === filePath) {
        entry.fingerprint = fingerprint(filePath, info);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  function forget(record) {
    entries.delete(record);
    if (entries.size === 0 && timer) { clearInterval(timer); timer = null; }
  }

  function dispose() {
    disposed = true;
    entries.clear();
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { refresh, acknowledge, forget, dispose };
}
