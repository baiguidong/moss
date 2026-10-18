import { describe, expect, it } from 'bun:test';
import { createSessionSendCancellation } from '../src/session-send-cancellation.mjs';
import { runInKeyedQueue } from '../src/shared/keyed-queue.mjs';

describe('send cancellation before runtime creation', () => {
  it('cancels queued and preparing sends without poisoning the next send', async () => {
    const cancellation = createSessionSendCancellation(), queue = new Map();
    let release, prepared;
    const gate = new Promise(resolve => { release = resolve; });
    const preparing = new Promise(resolve => { prepared = resolve; });
    const requests = [];
    const send = (id, token, prepare = false) => cancellation.run(id, signal => runInKeyedQueue(queue, id, async () => {
      signal.throwIfAborted();
      if (prepare) { prepared(); await gate; }
      signal.throwIfAborted();
      requests.push(token);
    }));
    const first = send('one', 'first', true);
    await preparing;
    const queued = send('one', 'queued');
    const settled = Promise.allSettled([first, queued]);
    cancellation.abort('one');
    await send('two', 'independent');
    release();
    expect((await settled).map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(requests).toEqual(['independent']);
    await send('one', 'recovered');
    expect(requests).toEqual(['independent', 'recovered']);
  });

  it('remembers Stop issued synchronously before a queue starts', async () => {
    const cancellation = createSessionSendCancellation(), queue = new Map();
    let called = false;
    const send = cancellation.run('one', signal => runInKeyedQueue(queue, 'one', () => {
      signal.throwIfAborted(); called = true;
    }));
    cancellation.abort('one');
    await expect(send).rejects.toThrow();
    expect(called).toBe(false);
  });
});
