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

  it('cancels only an unaccepted message and refuses to cancel after the receipt boundary', async () => {
    const cancellation = createSessionSendCancellation();
    let releasePreparing;
    const preparing = new Promise(resolve => { releasePreparing = resolve; });
    let accept;
    const first = cancellation.run('one', async (_signal, markAccepted) => {
      accept = markAccepted;
      await preparing;
      markAccepted();
      return 'accepted';
    }, 'first');
    expect(cancellation.cancel('one', 'first')).toMatchObject({ canceled: true });
    releasePreparing();
    await expect(first).rejects.toThrow();
    let releaseAccepted;
    const second = cancellation.run('one', async (_signal, markAccepted) => {
      markAccepted();
      await new Promise(resolve => { releaseAccepted = resolve; });
      return 'accepted';
    }, 'second');
    expect(cancellation.cancel('one', 'second')).toMatchObject({ canceled: false });
    releaseAccepted();
    await expect(second).resolves.toBe('accepted');
    expect(typeof accept).toBe('function');
  });

  it('consumes a pre-send cancel tombstone so the same draft ID can be retried', async () => {
    const cancellation = createSessionSendCancellation();
    expect(cancellation.cancel('one', 'retry-me')).toMatchObject({ canceled: true });
    await expect(cancellation.run('one', async signal => {
      signal.throwIfAborted();
      return 'unreachable';
    }, 'retry-me')).rejects.toThrow();
    await expect(cancellation.run('one', async signal => {
      signal.throwIfAborted();
      return 'retried';
    }, 'retry-me')).resolves.toBe('retried');
  });
});
