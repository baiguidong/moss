import { describe, expect, it } from 'bun:test';
import { Database } from 'bun:sqlite';

import {
  migrateCronSessionIndex,
  mossCronMatches,
  parseMossCronExpression,
} from '../src/moss-cron-scheduler.mjs';

describe('Moss cron expressions', () => {
  it('supports ranges, lists, steps, and Sunday aliases', () => {
    const fields = parseMossCronExpression('*/15 9-10 * * 0,7');
    expect(fields).not.toBeNull();
    expect(mossCronMatches(fields!, new Date(2024, 0, 7, 9, 30))).toBe(true);
    expect(mossCronMatches(fields!, new Date(2024, 0, 7, 9, 31))).toBe(false);
    expect(parseMossCronExpression('60 * * * *')).toBeNull();
  });

  it('uses standard OR semantics when day-of-month and day-of-week are restricted', () => {
    const fields = parseMossCronExpression('0 12 1 * 1');
    expect(fields).not.toBeNull();
    expect(mossCronMatches(fields!, new Date(2024, 0, 8, 12, 0))).toBe(true);
    expect(mossCronMatches(fields!, new Date(2024, 1, 1, 12, 0))).toBe(true);
    expect(mossCronMatches(fields!, new Date(2024, 1, 2, 12, 0))).toBe(false);
  });
});

describe('cron execution session storage', () => {
  it.each([false, true])('preserves separate runs with a legacy unique index: %s', (legacy) => {
    const db = new Database(':memory:');
    try {
      db.exec(`CREATE TABLE sessions (
        id TEXT PRIMARY KEY, session_kind TEXT, cron_task_id TEXT,
        created_at INTEGER, history_json TEXT
      )`);
      if (legacy) db.exec(`CREATE UNIQUE INDEX idx_sessions_cron_task_id
        ON sessions(cron_task_id) WHERE session_kind = 'cron' AND cron_task_id IS NOT NULL`);
      const insert = db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?)');
      const history = JSON.stringify([{ type: 'assistant', message: { content: 'Previous result' } }]);
      insert.run('first', 'cron', 'job-1', at(9, 5), history);

      migrateCronSessionIndex(db);
      insert.run('second', 'cron', 'job-1', at(9, 10), '[]');
      migrateCronSessionIndex(db);
      insert.run('third', 'cron', 'job-1', at(9, 15), '[]');

      expect(db.prepare('SELECT id FROM sessions ORDER BY created_at DESC').all()).toEqual([
        { id: 'third' }, { id: 'second' }, { id: 'first' },
      ]);
      expect(db.prepare('SELECT history_json FROM sessions WHERE id = ?').get('first')).toEqual({ history_json: history });
      expect(() => insert.run('first', 'cron', 'job-2', at(9, 20), '[]')).toThrow();
    } finally { db.close(); }
  });
});

import { afterEach, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMossCronScheduler } from '../src/moss-cron-scheduler.mjs';
import { readCronTaskStore, updateCronTaskStore } from '../../shared/cron-task-store.mjs';
import { registerCronIpcHandlers } from '../src/cron-tasks-ipc.mjs';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const at = (hour: number, minute: number, second = 0) => new Date(2026, 8, 24, hour, minute, second).getTime();
const job = (overrides: any = {}) => ({
  id: 'job-1', cron: '*/5 * * * *', prompt: 'report', recurring: true,
  durable: true, ownerSessionId: 'owner', createdAt: at(9, 0), ...overrides,
});

async function fixture(tasks: any[], options: any = {}) {
  const root = await mkdtemp(join(tmpdir(), 'moss-cron-scheduler-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const filePath = join(root, 'cron_tasks.json');
  await updateCronTaskStore(filePath, list => list.push(...tasks));
  let time = options.now ?? at(9, 6);
  const sessions = new Map<string, any>([
    ['owner', { id: 'owner', title: 'Source', workspace: '/workspace', agentMode: 'local', permissionMode: 'default', history: options.history || [] }],
  ]);
  const calls: any[] = [];
  function create(hostId = 'desktop-1') {
    const handlers = new Map<string, any>();
    const scheduler = createMossCronScheduler({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      mossHome: root, sessions, sessionDb: null, hostId,
      getMainWindow: () => null,
      now: () => time,
      normalizePreviewText: value => value,
      createSessionRecord: input => {
        const record = { ...input, id: `exec-${sessions.size}`, busy: false, createdAt: time, history: [], underlyingSessionId: null, runtime: null };
        sessions.set(record.id, record);
        return record;
      },
      linkSessionToProject: async () => {}, readProjectSync: () => null,
      runSessionPrompt: async input => { calls.push(input); return options.run?.(input); },
    });
    cleanups.push(async () => scheduler.stop());
    return { scheduler, invoke: (name: string, payload = {}) => handlers.get(`agent:cron-${name}`)(null, payload) };
  }
  return {
    ...create(), create, calls, sessions, filePath,
    read: () => readCronTaskStore(filePath),
    setTime: (value: number) => { time = value; },
  };
}

describe('desktop cron lifecycle', () => {
  test('each scheduled or manual run starts empty and the task opens its latest execution', async () => {
    const inputHistories: unknown[][] = [];
    const f = await fixture([job()], {
      history: [{ type: 'user', message: { content: 'Owner conversation must not be inherited' } }],
      run: ({ sessionRecord, runtimePrompt }) => {
        inputHistories.push([...sessionRecord.history]);
        expect(sessionRecord.underlyingSessionId).toBeNull();
        expect(sessionRecord.runtime).toBeNull();
        sessionRecord.history.push({ type: 'user', message: { content: runtimePrompt } });
        sessionRecord.history.push({ type: 'assistant', message: { content: 'Previous result' } });
        sessionRecord.underlyingSessionId = `engine-${sessionRecord.id}`;
        sessionRecord.runtime = { history: sessionRecord.history };
      },
    });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    const first = f.calls[0].sessionRecord;
    f.setTime(at(9, 10));
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    const second = f.calls[1].sessionRecord;
    f.setTime(at(9, 11));
    const manual = await f.invoke('run-now', { taskId: 'job-1' });
    expect(manual.ok).toBe(true);
    const third = f.calls[2].sessionRecord;
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(inputHistories).toEqual([[], [], []]);
    expect(first.history).toHaveLength(2);
    expect(second.history).toHaveLength(2);
    expect(f.calls.every(call => call.runtimePrompt === 'report')).toBe(true);
    expect((await f.invoke('list')).tasks[0].executionSessionId).toBe(third.id);
    // Restored records need not be ordered by creation time in the session map.
    first.updatedAt = at(9, 12);
    f.sessions.delete(first.id); f.sessions.set(first.id, first);
    expect((await f.create('desktop-2').invoke('list')).tasks[0].executionSessionId).toBe(third.id);
    expect(first).toMatchObject({ workspace: '/workspace', sourceSessionId: 'owner', cronTaskId: 'job-1' });
  });

  test('sends once and waits for the reply across repeated ticks and manual requests', async () => {
    let finish!: () => void;
    let started!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const ready = new Promise<void>(resolve => { started = resolve; });
    const f = await fixture([job()], { run: () => { started(); return pending; } });
    let completed = false;
    const manual = f.invoke('run-now', { taskId: 'job-1' }).then(result => { completed = true; return result; });
    await ready;
    f.setTime(at(9, 25));
    for (let index = 0; index < 3; index++) await f.scheduler.tick();
    expect(await f.invoke('run-now', { taskId: 'job-1' })).toMatchObject({ ok: false });
    expect(completed).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect((await f.read())[0].status).toBe('running');
    finish();
    expect(await manual).toMatchObject({ ok: true, sessionId: f.calls[0].sessionRecord.id });
    expect((await f.read())[0]).toMatchObject({ status: 'idle', nextRunAt: at(9, 30) });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
  });

  test('legacy IPC deletes by preload taskId without losing concurrent scheduler updates', async () => {
    const f = await fixture([job()]);
    const handlers = new Map<string, any>();
    registerCronIpcHandlers({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      mossHome: join(f.filePath, '..'),
    });
    const results = await Promise.all([
      handlers.get('cron:delete')(null, { taskId: 'job-1' }),
      updateCronTaskStore(f.filePath, tasks => tasks.push(job({ id: 'concurrent' }))),
    ]);
    expect(results[0]).toEqual({ ok: true });
    expect((await handlers.get('cron:list')()).map(task => task.id)).toEqual(['concurrent']);
    await handlers.get('cron:delete')(null, { id: 'concurrent' });
    expect(await f.read()).toEqual([]);
  });

  test('runs without a window and coalesces missed periods into one execution', async () => {
    const f = await fixture([job()], { now: at(10, 2) });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ sender: null, failOnApiError: true, sessionRecord: { sourceSessionId: 'owner', sessionKind: 'cron', permissionMode: 'default' } });
    expect((await f.read())[0]).toMatchObject({ nextRunAt: at(10, 5), lastCompletedAt: at(10, 2), status: 'idle' });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
    const restarted = f.create('desktop-2');
    await restarted.scheduler.tick(); await restarted.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
  });

  test('does not fire immediately just because the creation minute matches cron', async () => {
    const f = await fixture([job({ createdAt: at(9, 5, 10) })], { now: at(9, 5, 20) });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(0);
    f.setTime(at(9, 10));
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
  });

  test('expires session-only tasks from a previous desktop run, preserving current and durable tasks', async () => {
    const f = await fixture([
      job({ id: 'old', durable: false, desktopHostId: 'desktop-old' }),
      job({ id: 'current', durable: false, desktopHostId: 'desktop-1' }),
      job({ id: 'durable', desktopHostId: 'desktop-old' }),
    ]);
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect((await f.read()).map(task => task.id).sort()).toEqual(['current', 'durable']);
    expect(f.calls).toHaveLength(2);
  });

  test('keeps a busy task due after its scheduled minute has passed', async () => {
    const f = await fixture([job()]);
    f.sessions.set('busy', { id: 'busy', sessionKind: 'cron', cronTaskId: 'job-1', busy: true, createdAt: at(9, 1) });
    f.sessions.set('idle', { id: 'idle', sessionKind: 'cron', cronTaskId: 'job-1', busy: false, createdAt: at(9, 2) });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(0);
    f.setTime(at(9, 8)); f.sessions.get('busy').busy = false;
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
  });

  test('does not expire future one-shot reminders after 24 hours and catches up overdue ones', async () => {
    const future = new Date(2026, 8, 27, 12).getTime();
    const f = await fixture([job({ recurring: false, cron: '0 12 27 9 *', createdAt: at(9, 0) })], { now: future - 60_000 });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(await f.read()).toHaveLength(1);
    expect(f.calls).toHaveLength(0);
    f.setTime(future + 10 * 60_000);
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
    expect(await f.read()).toEqual([]);
  });

  test('keeps failed one-shots paused, reports the error, and allows manual retry', async () => {
    let fail = true;
    const f = await fixture([job({ recurring: false })], { run: () => { if (fail) throw new Error('API unavailable'); } });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect((await f.read())[0]).toMatchObject({ status: 'failed', enabled: false, lastError: 'API unavailable' });
    f.setTime(at(9, 10));
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(1);
    fail = false;
    expect(await f.invoke('run-now', { taskId: 'job-1' })).toMatchObject({ ok: true });
    expect(f.calls[1].sessionRecord.id).not.toBe(f.calls[0].sessionRecord.id);
    expect(await f.read()).toEqual([]);
  });

  test('pauses an interrupted run after restart instead of repeating possible side effects', async () => {
    const f = await fixture([job({ runId: 'unfinished', runHostId: 'desktop-old', status: 'running' })]);
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    expect(f.calls).toHaveLength(0);
    expect((await f.read())[0]).toMatchObject({ enabled: false, status: 'failed' });
    expect((await f.invoke('list')).tasks[0].lastError).toContain('中断');
  });

  test('serializes manual/automatic runs and never resurrects a concurrent deletion', async () => {
    let complete!: () => void;
    let started!: () => void;
    const didStart = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const f = await fixture([job({ recurring: false })], { run: () => { started(); return pending; } });
    await f.scheduler.tick(); await didStart;
    expect(await f.invoke('run-now', { taskId: 'job-1' })).toMatchObject({ ok: false });
    expect(await f.invoke('remove', { taskId: 'job-1' })).toEqual({ ok: true });
    await updateCronTaskStore(f.filePath, tasks => tasks.push(job({ id: 'new-job' })));
    complete(); await f.scheduler.waitForIdle();
    expect((await f.read()).map(task => task.id)).toEqual(['new-job']);
    expect(f.calls).toHaveLength(1);
  });

  test('preserves a pause made during execution and resumes from the next future occurrence', async () => {
    let complete!: () => void;
    let started!: () => void;
    const didStart = new Promise<void>(resolve => { started = resolve; });
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const f = await fixture([job()], { run: () => { started(); return pending; } });
    await f.scheduler.tick(); await didStart;
    await f.invoke('toggle', { taskId: 'job-1', enabled: false });
    complete(); await f.scheduler.waitForIdle();
    expect((await f.read())[0].enabled).toBe(false);
    f.setTime(at(10, 1));
    await f.invoke('toggle', { taskId: 'job-1', enabled: true });
    expect((await f.read())[0].nextRunAt).toBe(at(10, 5));
  });

  test('migrates proven durable legacy jobs and removes proven session-only jobs', async () => {
    const history = [
      { message: { content: [
        { type: 'tool_use', id: 'call-1', name: 'CronCreate', input: { durable: false } },
        { type: 'tool_use', id: 'call-2', name: 'CronCreate', input: { durable: true } },
      ] } },
      { message: { content: [
        { type: 'tool_result', tool_use_id: 'call-1', content: 'Scheduled recurring job old-session' },
        { type: 'tool_result', tool_use_id: 'call-2', content: 'Scheduled recurring job old-durable' },
      ] } },
    ];
    const f = await fixture([
      job({ id: 'old-session', durable: undefined, ownerSessionId: undefined }),
      job({ id: 'old-durable', durable: undefined, ownerSessionId: undefined }),
      job({ id: 'unknown', durable: undefined }),
    ], { history });
    await f.scheduler.tick(); await f.scheduler.waitForIdle();
    const tasks = await f.read();
    expect(tasks.map(task => task.id).sort()).toEqual(['old-durable', 'unknown']);
    expect(tasks.find(task => task.id === 'unknown')).toMatchObject({ enabled: false });
    expect(f.calls).toHaveLength(1);
  });
});
