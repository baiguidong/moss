import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  createRemoteSessionTaskSync,
  snapshotRemoteSessionTasks,
  startSessionTaskPolling,
} from '../src/session-tasks.mjs';

function deferred() {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const record: any = { id: 'desktop-id', underlyingSessionId: 'cloud-id', agentMode: 'remote-direct' };
  const events: any[] = [];
  const requests: any[] = [];
  let tasks: any[] = [{ id: '1', subject: '分析任务', status: 'pending' }];
  let error: Error | undefined;
  let waitFor: Promise<any> | undefined;
  const sync = createRemoteSessionTaskSync({
    resolveConnection: async () => ({ serverUrl: 'https://cloud.test', authToken: 'token' }),
    fetchTasks: async (input) => {
      requests.push(input);
      if (waitFor) await waitFor;
      if (error) throw error;
      return { tasks };
    },
    onTasks: (record, tasks) => events.push({ sessionId: record.id, tasks }),
  });
  return {
    record, events, requests, sync,
    setTasks: (value: any[]) => { tasks = value; },
    setError: (value?: Error) => { error = value; },
    waitFor: (value: Promise<any>) => { waitFor = value; },
  };
}

test('cloud tasks use the server ID and publish changes to the desktop ID, including deletions', async () => {
  const h = harness();
  h.setTasks([
    { id: '10', subject: '验证', status: 'pending', blockedBy: ['2', 1] },
    { id: '2', subject: '分析', status: 'in_progress', activeForm: '正在分析', owner: 'worker' },
    { id: '3', subject: '内部', metadata: { _internal: true } },
    { subject: 'invalid' },
  ]);
  await h.sync(h.record);
  expect(h.requests[0]).toEqual({ serverUrl: 'https://cloud.test', authToken: 'token', sessionId: 'cloud-id' });
  expect(h.events[0].sessionId).toBe('desktop-id');
  expect(snapshotRemoteSessionTasks(h.record)).toEqual([
    { id: '2', subject: '分析', status: 'in_progress', activeForm: '正在分析', owner: 'worker', description: '', blockedBy: [] },
    { id: '10', subject: '验证', status: 'pending', activeForm: '', owner: null, description: '', blockedBy: ['2'] },
  ]);
  await h.sync(h.record);
  expect(h.events).toHaveLength(1);
  h.setTasks([{ id: '2', subject: '分析', status: 'completed' }]);
  await h.sync(h.record);
  expect(h.events.at(-1).tasks[0].status).toBe('completed');
  h.setTasks([]);
  await h.sync(h.record);
  expect(h.events.at(-1).tasks).toEqual([]);
  expect(snapshotRemoteSessionTasks(h.record)).toEqual([]);
});

test('failed requests retain the last snapshot and can be retried', async () => {
  const h = harness();
  await h.sync(h.record);
  h.setError(new Error('offline'));
  await expect(h.sync(h.record)).rejects.toThrow('offline');
  expect(snapshotRemoteSessionTasks(h.record)[0].status).toBe('pending');
  expect(h.events).toHaveLength(1);
  h.setError();
  h.setTasks([{ id: '1', subject: '分析任务', status: 'completed' }]);
  await h.sync(h.record);
  expect(snapshotRemoteSessionTasks(h.record)[0].status).toBe('completed');
});

test('overlapping requests are deduplicated and stale results cannot update reassigned or deleted sessions', async () => {
  const h = harness();
  const gate = deferred();
  h.waitFor(gate.promise);
  const request = h.sync(h.record);
  expect(h.sync(h.record)).toBe(request);
  await Promise.resolve();
  expect(h.requests).toHaveLength(1);
  h.record.underlyingSessionId = 'different-cloud-id';
  gate.resolve();
  await request;
  expect(h.events).toEqual([]);
  expect(snapshotRemoteSessionTasks(h.record)).toEqual([]);
  await h.sync(h.record);
  expect(snapshotRemoteSessionTasks(h.record)).toHaveLength(1);
  h.record.underlyingSessionId = 'third-cloud-id';
  expect(snapshotRemoteSessionTasks(h.record)).toEqual([]);
  const pending = h.sync(h.record);
  h.record.deleted = true;
  await pending;
  expect(h.events).toHaveLength(1);
});

test('local and uncreated cloud sessions do not make remote requests', async () => {
  const h = harness();
  await h.sync({ id: 'local', agentMode: 'local' });
  await h.sync({ id: 'new-cloud', agentMode: 'remote-direct' });
  expect(h.requests).toEqual([]);
});

test('polls immediately, waits five seconds after completion, retries failures and stops on cleanup', async () => {
  const gate = deferred();
  const timers: any[] = [];
  const cleared: any[] = [];
  let calls = 0;
  const stop = startSessionTaskPolling(async () => {
    calls++;
    if (calls === 1) await gate.promise;
    else throw new Error('offline');
  }, {
    setTimer: (callback, delay) => { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimer: timer => cleared.push(timer),
  });
  expect(calls).toBe(1);
  expect(timers).toEqual([]);
  gate.resolve();
  await gate.promise;
  await Promise.resolve();
  expect(timers[0].delay).toBe(5_000);
  await timers[0].callback();
  expect(calls).toBe(2);
  expect(timers).toHaveLength(2);
  stop();
  expect(cleared).toEqual([timers[1]]);

  const inFlight = deferred();
  const stopInFlight = startSessionTaskPolling(() => inFlight.promise, {
    setTimer: () => { throw new Error('Scheduled after unmount'); }, clearTimer: () => {},
  });
  stopInFlight();
  inFlight.resolve();
  await inFlight.promise;
});

test('desktop snapshots and the task IPC use cloud data without reading the local task directory', async () => {
  const source = readFileSync(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const h = harness();
  await h.sync(h.record);
  const snapshotSource = source.slice(source.indexOf('function snapshotSessionTasks('), source.indexOf('function attachSessionTaskWatcher('));
  const ipcStart = source.indexOf("ipcMain.handle('agent:list-session-tasks'");
  let handler!: (...args: any[]) => Promise<any>;
  const context: any = {
    snapshotRemoteSessionTasks,
    getSessionTasksDir: () => { throw new Error('Cloud task snapshot used local storage'); },
    getSessionRecord: () => h.record,
    syncRemoteSessionTasks: h.sync,
    ipcMain: { handle: (_name, callback) => { handler = callback; } },
  };
  runInNewContext(snapshotSource + source.slice(ipcStart, source.indexOf('function getTurnRewindSupport(', ipcStart)), context);
  expect(context.snapshotSessionTasks(h.record)[0].subject).toBe('分析任务');
  expect((await handler(null, { sessionId: 'desktop-id' })).tasks[0].subject).toBe('分析任务');
});
