import { describe, expect, test } from 'bun:test';
import { createOfflineAwareFetch } from '../src/remote-network-fetch.mjs';

const server = 'https://moss.example.test';
const connectionClosed = () => new Error('net::ERR_CONNECTION_CLOSED');

describe('offline-aware desktop server transport', () => {
  test('does not open network connections while offline, while allowing a local server', async () => {
    const requests: string[] = [];
    const fetch = createOfflineAwareFetch({
      isOnline: () => false,
      fetchImpl: async (url: string) => { requests.push(url); return Response.json({ ok: true }); },
    });
    for (let i = 0; i < 20; i++) {
      await expect(fetch(`${server}/sessions`)).rejects.toMatchObject({ code: 'MOSS_NETWORK_OFFLINE' });
    }
    for (const local of ['http://localhost:43127', 'http://127.0.0.1:43127', 'http://[::1]:43127']) {
      expect((await fetch(local)).ok).toBe(true);
    }
    expect(requests).toHaveLength(3);
  });

  test('session sync and mailbox requests share exponential backoff up to five minutes', async () => {
    let time = 0;
    let requests = 0;
    const failure = connectionClosed();
    const fetch = createOfflineAwareFetch({
      now: () => time,
      fetchImpl: async () => { requests++; throw failure; },
    });
    await expect(fetch(`${server}/api/v1/auth/token`)).rejects.toBe(failure);
    for (const [index, delay] of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000].entries()) {
      for (let elapsed = 5_000; elapsed < delay; elapsed += 5_000) {
        time += 5_000;
        await expect(fetch(`${server}/api/v1/sessions`)).rejects.toBe(failure);
        await expect(fetch(`${server}/api/v1/agent-mail/pull`, { method: 'POST' })).rejects.toBe(failure);
      }
      expect(requests).toBe(index + 1);
      time += 5_000;
      await expect(fetch(`${server}/api/v1/sessions`)).rejects.toBe(failure);
      expect(requests).toBe(index + 2);
    }
  });

  test('only one request probes an unavailable origin when its cooldown expires', async () => {
    let time = 0;
    let requests = 0;
    let finishProbe!: (response: Response) => void;
    const failure = connectionClosed();
    const fetch = createOfflineAwareFetch({
      now: () => time,
      fetchImpl: async () => {
        requests++;
        if (requests === 1) throw failure;
        return new Promise<Response>(resolve => { finishProbe = resolve; });
      },
    });
    await expect(fetch(`${server}/sessions`)).rejects.toBe(failure);
    time = 30_000;
    const probe = fetch(`${server}/sessions`);
    await expect(fetch(`${server}/mail`)).rejects.toBe(failure);
    await expect(fetch(`${server}/usage`)).rejects.toBe(failure);
    expect(requests).toBe(2);
    finishProbe(Response.json({ ok: true }));
    expect((await probe).ok).toBe(true);
    const next = fetch(`${server}/mail`);
    expect(requests).toBe(3);
    finishProbe(Response.json({ ok: true }));
    await next;
  });

  test('network restoration and explicit reconnect bypass an old cooldown', async () => {
    let online = true;
    let requests = 0;
    const fetch = createOfflineAwareFetch({
      isOnline: () => online,
      fetchImpl: async () => { requests++; throw connectionClosed(); },
    });
    await expect(fetch(server)).rejects.toThrow();
    await expect(fetch(server)).rejects.toThrow();
    expect(requests).toBe(1);
    online = false;
    await expect(fetch(server)).rejects.toMatchObject({ code: 'MOSS_NETWORK_OFFLINE' });
    online = true;
    await expect(fetch(server)).rejects.toThrow();
    expect(requests).toBe(2);
    fetch.reset(server);
    await expect(fetch(server)).rejects.toThrow();
    expect(requests).toBe(3);
  });

  test('an unreachable server does not block other origins or alter request options', async () => {
    const requests: unknown[] = [];
    const fetch = createOfflineAwareFetch({
      fetchImpl: async (input: string, init: unknown) => {
        requests.push([input, init]);
        if (input.startsWith(server)) throw connectionClosed();
        return Response.json({ ok: true });
      },
    });
    await expect(fetch(server)).rejects.toThrow();
    const options = { method: 'POST', headers: { authorization: 'Bearer test' }, body: 'payload' };
    expect((await fetch('https://another.example.test/api', options)).ok).toBe(true);
    expect(requests[1]).toEqual(['https://another.example.test/api', options]);
    await expect(fetch(server)).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });

  test('a reachable HTTP response resets backoff and preserves HTTP error handling', async () => {
    let time = 0;
    let reachable = false;
    let requests = 0;
    const fetch = createOfflineAwareFetch({
      now: () => time,
      fetchImpl: async () => {
        requests++;
        if (!reachable) throw connectionClosed();
        return new Response('Unauthorized', { status: 401 });
      },
    });
    await expect(fetch(server)).rejects.toThrow();
    time = 30_000;
    reachable = true;
    expect((await fetch(server)).status).toBe(401);
    expect((await fetch(server)).status).toBe(401);
    reachable = false;
    await expect(fetch(server)).rejects.toThrow();
    time += 30_000;
    await expect(fetch(server)).rejects.toThrow();
    expect(requests).toBe(5);
  });

  test('aborts, certificate failures and programming errors remain unchanged', async () => {
    for (const failure of [new DOMException('Cancelled', 'AbortError'), new Error('net::ERR_CERT_AUTHORITY_INVALID'), new TypeError('Invalid URL')]) {
      let requests = 0;
      const fetch = createOfflineAwareFetch({ fetchImpl: async () => { requests++; throw failure; } });
      await expect(fetch(server)).rejects.toBe(failure);
      await expect(fetch(server)).rejects.toBe(failure);
      expect(requests).toBe(2);
      await expect(fetch(server, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
      expect(requests).toBe(2);
    }
  });
});
