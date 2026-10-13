import { describe, test, expect } from 'bun:test'
import { AsyncLocalStorage } from 'node:async_hooks'
import { McpConnectionPool, type ConnectionControls } from './connectionPool'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const owner = () => { const controller = new AbortController(); return { controller, id: crypto.randomUUID(), signal: controller.signal } }
const pool = (maxConnections = 4, maxStarting = 2, maxQueued = 8) => new McpConnectionPool<{ type: string; cleanup(): Promise<void>; value?: string }>({ maxConnections, maxStarting, maxQueued })

describe('MCP connection ownership and budgets', () => {
  test('deduplicates one generation, isolates sessions, and disposing A leaves B alive', async () => {
    const p = pool(), a = owner(), b = owner(); let started = 0, closed = 0
    const factory = async () => { started++; return { type: 'connected', cleanup: async () => { closed++ } } }
    const first = p.acquire(a.id, a, factory)
    expect(p.acquire(a.id, a, factory)).toBe(first)
    await Promise.all([first, p.acquire(b.id, b, factory)])
    a.controller.abort(); await p.closeOwner(a.id)
    expect(started).toBe(2); expect(closed).toBe(1); expect(p.stats().connections).toBe(1)
    await expect(p.acquire(a.id, a, factory)).rejects.toThrow('released')
    b.controller.abort(); await p.closeOwner(b.id)
    expect(p.stats().entries).toBe(0)
    await p.close('missing'); expect(started).toBe(2)
  })
  test('cancels queued and in-flight starts without resurrecting disposed resources', async () => {
    const p = pool(3, 1), a = owner(), b = owner(); let queuedStarted = false, disposed = 0
    const running = p.acquire('running', a, async () => { await sleep(30); return { type: 'connected', cleanup: async () => { disposed++ } } })
    const queued = p.acquire('queued', b, async () => { queuedStarted = true; return { type: 'connected', cleanup: async () => {} } })
    a.controller.abort(); b.controller.abort()
    const aborted = { name: 'AbortError', message: 'MCP connection was released by its session' }
    for (const result of await Promise.allSettled([running, queued])) {
      expect(result.status).toBe('rejected')
      if (result.status === 'rejected') expect(result.reason).toMatchObject(aborted)
    }
    await Promise.all([p.closeOwner(a.id), p.closeOwner(b.id)])
    expect(queuedStarted).toBe(false)
    // Cancellation can prevent the factory's initial microtask entirely.
    expect(disposed).toBeLessThanOrEqual(1); expect(p.stats().entries).toBe(0)
  })
  test('reclaims a factory result that arrives after cancellation', async () => {
    const p = pool(), a = owner(); let closed = 0, didStart!: () => void
    const started = new Promise<void>(yes => { didStart = yes })
    const result = p.acquire('late', a, async () => { didStart(); await sleep(30); return { type: 'connected', cleanup: async () => { closed++ } } })
    await started; a.controller.abort()
    await expect(result).rejects.toThrow('released'); await p.closeOwner(a.id)
    expect(closed).toBe(1); expect(p.stats().entries).toBe(0)
  })
  test('enforces global startup, active and queue limits and recovers capacity', async () => {
    const p = pool(2, 1, 1); let opening = 0, peak = 0
    const factory = async () => { peak = Math.max(peak, ++opening); await sleep(20); opening--; return { type: 'connected', cleanup: async () => {} } }
    const a = p.acquire('a', undefined, factory), b = p.acquire('b', undefined, factory)
    await expect(p.acquire('overflow', undefined, factory)).rejects.toThrow('队列')
    await Promise.all([a, b]); expect(peak).toBe(1)
    await expect(p.acquire('c', undefined, factory)).rejects.toThrow('上限')
    await p.close('a'); await p.acquire('c', undefined, factory)
    await Promise.all([p.close('b'), p.close('c')]); expect(p.stats().connections).toBe(0)
  })
  test('queued factories retain their original session context', async () => {
    const als = new AsyncLocalStorage<string>(), p = pool(2, 1)
    const factory = async () => { await sleep(10); return { type: 'connected', value: als.getStore(), cleanup: async () => {} } }
    const a = als.run('session A', () => p.acquire('a', undefined, factory))
    const b = als.run('session B', () => p.acquire('b', undefined, factory))
    expect((await a).value).toBe('session A'); expect((await b).value).toBe('session B')
    await Promise.all([p.close('a'), p.close('b')])
  })
  test('idle recycling is opt-in and never interrupts active requests', async () => {
    const p = pool(); let controls!: ConnectionControls, closed = 0
    await p.acquire('stateless', undefined, async value => { controls = value; return { type: 'connected', cleanup: async () => { closed++ } } }, 25)
    await p.acquire('stateful', undefined, async () => ({ type: 'connected', cleanup: async () => { closed++ } }))
    const release = controls.beginRequest(); await sleep(65)
    expect(closed).toBe(0); release(); await sleep(60)
    expect(closed).toBe(1); expect(p.has('stateful')).toBe(true)
    await p.close('stateful'); expect(closed).toBe(2)
  })
  test('hundreds of runtime generations release all slots and listeners', async () => {
    const p = pool()
    for (let i = 0; i < 150; i++) {
      const a = owner()
      await p.acquire(`a-${i}`, a, async () => ({ type: 'connected', cleanup: async () => {} }))
      a.controller.abort(); await p.closeOwner(a.id)
    }
    expect(p.stats()).toEqual({ connections: 0, starting: 0, queued: 0, entries: 0 })
  })
  test('changing idle policy applies to existing restart-safe connections without resetting last use or stateful policy', async () => {
    const p = pool(), a = owner();
    const factory = async () => ({ type: 'connected', cleanup: async () => {} });
    await p.acquire('safe', a, factory, 1000); await p.acquire('stateful', a, factory);
    expect(p.ownerStats(a.id).retainedState).toBe(true);
    await sleep(35); p.updateOwnerIdle(a.id, 20); await sleep(20);
    expect(p.has('safe')).toBe(false); expect(p.has('stateful')).toBe(true);
    await p.closeOwner(a.id);
  })
  test('updating idle settings during startup waits for initialization to finish', async () => {
    const p = pool(), a = owner(); let controls!: ConnectionControls, finish!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const starting = new Promise<void>(resolve => { started = resolve; });
    const pending = p.acquire('starting', a, async value => {
      controls = value; started(); await gate;
      return { type: 'connected', cleanup: async () => {} };
    }, 1000);
    try {
      await starting; p.updateOwnerIdle(a.id, 20); await sleep(40);
      expect(controls.signal.aborted).toBe(false);
      finish(); await pending; await sleep(50); expect(p.has('starting')).toBe(false);
    } finally { finish(); await p.closeOwner(a.id); }
  })
})
