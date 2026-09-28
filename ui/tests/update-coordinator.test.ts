import { afterEach, describe, expect, test } from 'bun:test';
import { createUpdateCoordinator } from '../src/update-coordinator.mjs';
import { createUpdateInstallPreparation } from '../src/update-install-lifecycle.mjs';

function deferred<T = void>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const candidate = { id: 'candidate', version: '1.2.0', asset: { name: 'Moss-1.2.0-arm64.dmg', size: 20 }, notes: 'release notes', htmlUrl: 'https://github.com/baiguidong/moss/releases/tag/v1.2.0' };
const created: any[] = [];
afterEach(() => created.splice(0).forEach(coordinator => coordinator.dispose()));
function setup(overrides: Record<string, any> = {}) {
  const calls = { checks: 0, downloads: 0, installs: 0, opens: 0, verifies: 0 };
  const states: any[] = [];
  const options = {
    currentVersion: '1.0.0', capabilities: { platform: 'darwin', arch: 'arm64', mode: 'manual', packageType: 'dmg' }, releasePage: 'https://github.com/baiguidong/moss/releases',
    releases: { check: async () => { calls.checks++; return candidate; } },
    downloader: { download: async () => { calls.downloads++; return '/verified.dmg'; }, verify: async () => { calls.verifies++; } },
    nativeUpdater: { download: async () => { calls.downloads++; return '/verified.exe'; }, install: () => { calls.installs++; } },
    openPath: async () => { calls.opens++; return ''; }, showItemInFolder: () => {}, prepareForInstall: async () => {}, onState: (state: any) => states.push(state), ...overrides,
  };
  const coordinator = createUpdateCoordinator(options);
  created.push(coordinator);
  return { coordinator, calls, states, options };
}
const nativeCaps = { platform: 'win32', arch: 'x64', mode: 'nativeUpdater', packageType: 'nsis' };

describe('update state and concurrency', () => {
  test('check failure cannot become up-to-date', async () => {
    const { coordinator } = setup({ releases: { check: async () => { throw new Error('offline'); } } });
    await coordinator.check();
    expect(coordinator.getState()).toMatchObject({ phase: 'error', error: 'offline', currentVersion: '1.0.0', retry: 'check' });
  });
  test('checking and downloading are deduplicated; snapshots survive dismissal', async () => {
    const check = deferred<any>(); const download = deferred<string>();
    let downloads = 0;
    const { coordinator, states } = setup({ releases: { check: () => check.promise }, downloader: { download: () => { downloads++; return download.promise; } } });
    const firstCheck = coordinator.check();
    expect(coordinator.check()).toBe(firstCheck);
    check.resolve(candidate); await firstCheck;
    const firstDownload = coordinator.download(candidate.id);
    expect(coordinator.download(candidate.id)).toBe(firstDownload);
    coordinator.dismiss(candidate.version);
    await coordinator.check();
    expect(coordinator.getState().phase).toBe('downloading');
    download.resolve('/verified.dmg'); await firstDownload;
    expect(downloads).toBe(1);
    expect(coordinator.getState()).toMatchObject({ phase: 'downloaded', prompt: false, candidateId: candidate.id });
    const snapshot = coordinator.getState(); snapshot.phase = 'error';
    expect(coordinator.getState().phase).toBe('downloaded');
    expect(states.map(state => state.revision)).toEqual(states.map((_, index) => index + 1));
  });
  test('ready downloads cannot be replaced by a later check', async () => {
    const { coordinator, calls } = setup();
    await coordinator.check(); await coordinator.download(candidate.id); await coordinator.check();
    expect(calls.checks).toBe(1);
    expect(coordinator.getState().downloadId).toBeTruthy();
    await expect(coordinator.download('wrong-id')).rejects.toThrow('失效');
  });
  test('background downloads are Windows-only and respect preferences', async () => {
    for (const [capabilities, preferences, expected] of [[nativeCaps, {}, 1], [nativeCaps, { autoDownload: false }, 0], [{ ...nativeCaps, mode: 'manual' }, {}, 0]] as const) {
      const { coordinator, calls } = setup({ capabilities, preferences });
      await coordinator.check({ background: true });
      await Promise.resolve(); await Promise.resolve();
      expect(calls.downloads).toBe(expected);
    }
  });
  test('cancelled background download does not immediately restart on another check', async () => {
    let attempts = 0;
    const { coordinator } = setup({ capabilities: nativeCaps, nativeUpdater: { download: (_candidate: any, { signal }: any) => new Promise((_, reject) => {
      attempts++; signal.addEventListener('abort', () => reject(new Error('abort')));
    }) } });
    await coordinator.check({ background: true });
    coordinator.cancel();
    await Promise.resolve(); await Promise.resolve();
    await coordinator.check({ background: true });
    await Promise.resolve();
    expect(attempts).toBe(1);
    expect(coordinator.getState().phase).toBe('available');
  });
  test('macOS validates download IDs and files again before opening, never installs', async () => {
    const { coordinator, calls, options } = setup();
    await coordinator.check(); await coordinator.download(candidate.id);
    await expect(coordinator.open('unknown')).rejects.toThrow('失效');
    await coordinator.open(coordinator.getState().downloadId);
    expect(calls.opens).toBe(1); expect(calls.verifies).toBe(1);
    expect(coordinator.getState().phase).toBe('downloaded');
    await expect(coordinator.install(candidate.id)).rejects.toThrow('不能自动安装');
    options.downloader.verify = async () => { throw new Error('tampered'); };
    await coordinator.open(coordinator.getState().downloadId);
    expect(coordinator.getState()).toMatchObject({ phase: 'error', retry: 'download' });
    expect(coordinator.getState().downloadId).toBeUndefined();
    expect(calls.opens).toBe(1); expect(calls.installs).toBe(0);
  });
  test('shell errors retain the verified package and allow retry', async () => {
    const { coordinator } = setup({ openPath: async () => 'system blocked' });
    await coordinator.check(); await coordinator.download(candidate.id);
    const id = coordinator.getState().downloadId;
    await coordinator.open(id);
    expect(coordinator.getState()).toMatchObject({ phase: 'downloaded', downloadId: id, error: '无法打开安装包：system blocked' });
  });
});

describe('Windows installation', () => {
  test('blocks active work, then revalidates, awaits shutdown, installs exactly once', async () => {
    let busy = true; const shutdown = deferred();
    const { coordinator, calls } = setup({ capabilities: nativeCaps, getInstallBlockers: () => busy ? ['终端窗口'] : [], prepareForInstall: () => shutdown.promise });
    await coordinator.check(); await coordinator.download(candidate.id);
    await coordinator.install(candidate.id);
    expect(calls.installs).toBe(0); expect(coordinator.getState().error).toContain('终端窗口');
    busy = false;
    const install = coordinator.install(candidate.id);
    expect(coordinator.install(candidate.id)).toBe(install);
    await Promise.resolve(); await Promise.resolve();
    expect(coordinator.getState().phase).toBe('preparingInstall');
    expect(calls.installs).toBe(0);
    shutdown.resolve(); await install;
    await coordinator.install(candidate.id);
    expect(calls.installs).toBe(1);
    expect(coordinator.getState().phase).toBe('installing');
  });
  test('file reveal cannot race installation or reset the installing state', async () => {
    const verify = deferred();
    const { coordinator, options } = setup({ capabilities: nativeCaps });
    await coordinator.check(); await coordinator.download(candidate.id);
    options.downloader.verify = () => verify.promise;
    const opening = coordinator.open(coordinator.getState().downloadId, true);
    await expect(coordinator.install(candidate.id)).rejects.toThrow('正在校验');
    verify.resolve(); await opening;
    await coordinator.install(candidate.id);
    await expect(coordinator.open(coordinator.getState().downloadId, true)).rejects.toThrow('正在准备安装');
    expect(coordinator.getState().phase).toBe('installing');
  });
  test('preparation failures never start installer and retain download for retry', async () => {
    let fail = true;
    const { coordinator, calls } = setup({ capabilities: nativeCaps, prepareForInstall: async () => { if (fail) throw new Error('flush failed'); } });
    await coordinator.check(); await coordinator.download(candidate.id); await coordinator.install(candidate.id);
    expect(calls.installs).toBe(0);
    expect(coordinator.getState()).toMatchObject({ phase: 'error', retry: 'install', error: 'flush failed' });
    expect(coordinator.getState().downloadId).toBeTruthy();
    fail = false; await coordinator.install(candidate.id); expect(calls.installs).toBe(1);
  });
  test('install watchdog reports failure, not successful upgrade', async () => {
    const { coordinator } = setup({ capabilities: nativeCaps, installTimeout: 10 });
    await coordinator.check(); await coordinator.download(candidate.id); await coordinator.install(candidate.id);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(coordinator.getState()).toMatchObject({ phase: 'error', retry: 'install' });
  });
  test('preparation rechecks activity and blocks new work before asynchronous shutdown', async () => {
    let busy = true; let stops = 0; const done = deferred();
    const lifecycle = createUpdateInstallPreparation({ getBlockers: () => busy ? ['new task'] : [], shutdown: () => { stops++; return done.promise; } });
    await expect(lifecycle.prepare()).rejects.toThrow('new task');
    expect(lifecycle.isPreparing()).toBe(false);
    busy = false;
    const preparation = lifecycle.prepare();
    expect(lifecycle.isPreparing()).toBe(true);
    expect(lifecycle.prepare()).toBe(preparation);
    done.resolve(); await preparation; expect(stops).toBe(1);
  });
  test('late shutdown completion after a timeout cannot trigger installation', async () => {
    const done = deferred();
    const lifecycle = createUpdateInstallPreparation({ getBlockers: () => [], shutdown: () => done.promise, timeout: 10 });
    const { coordinator, calls } = setup({ capabilities: nativeCaps, prepareForInstall: lifecycle.prepare });
    await coordinator.check(); await coordinator.download(candidate.id); await coordinator.install(candidate.id);
    expect(coordinator.getState().error).toContain('超时');
    done.resolve(); await Promise.resolve();
    expect(calls.installs).toBe(0); expect(lifecycle.isPreparing()).toBe(true);
  });
});
