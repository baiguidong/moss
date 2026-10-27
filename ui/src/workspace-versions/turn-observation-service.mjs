import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { structuredPatch } from 'diff';
import { indexHistoryTurns, resolveObservationUser } from '../shared/turn-identity.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const overlaps = (a, b) => { const rel = path.relative(a, b); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
const excluded = (capture, name) => capture.excluded.some(entry => name === entry.path || name.startsWith(entry.path + '/'));

/** Observes a filesystem interval, not the causal author of each write. */
export function createTurnObservationService({ storageRoot, versions, captureMs = 5000, maxTurns = 200, getSessionRecord, getTurnBindings = async () => [], getRetainedObservationIds = async () => [] }) {
  const active = new Map(), writes = new Map(), finishes = new WeakMap();
  const fileFor = id => path.join(storageRoot, hash(id) + '.json');
  async function list(id) { try { const data = JSON.parse(await fs.readFile(fileFor(id), 'utf8')); return data.schema === 'moss.turn-observations/v1' ? data.turns : []; } catch { return []; } }
  async function save(record) {
    record = structuredClone(record);
    const previous = writes.get(record.sessionId) || Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      const turns = await list(record.sessionId), index = turns.findIndex(turn => turn.id === record.id);
      if (index < 0) turns.push(record); else turns[index] = record;
      const retained = new Set(await getRetainedObservationIds(record.sessionId));
      const removed = [];
      for (let i = 0; turns.length > maxTurns && i < turns.length;) {
        if (retained.has(turns[i].id) || turns[i].id === record.id || active.has(turns[i].id)) { i++; continue; }
        removed.push(...turns.splice(i, 1));
      }
      await fs.mkdir(storageRoot, { recursive: true, mode: 0o700 });
      const temporary = fileFor(record.sessionId) + '.' + randomUUID();
      try { await fs.writeFile(temporary, JSON.stringify({ schema: 'moss.turn-observations/v1', turns }), { mode: 0o600 }); await fs.rename(temporary, fileFor(record.sessionId)); }
      finally { await fs.rm(temporary, { force: true }); }
      // Sidecar replacement must commit before releasing blobs used by the old history.
      for (const old of removed) for (const capture of [old.baseline, old.end]) if (capture?.ref) await versions.releaseObservation(old.workspace, capture.ref).catch(() => {});
      if (removed.length && versions.collectObservationGarbage) void versions.collectObservationGarbage(record.workspace).catch(() => {});
    });
    writes.set(record.sessionId, task); await task;
  }
  async function capture(workspace, externalSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort(externalSignal.reason || new Error('文件观察已取消'));
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    let timer;
    try {
      return await Promise.race([
        versions.captureObservation(workspace, { signal: controller.signal }).then(result => { if (controller.signal.aborted) { void versions.releaseObservation(workspace, result.ref).catch(() => {}); throw controller.signal.reason; } return result; }),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(new Error('文件观察超时')); reject(controller.signal.reason); }, captureMs); }),
      ]);
    } finally { clearTimeout(timer); externalSignal?.removeEventListener('abort', abort); }
  }
  return {
    list,
    async bindUser(record, userMessageId) { record.userMessageId = userMessageId; await save(record); },
    observeMessage(record, message) {
      if (record.phase === 'finalized' || message?.type !== 'assistant' || message.parent_tool_use_id || message.isSidechain) return;
      if (message.uuid) record.assistantMessageIds = [...new Set([...(record.assistantMessageIds || []), message.uuid])];
      const ids = (Array.isArray(message.message?.content) ? message.message.content : []).filter(block => block?.type === 'tool_use' && block.id).map(block => block.id);
      if (ids.length) record.toolUseIds = [...new Set([...(record.toolUseIds || []), ...ids])];
    },
    async begin(session, turnId, { signal } = {}) {
      const record = { schema: 'moss.turn-observation/v1', id: turnId, sessionId: session.id, workspace: session.workspace,
        sessionWorkspace: session.workspace, agentMode: session.agentMode, userMessageId: null, coverage: 'unavailable', stability: 'unknown', phase: 'capturing-baseline', reasons: [], overlaps: [], changes: [], startedAt: Date.now() };
      if (session.agentMode === 'remote-direct' || !session.workspace) {
        record.reasons.push('当前环境没有本地工作区观察能力'); return record;
      }
      try {
        record.workspace = await fs.realpath(session.workspace);
        for (const other of active.values()) if (overlaps(record.workspace, other.workspace) || overlaps(other.workspace, record.workspace)) {
          record.overlaps.push(other.id); other.overlaps.push(record.id);
        }
        active.set(record.id, record);
        record.baseline = await capture(record.workspace, signal); record.phase = 'running';
      } catch (error) { record.reasons.push(error.message); }
      await save(record); return record;
    },
    async finish(record, userMessageId) {
      if (finishes.has(record)) return finishes.get(record);
      if (record.phase === 'finalized') return record;
      const finished = (async () => {
      record.userMessageId = userMessageId || record.userMessageId;
      try {
        record.phase = 'capturing-end';
        const current = getSessionRecord?.(record.sessionId);
        if (getSessionRecord && (!current || current.deleted || current.workspace !== record.sessionWorkspace || current.agentMode !== record.agentMode)) throw new Error('工作区已切换，旧回合观察已失效');
        if (record.baseline) {
          record.end = await capture(record.workspace);
          if (getSessionRecord && (getSessionRecord(record.sessionId)?.workspace !== record.sessionWorkspace || getSessionRecord(record.sessionId)?.deleted)) throw new Error('工作区已切换，旧回合观察已失效');
          const before = new Map(record.baseline.entries.map(file => [file.path, file])), after = new Map(record.end.entries.map(file => [file.path, file]));
          const stats = new Map((await versions.observationStats(record.workspace, record.baseline.tree, record.end.tree)).map(row => [row.path, row]));
          if (getSessionRecord && (getSessionRecord(record.sessionId)?.workspace !== record.sessionWorkspace || getSessionRecord(record.sessionId)?.agentMode !== record.agentMode || getSessionRecord(record.sessionId)?.deleted)) throw new Error('工作区已切换，旧回合观察已失效');
          record.coverage = 'complete'; record.stability = 'no-instability-detected';
          for (const name of new Set([...before.keys(), ...after.keys()])) {
            const old = before.get(name), next = after.get(name);
            if (old?.oid === next?.oid && old?.mode === next?.mode) continue;
            // Exclusion is unknown state, never evidence of a deletion/addition.
            if (excluded(record.baseline, name) || excluded(record.end, name)) { record.coverage = 'partial'; continue; }
            const numbers = stats.get(name) || { additions: 0, deletions: 0, binary: false };
            record.changes.push({ filePath: path.join(record.workspace, name), path: name, beforeOid: old?.oid, afterOid: next?.oid,
              beforeSize: old?.size, afterSize: next?.size, isNewFile: !old, status: !old ? 'added' : !next ? 'deleted' : 'modified',
              additions: numbers.additions, deletions: numbers.deletions, binary: numbers.binary, structuredPatch: [] });
          }
          if (record.coverage === 'partial') record.reasons.push('部分文件超出观察范围，不能确认其完整变化');
          record.excluded = record.end.excluded;
        }
      } catch (error) {
        record.coverage = 'unavailable'; record.stability = 'unknown'; record.reasons.push(error.message);
      } finally {
        active.delete(record.id); record.phase = 'finalized'; record.finishedAt = Date.now();
        await save(record);
      }
      return record;
      })();
      finishes.set(record, finished);
      return finished;
    },
    async turnsForHistory(sessionId, history) {
      // Worker transcripts are not observed main-session turns and cannot rewind.
      if (getSessionRecord?.(sessionId)?.isSubAgent) return [];
      await writes.get(sessionId);
      const index = indexHistoryTurns(history);
      const observations = await list(sessionId);
      // Older observations can be recovered using durable presentation bindings.
      // These IDs establish ownership only; they never supply file-change data.
      const bindings = observations.some(record => !index.turns.has(record.userMessageId)) ? await getTurnBindings(sessionId) : [];
      const matched = new Map();
      for (const record of observations) {
        const userMessageId = resolveObservationUser(record, index, bindings);
        if (!userMessageId) continue;
        const records = matched.get(userMessageId) || []; records.push(record); matched.set(userMessageId, records);
      }
      const results = [];
      for (const { userMessageId, hasTools } of index.turns.values()) {
        const records = matched.get(userMessageId) || [];
        const record = records.length === 1 ? records[0] : null;
        if (!record && !hasTools && !records.length) continue;
        if (record?.phase === 'finalized' && record.userMessageId !== userMessageId) {
          record.userMessageAliases = [...new Set([...(record.userMessageAliases || []), record.userMessageId].filter(Boolean))];
          record.userMessageId = userMessageId;
          await save(record);
        }
        const coverage = record?.phase === 'finalized' ? record.coverage : 'unavailable';
        const files = coverage === 'complete' || coverage === 'partial' ? record.changes.map(file => ({ ...file, verified: true })) : [];
        const reasons = record ? [...record.reasons] : [records.length ? '观察记录的回合关联有冲突，无法确认文件变化' : '缺少本轮文件观察记录，无法确认文件变化'];
        if (record && record.phase !== 'finalized') reasons.push(active.has(record.id) ? '本轮文件观察尚未完成' : '上次文件观察未完成');
        if (coverage !== 'unavailable') reasons.push(record.overlaps.length ? '本轮期间变更，可能包含其他任务的修改' : '统计本轮期间的文件变化，也可能包含外部程序修改');
        results.push({ userMessageId, files,
          stats: { filesChanged: files.length, additions: files.reduce((sum, file) => sum + file.additions, 0), deletions: files.reduce((sum, file) => sum + file.deletions, 0) },
          hasUnverifiedChanges: coverage !== 'complete', ...(record ? { observationId: record.id } : {}), coverage,
          observationNote: reasons.join('；'), excludedCount: record?.excluded?.length || 0,
        });
      }
      return results;
    },
    async diff(sessionId, observationId, filePath) {
      const record = (await list(sessionId)).find(item => item.id === observationId), file = record?.changes.find(item => item.filePath === filePath);
      if (!file) throw new Error('找不到这份历史变更');
      if (file.binary || Math.max(file.beforeSize || 0, file.afterSize || 0) > 1024 * 1024) return { ...file, detail: '二进制或大型文件，只显示变更信息' };
      const before = file.beforeOid ? (await versions.readObservationBlob(record.workspace, file.beforeOid)).toString('utf8') : '';
      const after = file.afterOid ? (await versions.readObservationBlob(record.workspace, file.afterOid)).toString('utf8') : '';
      return { ...file, structuredPatch: structuredPatch(file.path, file.path, before, after, undefined, undefined, { context: 3 }).hunks };
    },
  };
}
