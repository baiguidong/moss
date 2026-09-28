import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { createAutoUpdaterService } from '../src/auto-updater-service.mjs';

function fixture() {
  const candidate = { id: 'id', version: '1.2.0', feedUrl: 'https://github.com/baiguidong/moss/releases/download/v1.2.0/', asset: { name: 'Moss-Setup-1.2.0-x64.exe', size: 42, sha512: 'hash' } };
  let installs = 0; let cancel = 0; let installArgs: unknown[] = [];
  const info = { version: candidate.version, files: [{ url: candidate.asset.name, size: 42, sha512: 'hash' }] };
  const updater = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: true, allowDowngrade: true, allowPrerelease: true, disableDifferentialDownload: false,
    setFeedURL: (_feed: any) => { updater.allowDowngrade = true; },
    checkForUpdates: async () => ({ updateInfo: info, cancellationToken: { cancel: () => cancel++ } }),
    downloadUpdate: async (_token: any) => ['/cache/setup.exe'],
    quitAndInstall: (...args: unknown[]) => { installs++; installArgs = args; },
  });
  const service = createAutoUpdaterService({ updater, verify: async () => {} });
  return { service, updater, candidate, info, counts: () => ({ installs, cancel, installArgs }) };
}

test('never silently installs on quit or allows downgrade after setting a channel', async () => {
  const { service, updater, candidate, counts } = fixture();
  expect(updater.autoInstallOnAppQuit).toBe(false);
  expect(updater.autoDownload).toBe(false);
  expect(updater.disableDifferentialDownload).toBe(true);
  expect(() => service.install(candidate)).toThrow();
  await service.download(candidate);
  expect(updater.allowDowngrade).toBe(false);
  expect(updater.allowPrerelease).toBe(false);
  service.install(candidate);
  expect(counts().installs).toBe(1);
  expect(counts().installArgs).toEqual([true, true]);
});
test('rejects mismatched feed files/version before downloading or installing', async () => {
  for (const mutation of [(info: any) => info.version = '2.0.0', (info: any) => info.files[0].url = 'https://example.org/evil.exe', (info: any) => info.files[0].sha512 = 'other']) {
    const { service, candidate, info } = fixture(); mutation(info);
    await expect(service.download(candidate)).rejects.toThrow('不一致');
    expect(() => service.install(candidate)).toThrow();
  }
});
test('cancellation reaches the updater token and clears progress listeners', async () => {
  const { service, candidate, updater, counts } = fixture();
  const controller = new AbortController();
  updater.downloadUpdate = async () => { controller.abort(); throw new Error('cancelled'); };
  await expect(service.download(candidate, { signal: controller.signal })).rejects.toThrow();
  expect(counts().cancel).toBe(1);
  expect(updater.listenerCount('download-progress')).toBe(0);
});
test('reports synchronous installer errors', async () => {
  const { service, candidate, updater } = fixture();
  updater.quitAndInstall = () => { updater.emit('error', new Error('spawn failed')); };
  await service.download(candidate);
  expect(() => service.install(candidate, () => {})).toThrow('spawn failed');
});
