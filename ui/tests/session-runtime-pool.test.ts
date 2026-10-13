import { expect, test } from 'bun:test';
import { SessionRuntimePool } from '../src/session-runtime-pool.mjs';

const delay = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };
function fixture(options: any = {}) {
  let now = 0, generation = 0;
  const policy = { sessionIdleMinutes: 60, maxSessionRuntimes: 15 };
  const saved = new Map(), disposed: string[] = [];
  const pool = new SessionRuntimePool({ getPolicy: () => policy, now: () => now,
    blocked: (record: any) => record.blocked || null,
    persist: async (record: any) => { if (record.diskFailed) throw new Error('disk full'); saved.set(record.id, [...record.history]); },
    dispose: (record: any) => {
      record.runtime = null; disposed.push(record.id);
      return pool.trackDisposal(record, delay());
    }, ...options });
  const record = (id: string): any => ({ id, runtime: null, history: [`history ${id}`] });
  const open = (r: any) => pool.ensure(r, async () => r.runtime || (r.runtime = { generation: ++generation }));
  return { pool, policy, saved, disposed, record, open, advance: (ms: number) => { now += ms; } };
}

test('60 minute idle retirement preserves history, restores on demand, and tracks real use', async () => {
  const f = fixture(), a = f.record('a');
  const first = await f.open(a);
  f.advance(59 * 60_000); await f.pool.sweep(); expect(a.runtime).toBe(first);
  await f.pool.use(a, async () => {});
  f.advance(59 * 60_000); await f.pool.sweep(); expect(a.runtime).toBe(first);
  f.advance(60_000); await f.pool.sweep(); expect(a.runtime).toBeNull();
  expect(f.saved.get('a')).toEqual(a.history);
  expect((await f.open(a)).generation).not.toBe(first.generation);
  expect(f.pool.stats().runtimes).toBe(1);
});

test('50 conversations never retain more than 15 runtimes; capacity evicts the least recently used idle runtime', async () => {
  const f = fixture(), records = Array.from({ length: 50 }, (_, i) => f.record(String(i)));
  for (const record of records) { f.advance(100); await f.open(record); expect(f.pool.stats().runtimes).toBeLessThanOrEqual(15); }
  expect(f.disposed).toEqual(records.slice(0, 35).map(r => r.id));
  expect(records.every(r => r.history.length === 1)).toBe(true);
  f.advance(3_600_000); await f.pool.sweep(); expect(f.pool.stats().runtimes).toBe(0);
});

test('active work, permission waits, background tasks and retained MCP state are protected', async () => {
  const f = fixture(), reasons = ['preparing', 'reply', 'permission', 'background', 'stateful-mcp'];
  const records = reasons.map(reason => ({ ...f.record(reason), blocked: reason }));
  await Promise.all(records.map(f.open)); f.advance(7_200_000); await f.pool.sweep();
  expect(f.disposed).toEqual([]);
  records.forEach(r => { r.blocked = null; }); await f.pool.sweep(); expect(f.pool.stats().runtimes).toBe(0);
});

test('a request arriving during persistence cancels retirement', async () => {
  const saving = deferred(), continueSave = deferred(), work = deferred();
  const f = fixture({ persist: async () => { saving.resolve(); await continueSave.promise; } }), a = f.record('a');
  const runtime = await f.open(a); f.advance(3_600_000);
  const sweep = f.pool.sweep(); await saving.promise;
  const request = f.pool.use(a, () => work.promise); continueSave.resolve(); await sweep;
  expect(a.runtime).toBe(runtime); expect(f.disposed).toEqual([]);
  work.resolve(); await request; await f.pool.sweep(); expect(a.runtime).toBe(runtime);
});

test('failed persistence retains the runtime, and lowering limits never interrupts active work', async () => {
  const f = fixture(), a = f.record('a'), b = f.record('b');
  await f.open(a); await f.open(b); a.diskFailed = true; b.blocked = 'background';
  f.policy.maxSessionRuntimes = 1; f.advance(3_600_000); await f.pool.sweep();
  expect(f.pool.stats().runtimes).toBe(2);
  a.diskFailed = false; await f.pool.sweep(); expect(f.pool.stats().runtimes).toBe(1); expect(b.runtime).not.toBeNull();
});

test('a request that finishes during persistence also cancels retirement, even within the same clock tick', async () => {
  const saving = deferred(), continueSave = deferred();
  const f = fixture({ persist: async () => { saving.resolve(); await continueSave.promise; } }), a = f.record('a');
  const runtime = await f.open(a); f.advance(3_600_000);
  const sweep = f.pool.sweep(); await saving.promise;
  await f.pool.use(a, async () => {}); continueSave.resolve(); await sweep;
  expect(a.runtime).toBe(runtime); expect(f.disposed).toEqual([]);
});

test('busy capacity has a bounded queue and timeout, then recovers after work ends', async () => {
  const f = fixture({ now: Date.now, queueTimeoutMs: 25, pollMs: 2, maxQueued: 1 });
  f.policy.maxSessionRuntimes = 1;
  const a = f.record('a'), b = f.record('b'); await f.open(a); a.blocked = 'active';
  const pending = f.open(b);
  await expect(f.open(f.record('overflow'))).rejects.toThrow('队列已满');
  await expect(pending).rejects.toThrow('上限');
  a.blocked = null; await f.open(b); expect(f.pool.stats().runtimes).toBe(1);
});

test('simultaneous requests reuse one creation; disposal remains counted and replacement waits', async () => {
  const closing = deferred(), f = fixture(), a = f.record('a');
  const [one, two] = await Promise.all([f.open(a), f.open(a)]); expect(one).toBe(two);
  const pending = f.pool.trackDisposal(a, closing.promise); a.runtime = null;
  const replacement = f.open(a); await delay(); expect(f.pool.stats().closing).toBe(1);
  closing.resolve(); await pending; expect((await replacement).generation).not.toBe(one.generation);
  expect(f.pool.stats().runtimes).toBe(1);
});

test('shutdown during creation reclaims the late runtime instead of resurrecting it', async () => {
  const f = fixture(), a = f.record('a'), starting = deferred(), finish = deferred();
  const pending = f.pool.ensure(a, async () => { starting.resolve(); await finish.promise; a.runtime = {}; });
  await starting.promise; f.pool.stop(); finish.resolve();
  await expect(pending).rejects.toThrow('停止'); expect(a.runtime).toBeNull(); expect(f.pool.stats().runtimes).toBe(0);
});

test('shutdown during replacement of an existing runtime also reclaims the late runtime', async () => {
  const f = fixture(), a = f.record('a'), starting = deferred(), finish = deferred();
  await f.open(a);
  const pending = f.pool.ensure(a, async () => { starting.resolve(); await finish.promise; a.runtime = { replacement: true }; });
  await starting.promise; f.pool.stop(); finish.resolve();
  await expect(pending).rejects.toThrow('停止'); expect(a.runtime).toBeNull(); expect(f.pool.stats().runtimes).toBe(0);
});

test('queue timeout includes slow serial creation and expired requests never create later', async () => {
  const f = fixture({ queueTimeoutMs: 20 }), starting = deferred(), finish = deferred();
  const a = f.record('slow'), b = f.record('queued');
  const first = f.pool.ensure(a, async () => { starting.resolve(); await finish.promise; a.runtime = {}; });
  await starting.promise;
  let created = false;
  const second = f.pool.ensure(b, async () => { created = true; b.runtime = {}; });
  await expect(Promise.race([second, delay(100).then(() => { throw new Error('deadline not enforced'); })])).rejects.toThrow('超时');
  finish.resolve(); await first; await f.pool.sweep();
  expect(created).toBe(false);
  expect(f.pool.stats().queued).toBe(0);
  await f.open(b); expect(b.runtime).not.toBeNull();
});

test('queue timeout includes slow disposal and does not start a late replacement', async () => {
  const f = fixture({ queueTimeoutMs: 20 }), closing = deferred(), a = f.record('closing');
  await f.open(a); a.runtime = null;
  const disposal = f.pool.trackDisposal(a, closing.promise);
  await expect(Promise.race([f.open(a), delay(100).then(() => { throw new Error('deadline not enforced'); })])).rejects.toThrow('超时');
  closing.resolve(); await disposal; await f.pool.sweep();
  expect(a.runtime).toBeNull();
  await f.open(a); expect(a.runtime).not.toBeNull();
});
