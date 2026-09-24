import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readCronTaskStore, updateCronTaskStore } from '../../shared/cron-task-store.mjs';

function parseMossCronField(part, min, max) {
  if (part === '*') return { any: true };
  const values = new Set();
  for (const chunk of part.split(',')) {
    const m = chunk.match(/^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[3] ? parseInt(m[3], 10) : 1;
    let start;
    let end;
    if (m[1] === '*') {
      start = min;
      end = max;
    } else {
      start = parseInt(m[1], 10);
      end = m[2] ? parseInt(m[2], 10) : (m[3] ? max : start);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || step <= 0 || start > end) return null;
    for (let v = start; v <= end; v += step) {
      if (v < min || v > max) return null;
      values.add(v);
    }
  }
  return { any: false, values };
}

export function parseMossCronExpression(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const ranges = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
  const fields = [];
  for (let i = 0; i < 5; i += 1) {
    const field = parseMossCronField(parts[i], ranges[i][0], ranges[i][1]);
    if (!field) return null;
    fields.push(field);
  }
  return fields;
}

export function mossCronMatches(fields, date) {
  const [minute, hour, dom, month, dow] = fields;
  const match = (f, v) => f.any || f.values.has(v);
  if (!match(minute, date.getMinutes())) return false;
  if (!match(hour, date.getHours())) return false;
  if (!match(month, date.getMonth() + 1)) return false;
  const day = date.getDay();
  const dowMatch = dow.any || dow.values.has(day) || (day === 0 && dow.values.has(7));
  const domMatch = match(dom, date.getDate());
  // Standard cron semantics: when both day fields are restricted, either may match.
  if (!dom.any && !dow.any) return domMatch || dowMatch;
  return domMatch && dowMatch;
}

export function createMossCronScheduler({
  ipcMain,
  mossHome,
  sessions,
  sessionDb,
  getMainWindow,
  normalizePreviewText,
  createSessionRecord,
  linkSessionToProject,
  readProjectSync,
  runSessionPrompt,
  hostId = randomUUID(),
  now = Date.now,
}) {
  const filePath = path.join(mossHome, 'cron_tasks.json');
  const recurringMaxAge = 7 * 24 * 60 * 60 * 1000;
  const activeRuns = new Map();
  let initialized;
  let timer;
  let stopped = false;
  let ticking = false;

  function nextRunAt(task, fromMs) {
    const fields = parseMossCronExpression(task.cron);
    if (!fields) return null;
    const cursor = new Date(fromMs);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(cursor.getMinutes() + 1);
    const limit = fromMs + 366 * 24 * 60 * 60 * 1000;
    while (cursor.getTime() <= limit) {
      if (mossCronMatches(fields, cursor)) return cursor.getTime();
      cursor.setMinutes(cursor.getMinutes() + 1);
    }
    return null;
  }

  function ownerFor(task) {
    const owner = sessions.get(task.ownerSessionId);
    return owner && !owner.deleted && owner.agentMode !== 'remote-direct' ? owner : null;
  }

  // Old files did not store durability or ownership. Only a matching
  // CronCreate tool/result pair is evidence of how a legacy task was created.
  function legacyCreation(task) {
    for (const record of sessions.values()) {
      if (record.agentMode === 'remote-direct' || record.sessionKind === 'cron') continue;
      let history = record.history || [];
      if (sessionDb) {
        try {
          const row = sessionDb.prepare('SELECT history_json FROM sessions WHERE id = ?').get(record.id);
          if (row?.history_json) history = [...JSON.parse(row.history_json), ...history];
        } catch {}
      }
      const calls = new Map();
      for (const event of history) {
        const content = event?.message?.content;
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === 'tool_use' && block.name === 'CronCreate') calls.set(block.id, block.input);
          if (block.type !== 'tool_result' || !calls.has(block.tool_use_id)) continue;
          const result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          if (!result?.includes(task.id) || block.is_error) continue;
          return { ownerSessionId: record.id, durable: calls.get(block.tool_use_id)?.durable === true };
        }
      }
    }
    return null;
  }

  function initialize() {
    if (!initialized) {
      initialized = updateCronTaskStore(filePath, tasks => {
        let bindings = {};
        try { bindings = JSON.parse(fs.readFileSync(path.join(mossHome, 'cron_bindings.json'), 'utf8')); } catch {}
        for (let index = tasks.length - 1; index >= 0; index--) {
          const task = tasks[index];
          if (typeof task.durable !== 'boolean') {
            const creation = legacyCreation(task);
            if (creation) Object.assign(task, creation);
            else {
              // Preserve unidentifiable legacy records for review, never
              // silently turn an old session-only reminder into a durable job.
              task.durable = true;
              task.ownerSessionId ||= bindings[task.id];
              task.enabled = false;
              task.status = 'failed';
              task.lastError = '旧任务缺少生命周期信息，请检查后重新启用。';
            }
          }
          if (task.durable === false && task.desktopHostId !== hostId) {
            tasks.splice(index, 1);
            continue;
          }
          if (task.runId && task.runHostId !== hostId) {
            task.enabled = false;
            task.status = 'failed';
            task.lastError = '上次执行被中断，结果未确认，请检查执行会话后手动重试。';
            delete task.runId;
            delete task.runHostId;
          }
          if (!Number.isFinite(task.nextRunAt)) {
            task.nextRunAt = nextRunAt(task, task.lastCompletedAt ?? task.lastFiredAt ?? task.createdAt ?? now());
          }
        }
      }).catch(error => { initialized = undefined; throw error; });
    }
    return initialized;
  }

  function executionFor(taskId) {
    return [...sessions.values()].find(record => !record.deleted && record.sessionKind === 'cron' && record.cronTaskId === taskId);
  }

  async function getExecution(task, owner) {
    const existing = executionFor(task.id);
    if (existing) return existing;
    const record = createSessionRecord({
      workspace: owner.workspace,
      title: `定时任务 · ${normalizePreviewText(task.prompt, 42) || task.id}`,
      assistantName: owner.assistantName,
      projectId: owner.projectId,
      connectorIds: owner.connectorIds,
      agentMode: owner.agentMode,
      permissionMode: owner.permissionMode,
      sessionKind: 'cron',
      sourceSessionId: owner.id,
      cronTaskId: task.id,
      parentSessionId: owner.id,
    });
    if (record.projectId) await linkSessionToProject(record.projectId, record);
    return record;
  }

  async function execute(taskId, manual) {
    await initialize();
    const runId = randomUUID();
    const claimed = await updateCronTaskStore(filePath, tasks => {
      const task = tasks.find(entry => entry.id === taskId);
      if (!task) { if (manual) throw new Error('Task not found.'); return null; }
      if (stopped || task.runId) { if (manual) throw new Error('定时任务正在执行或调度器已停止。'); return null; }
      if (task.durable === false && task.desktopHostId !== hostId) return null;
      if (!manual && (task.enabled === false || !Number.isFinite(task.nextRunAt) || task.nextRunAt > now())) return null;
      const owner = ownerFor(task);
      if (!owner) { if (manual) throw new Error('归属会话不存在，不能执行该任务。'); return null; }
      if (owner.projectId) {
        const project = readProjectSync(owner.projectId);
        if (!project || project.archivedAt) { if (manual) throw new Error('项目已删除或归档。'); return null; }
      }
      if (executionFor(taskId)?.busy) { if (manual) throw new Error('定时任务会话正在执行，请稍后再试。'); return null; }
      Object.assign(task, { runId, runHostId: hostId, status: 'running', lastFiredAt: now() });
      return { ...task };
    });
    if (!claimed) return null;
    let execution;
    try {
      execution = await getExecution(claimed, ownerFor(claimed));
      // Recheck deletion/pause after async session creation, before starting work.
      const current = (await readCronTaskStore(filePath)).find(task => task.id === taskId);
      if (!current || (!manual && current.enabled === false) || stopped) {
        await updateCronTaskStore(filePath, tasks => {
          const task = tasks.find(entry => entry.id === taskId && entry.runId === runId);
          if (task) { delete task.runId; delete task.runHostId; task.status = 'idle'; }
        });
        return null;
      }
      const window = getMainWindow();
      await runSessionPrompt({
        sessionRecord: execution,
        sender: window && !window.isDestroyed() ? window.webContents : null,
        runtimePrompt: claimed.prompt,
        visibleUserPrompt: `⏰ 定时任务${manual ? '（手动触发）' : ''}：${claimed.prompt}`,
        failOnApiError: true,
      });
      await updateCronTaskStore(filePath, tasks => {
        const index = tasks.findIndex(task => task.id === taskId && task.runId === runId);
        if (index < 0) return; // A delete during execution must stay deleted.
        const task = tasks[index];
        if (!task.recurring) { tasks.splice(index, 1); return; }
        Object.assign(task, { status: 'idle', lastError: null, lastCompletedAt: now(), nextRunAt: nextRunAt(task, now()) });
        delete task.runId;
        delete task.runHostId;
      });
      return execution;
    } catch (error) {
      await updateCronTaskStore(filePath, tasks => {
        const task = tasks.find(entry => entry.id === taskId && entry.runId === runId);
        if (!task) return;
        task.enabled = false;
        task.status = 'failed';
        task.lastError = error instanceof Error ? error.message : String(error);
        delete task.runId;
        delete task.runHostId;
      });
      throw error;
    }
  }

  function launch(taskId, manual = false) {
    if (activeRuns.has(taskId)) return Promise.reject(new Error('定时任务正在执行，请稍后再试。'));
    const operation = execute(taskId, manual);
    activeRuns.set(taskId, operation);
    void operation.finally(() => activeRuns.delete(taskId)).catch(() => {});
    return operation;
  }

  async function tick() {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await initialize();
      await updateCronTaskStore(filePath, tasks => {
        for (let index = tasks.length - 1; index >= 0; index--) {
          const task = tasks[index];
          if (task.runId) continue;
          const staleSession = task.durable === false && task.desktopHostId !== hostId;
          const expired = task.enabled !== false && task.recurring && now() - task.createdAt > recurringMaxAge;
          if (staleSession || expired || (task.ownerSessionId && !sessions.has(task.ownerSessionId))) {
            tasks.splice(index, 1);
            continue;
          }
          if (!Number.isFinite(task.nextRunAt)) task.nextRunAt = nextRunAt(task, task.createdAt ?? now());
        }
      });
      for (const task of await readCronTaskStore(filePath)) {
        if (task.enabled === false || task.runId || activeRuns.has(task.id)) continue;
        if (Number.isFinite(task.nextRunAt) && task.nextRunAt <= now()) {
          void launch(task.id).catch(error => console.warn('[moss-cron] task run failed:', error?.message || error));
        }
      }
    } finally { ticking = false; }
  }

  function start() {
    if (timer) return;
    stopped = false;
    const check = () => void tick().catch(error => console.warn('[moss-cron] scheduler failed:', error?.message || error));
    timer = setInterval(check, 20_000);
    timer.unref?.();
    check();
  }

  function stop() { stopped = true; clearInterval(timer); timer = null; }

  async function removeTasksForSession(sessionId) {
    await initialize();
    return updateCronTaskStore(filePath, tasks => {
      const removed = tasks.filter(task => task.ownerSessionId === sessionId);
      for (let index = tasks.length - 1; index >= 0; index--) {
        if (tasks[index].ownerSessionId === sessionId) tasks.splice(index, 1);
      }
      return removed;
    });
  }

  ipcMain.handle('agent:cron-list', async () => {
    await initialize();
    return { tasks: (await readCronTaskStore(filePath)).map(task => {
      const owner = ownerFor(task);
      const execution = executionFor(task.id);
      return {
        ...task,
        enabled: task.enabled !== false,
        orphaned: !owner,
        ownerSessionId: owner?.id ?? null,
        ownerSessionTitle: owner?.title ?? null,
        executionSessionId: execution?.id ?? null,
        executionSessionTitle: execution?.title ?? null,
        nextRunAt: task.enabled === false ? null : task.nextRunAt ?? nextRunAt(task, task.createdAt ?? now()),
      };
    }) };
  });

  ipcMain.handle('agent:cron-remove', async (_event, { taskId }) => {
    await initialize();
    return updateCronTaskStore(filePath, tasks => {
      const index = tasks.findIndex(task => task.id === taskId);
      if (index < 0) return { ok: false, error: 'Task not found.' };
      tasks.splice(index, 1);
      return { ok: true };
    });
  });

  ipcMain.handle('agent:cron-toggle', async (_event, { taskId, enabled }) => {
    await initialize();
    return updateCronTaskStore(filePath, tasks => {
      const task = tasks.find(entry => entry.id === taskId);
      if (!task) return { ok: false, error: 'Task not found.' };
      if (enabled && !task.enabled) {
        task.nextRunAt = task.lastError ? now() : nextRunAt(task, now());
        task.lastError = null;
        if (!task.runId) task.status = 'idle';
      }
      task.enabled = Boolean(enabled);
      return { ok: true, enabled: task.enabled };
    });
  });

  ipcMain.handle('agent:cron-run-now', async (_event, { taskId }) => {
    try {
      // Await completion: a successful dispatch is not a successful run.
      const execution = await launch(taskId, true);
      return execution ? { ok: true, sessionId: execution.id } : { ok: false, error: '任务未执行。' };
    } catch (error) { return { ok: false, error: error?.message || String(error) }; }
  });

  return { hostId, start, stop, tick, removeTasksForSession, waitForIdle: () => Promise.allSettled([...activeRuns.values()]) };
}
