import { describe, expect, it } from 'bun:test';
import { loadDesktopPreload } from './helpers/desktop-preload';

describe('Desktop preload subscriptions', () => {
  for (const [method, channel] of [
    ['onEvent', 'agent:event'], ['onState', 'agent:state'],
    ['onQuestionRequest', 'agent:question-request'], ['onQuestionResolved', 'agent:question-resolved'],
    ['onSessionHistory', 'agent:session-history'], ['onSessionRemoved', 'agent:session-removed'],
    ['onConnectorsChanged', 'connector-hub:changed'],
  ] as const) {
    it(`${method} isolates subscribers and releases listeners across remounts`, () => {
      const { api, ipc } = loadDesktopPreload();
      const seen: unknown[] = [];
      const persistent: unknown[] = [];
      const offPersistent = api[method](payload => persistent.push(payload));
      const payload = { sessionId: 's1', requestId: 'q1' };
      for (let mount = 0; mount < 25; mount++) {
        const off = api[method](value => seen.push(value));
        expect(ipc.listenerCount(channel)).toBe(2);
        ipc.emit(channel, { sender: 'must not reach the view' }, payload);
        off();
        off(); // Cleanup may run twice; it must not remove the other subscriber.
        ipc.emit(channel, {}, payload);
        expect(ipc.listenerCount(channel)).toBe(1);
      }
      expect(seen).toHaveLength(25);
      expect(seen.every(value => value === payload)).toBe(true);
      expect(persistent).toHaveLength(50);
      offPersistent();
      expect(ipc.listenerCount(channel)).toBe(0);
    });
  }
});

describe('Desktop named requests', () => {
  it('keeps send pending until Main completes and never retries a rejected send', async () => {
    const calls: unknown[] = [];
    let resolve!: (result: unknown) => void;
    const { api } = loadDesktopPreload((...args) => {
      calls.push(args);
      return new Promise(done => { resolve = done; });
    });
    const request = { sessionId: 'desktop-id', prompt: 'hello', files: ['/tmp/file'] };
    let settled = false;
    const pending = api.send(request).then(result => { settled = true; return result; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(calls).toEqual([['agent:send', request]]);
    const result = { ok: false, deleted: true, sessionId: 'desktop-id' };
    resolve(result);
    expect(await pending).toBe(result);

    let attempts = 0;
    const failing = loadDesktopPreload(async () => { attempts++; throw new Error('offline'); }).api;
    await expect(failing.send(request)).rejects.toThrow('offline');
    expect(attempts).toBe(1);
  });

  it('routes named resource and cron operations with unchanged payloads', async () => {
    const calls: Array<[string, unknown]> = [];
    const { api } = loadDesktopPreload(async (channel, payload) => { calls.push([channel, payload]); return { success: true }; });
    const cases: Array<[() => unknown, string, unknown?]> = [
      [() => api.getInstalledSkills(), 'skill-store:getInstalledSkills'],
      [() => api.skillHub.getInstalled(), 'public-skillhub:get-installed-skills'],
      [() => api.skillHub.fetchCategories(), 'public-skillhub:fetch-categories'],
      [() => api.skillHub.fetchSkills({ page: 2 }), 'public-skillhub:fetch-skills', { page: 2 }],
      [() => api.skillHub.fetchDetail({ slug: 'skill', namespace: 'team' }), 'public-skillhub:fetch-detail', { slug: 'skill', namespace: 'team' }],
      [() => api.skillHub.install({ skill: { slug: 'skill' } }), 'public-skillhub:install-skill', { skill: { slug: 'skill' } }],
      [() => api.skillHub.uninstall({ sourcePath: '/skills/a' }), 'public-skillhub:uninstall-skill', { sourcePath: '/skills/a' }],
      [() => api.skillHub.openImportDialog(), 'public-skillhub:open-import-dialog'],
      [() => api.skillHub.importLocal({ sourcePath: '/a.zip' }), 'public-skillhub:import-local', { sourcePath: '/a.zip' }],
      [() => api.expertHub.getInstalled(), 'public-experthub:get-installed-experts'],
      [() => api.expertHub.fetchCategories({ forceRefresh: true }), 'public-experthub:fetch-categories', { forceRefresh: true }],
      [() => api.expertHub.fetchExperts({ page: 2 }), 'public-experthub:fetch-experts', { page: 2 }],
      [() => api.expertHub.fetchFeatured({ page: 2 }), 'public-experthub:fetch-featured-experts', { page: 2 }],
      [() => api.expertHub.fetchScenes({ page: 2 }), 'public-experthub:fetch-scenes', { page: 2 }],
      [() => api.expertHub.fetchDetail({ expertId: 'a' }), 'public-experthub:fetch-detail', { expertId: 'a' }],
      [() => api.expertHub.install({ expertId: 'a' }), 'public-experthub:install-expert', { expertId: 'a' }],
      [() => api.expertHub.uninstall({ sourcePath: '/a' }), 'public-experthub:uninstall-expert', { sourcePath: '/a' }],
    ];
    for (const [call, channel, payload] of cases) {
      await call();
      expect(calls.at(-1)).toEqual([channel, payload]);
    }
    for (const source of ['local', 'cloud'] as const) {
      const prefix = source === 'local' ? 'agent:cron' : 'agent:cloud-cron';
      await api.sessionCron.list(source);
      await api.sessionCron.toggle(source, { taskId: 't1', enabled: false });
      await api.sessionCron.remove(source, { taskId: 't1' });
      await api.sessionCron.runNow(source, { taskId: 't1' });
      expect(calls.slice(-4)).toEqual([
        [`${prefix}-list`, undefined], [`${prefix}-toggle`, { taskId: 't1', enabled: false }],
        [`${prefix}-remove`, { taskId: 't1' }], [`${prefix}-run-now`, { taskId: 't1' }],
      ]);
    }
    expect(calls).toHaveLength(cases.length + 8);
    expect(() => api.sessionCron.list('invalid' as 'local')).toThrow('Unknown cron source');
    expect(calls).toHaveLength(cases.length + 8);
  });
});
