import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

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
}) {

  // ---------------------------------------------------------------------------
  // Moss cron scheduler
  //
  // The embedded runtime's CronCreate tool mirrors every job into
  // ~/.moss/cron_tasks.json, but its own firing loop only runs in the CLI REPL
  // (idle-loop injection). In SDK mode nothing consumes the file, so scheduled
  // prompts silently never fire. This scheduler reads the file, matches cron
  // expressions each tick, and injects the prompt into the session that created
  // the job (located by scanning session history for the job id).
  // ---------------------------------------------------------------------------
  const MOSS_CRON_FILE = path.join(mossHome, 'cron_tasks.json');
  const MOSS_CRON_BINDINGS_FILE = path.join(mossHome, 'cron_bindings.json');
  const MOSS_CRON_TICK_MS = 20 * 1000;
  const MOSS_CRON_RECURRING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const MOSS_CRON_ONESHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const MOSS_CRON_UNRESOLVED_GRACE_MS = 10 * 60 * 1000;
  const cronSessionBindings = new Map();
  const cronFiredMinutes = new Map();
  const cronUnresolvableSince = new Map();
  let cronTickRunning = false;
  let cronBindingsLoaded = false;

  function loadCronBindings() {
    if (cronBindingsLoaded) return;
    cronBindingsLoaded = true;
    try {
      const parsed = JSON.parse(fs.readFileSync(MOSS_CRON_BINDINGS_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        for (const [taskId, sessionId] of Object.entries(parsed)) {
          if (typeof sessionId === 'string') cronSessionBindings.set(taskId, sessionId);
        }
      }
    } catch {}
  }

  function persistCronBindings() {
    try {
      fs.writeFileSync(
        MOSS_CRON_BINDINGS_FILE,
        `${JSON.stringify(Object.fromEntries(cronSessionBindings), null, 2)}\n`,
        'utf8',
      );
    } catch (err) {
      console.warn('[moss-cron] failed to persist bindings:', err?.message || err);
    }
  }

  async function readMossCronTaskIds() {
    try {
      const parsed = JSON.parse(await fsp.readFile(MOSS_CRON_FILE, 'utf8'));
      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      return new Set(tasks.map((t) => t?.id).filter((id) => typeof id === 'string'));
    } catch {
      return new Set();
    }
  }

  // Deterministic binding: any cron task that appeared in the file during this
  // session's turn was created by this session.
  async function bindNewCronTasks(idsBefore, sessionRecord) {
    try {
      const idsAfter = await readMossCronTaskIds();
      let changed = false;
      for (const id of idsAfter) {
        if (!idsBefore.has(id) && !cronSessionBindings.has(id)) {
          cronSessionBindings.set(id, sessionRecord.id);
          changed = true;
          console.log(`[moss-cron] bound task ${id} → session ${sessionRecord.id}`);
        }
      }
      if (changed) persistCronBindings();
    } catch {}
  }

  // Returns the owning session, or null. Never guesses: a task with no
  // resolvable owner is left unfired (and cleaned up if its session was
  // deleted) — misdelivering a scheduled prompt into an unrelated session is
  // worse than not firing.
  function findSessionForCronTask(taskId) {
    const boundId = cronSessionBindings.get(taskId);
    if (boundId) {
      return sessions.get(boundId) ?? null;
    }
    // In-memory history scan (session created the task before bindings existed).
    for (const [id, record] of sessions) {
      if (record.agentMode === 'remote-direct') continue;
      if (record.sessionKind === 'cron') continue;
      const history = record.history;
      if (!Array.isArray(history)) continue;
      const start = Math.max(0, history.length - 500);
      for (let i = history.length - 1; i >= start; i -= 1) {
        const ev = history[i];
        if (ev?.type !== 'user' && ev?.type !== 'assistant') continue;
        try {
          if (JSON.stringify(ev.message?.content ?? '').includes(taskId)) {
            cronSessionBindings.set(taskId, id);
            persistCronBindings();
            return record;
          }
        } catch {}
      }
    }
    // Durable scan: histories are hydrated lazily after restart, so search the
    // persisted history_json in SQLite for the task id.
    try {
      const row = sessionDb
        .prepare(`SELECT id FROM sessions WHERE is_sub_agent = 0 AND session_kind <> 'cron' AND history_json LIKE ? ORDER BY updated_at DESC LIMIT 1`)
        .get(`%${taskId}%`);
      if (row?.id && sessions.has(row.id)) {
        cronSessionBindings.set(taskId, row.id);
        persistCronBindings();
        return sessions.get(row.id);
      }
    } catch (err) {
      console.warn('[moss-cron] history_json scan failed:', err?.message || err);
    }
    return null;
  }

  function findCronExecutionSession(taskId) {
    for (const record of sessions.values()) {
      if (record.sessionKind === 'cron' && record.cronTaskId === taskId) {
        return record;
      }
    }
    return null;
  }

  async function getOrCreateCronExecutionSession(task, ownerSessionRecord) {
    const existing = findCronExecutionSession(task.id);
    if (existing) return existing;

    const titleSuffix = normalizePreviewText(task.prompt, 42) || task.id;
    const executionSession = createSessionRecord({
      workspace: ownerSessionRecord.workspace,
      title: `定时任务 · ${titleSuffix}`,
      assistantName: ownerSessionRecord.assistantName,
      projectId: ownerSessionRecord.projectId,
      connectorIds: ownerSessionRecord.connectorIds,
      agentMode: ownerSessionRecord.agentMode,
      sessionKind: 'cron',
      sourceSessionId: ownerSessionRecord.id,
      cronTaskId: task.id,
      parentSessionId: ownerSessionRecord.id,
    });
    if (executionSession.projectId) {
      await linkSessionToProject(executionSession.projectId, executionSession);
    }
    return executionSession;
  }

  async function mossCronTick() {
    if (cronTickRunning) return;
    cronTickRunning = true;
    try {
      const mainWindow = getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) return;
      let raw;
      try {
        raw = await fsp.readFile(MOSS_CRON_FILE, 'utf8');
      } catch {
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : [];
      if (tasks.length === 0) return;

      const now = new Date();
      const nowMs = now.getTime();
      const minuteKey = Math.floor(nowMs / 60000);
      const removedIds = new Set();
      let dirty = false;

      for (const task of tasks) {
        if (!task || typeof task.id !== 'string' || typeof task.cron !== 'string' || typeof task.prompt !== 'string') continue;
        if (task.enabled === false) continue;
        const createdAt = typeof task.createdAt === 'number' ? task.createdAt : 0;
        const maxAge = task.recurring ? MOSS_CRON_RECURRING_MAX_AGE_MS : MOSS_CRON_ONESHOT_MAX_AGE_MS;
        if (createdAt && nowMs - createdAt > maxAge) {
          removedIds.add(task.id);
          continue;
        }
        if (!task.recurring && typeof task.lastFiredAt === 'number') {
          removedIds.add(task.id);
          continue;
        }
        const fields = parseMossCronExpression(task.cron);
        if (!fields) continue;
        if (!mossCronMatches(fields, now)) continue;
        if (cronFiredMinutes.get(task.id) === minuteKey) continue;

        const ownerSessionRecord = findSessionForCronTask(task.id);
        if (!ownerSessionRecord) {
          const boundId = cronSessionBindings.get(task.id);
          if (boundId && !sessions.has(boundId)) {
            // Owning session was deleted — drop the orphaned task.
            console.warn(`[moss-cron] task ${task.id} owner session ${boundId} is gone; removing task`);
            removedIds.add(task.id);
            cronSessionBindings.delete(task.id);
            cronUnresolvableSince.delete(task.id);
            persistCronBindings();
            continue;
          }
          // Unbindable (e.g. owner session deleted before a binding was ever
          // recorded). Give it a grace window in case histories are still
          // loading, then clean it up instead of skipping forever.
          const firstSeen = cronUnresolvableSince.get(task.id) ?? nowMs;
          cronUnresolvableSince.set(task.id, firstSeen);
          if (nowMs - firstSeen >= MOSS_CRON_UNRESOLVED_GRACE_MS) {
            console.warn(`[moss-cron] task ${task.id} unresolvable for over 10 minutes (owner session likely deleted); removing task`);
            removedIds.add(task.id);
            cronUnresolvableSince.delete(task.id);
          } else if (firstSeen === nowMs) {
            console.warn(`[moss-cron] task ${task.id} has no resolvable owner session; will retry, then clean up after grace period`);
          }
          continue;
        }
        cronUnresolvableSince.delete(task.id);
        if (ownerSessionRecord.projectId) {
          const project = readProjectSync(ownerSessionRecord.projectId);
          if (!project || project.archivedAt) continue;
        }
        const executionSession = await getOrCreateCronExecutionSession(task, ownerSessionRecord);
        if (executionSession.busy) continue; // retry on the next tick within this minute

        cronFiredMinutes.set(task.id, minuteKey);
        task.lastFiredAt = nowMs;
        dirty = true;
        if (!task.recurring) removedIds.add(task.id);

        console.log(`[moss-cron] firing task ${task.id} (${task.cron}) → cron session ${executionSession.id}`);
        void runSessionPrompt({
          sessionRecord: executionSession,
          sender: mainWindow.webContents,
          runtimePrompt: task.prompt,
          visibleUserPrompt: `⏰ 定时任务：${task.prompt}`,
        }).catch((err) => {
          console.warn('[moss-cron] task run failed:', err?.message || err);
        });
      }

      if (dirty || removedIds.size > 0) {
        const remaining = tasks.filter((t) => !removedIds.has(t?.id));
        try {
          await fsp.writeFile(MOSS_CRON_FILE, `${JSON.stringify({ tasks: remaining }, null, 2)}\n`, 'utf8');
        } catch (err) {
          console.warn('[moss-cron] failed to persist cron file:', err?.message || err);
        }
      }
    } finally {
      cronTickRunning = false;
    }
  }

  function startMossCronScheduler() {
    loadCronBindings();
    const timer = setInterval(() => {
      void mossCronTick();
    }, MOSS_CRON_TICK_MS);
    timer.unref?.();
  }

  function computeNextCronRunMs(fields, fromMs) {
    // Minute-resolution walk; bounded to one year ahead.
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

  async function readMossCronTasks() {
    try {
      const parsed = JSON.parse(await fsp.readFile(MOSS_CRON_FILE, 'utf8'));
      return Array.isArray(parsed?.tasks) ? parsed.tasks.filter((t) => t && typeof t.id === 'string') : [];
    } catch {
      return [];
    }
  }

  async function writeMossCronTasks(tasks) {
    await fsp.mkdir(path.dirname(MOSS_CRON_FILE), { recursive: true });
    await fsp.writeFile(MOSS_CRON_FILE, `${JSON.stringify({ tasks }, null, 2)}\n`, 'utf8');
  }

  function resolveCronOwnerSessionId(taskId) {
    loadCronBindings();
    const record = findSessionForCronTask(taskId);
    return record?.id ?? null;
  }

  async function removeCronTasksForSession(sessionId) {
    loadCronBindings();
    const tasks = await readMossCronTasks();
    if (tasks.length === 0) return [];
    const removed = [];
    const remaining = tasks.filter((task) => {
      const owner = resolveCronOwnerSessionId(task.id);
      if (owner === sessionId) {
        removed.push(task);
        cronSessionBindings.delete(task.id);
        cronUnresolvableSince.delete(task.id);
        return false;
      }
      return true;
    });
    if (removed.length > 0) {
      await writeMossCronTasks(remaining);
      persistCronBindings();
      console.log(`[moss-cron] removed ${removed.length} task(s) bound to deleted session ${sessionId}`);
    }
    return removed;
  }

  ipcMain.handle('agent:cron-list', async () => {
    loadCronBindings();
    const tasks = await readMossCronTasks();
    const nowMs = Date.now();
    return {
      tasks: tasks.map((task) => {
        const ownerId = resolveCronOwnerSessionId(task.id);
        const ownerRecord = ownerId ? sessions.get(ownerId) : null;
        const executionRecord = findCronExecutionSession(task.id);
        const fields = parseMossCronExpression(task.cron);
        const enabled = task.enabled !== false;
        return {
          id: task.id,
          cron: task.cron,
          prompt: task.prompt,
          recurring: Boolean(task.recurring),
          createdAt: task.createdAt ?? null,
          lastFiredAt: task.lastFiredAt ?? null,
          enabled,
          orphaned: !ownerRecord,
          ownerSessionId: ownerRecord?.id ?? null,
          ownerSessionTitle: ownerRecord?.title ?? null,
          executionSessionId: executionRecord?.id ?? null,
          executionSessionTitle: executionRecord?.title ?? null,
          nextRunAt: enabled && fields ? computeNextCronRunMs(fields, nowMs) : null,
        };
      }),
    };
  });

  ipcMain.handle('agent:cron-remove', async (_event, { taskId }) => {
    const tasks = await readMossCronTasks();
    const remaining = tasks.filter((t) => t.id !== taskId);
    if (remaining.length === tasks.length) return { ok: false, error: 'Task not found.' };
    await writeMossCronTasks(remaining);
    cronSessionBindings.delete(taskId);
    cronUnresolvableSince.delete(taskId);
    persistCronBindings();
    return { ok: true };
  });

  ipcMain.handle('agent:cron-toggle', async (_event, { taskId, enabled }) => {
    const tasks = await readMossCronTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    task.enabled = Boolean(enabled);
    await writeMossCronTasks(tasks);
    return { ok: true, enabled: task.enabled };
  });

  ipcMain.handle('agent:cron-run-now', async (_event, { taskId }) => {
    const tasks = await readMossCronTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { ok: false, error: 'Task not found.' };
    const sessionRecord = findSessionForCronTask(task.id);
    if (!sessionRecord) return { ok: false, error: '归属会话不存在（孤儿任务）' };
    if (sessionRecord.projectId) {
      const project = readProjectSync(sessionRecord.projectId);
      if (!project || project.archivedAt) {
        return { ok: false, error: '项目已删除或项目记录不存在，不能再执行该定时任务。' };
      }
    }
    const executionSession = await getOrCreateCronExecutionSession(task, sessionRecord);
    if (executionSession.busy) return { ok: false, error: '定时任务会话正在执行，请稍后再试' };
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'Window not ready.' };
    task.lastFiredAt = Date.now();
    await writeMossCronTasks(tasks);
    void runSessionPrompt({
      sessionRecord: executionSession,
      sender: mainWindow.webContents,
      runtimePrompt: task.prompt,
      visibleUserPrompt: `⏰ 定时任务（手动触发）：${task.prompt}`,
    }).catch((err) => {
      console.warn('[moss-cron] manual run failed:', err?.message || err);
    });
    return { ok: true, sessionId: executionSession.id };
  });

  return {
    bindNewTasks: bindNewCronTasks,
    readTaskIds: readMossCronTaskIds,
    removeTasksForSession: removeCronTasksForSession,
    start: startMossCronScheduler,
  };
}
