import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { launchTestInstance } from './instance.mjs';

const dataDirectories = ['sessions', 'workspaces', 'projects', 'teams', 'tasks', 'memory', 'apps-data', 'apps-runtime', 'self-test-workspace', 'electron'];

/** One persistent profile and at most one target process per main Moss. */
export function createReusableTestInstance({ directory, getSettings, getAppRuntime, getRuntimeHome, executable, args = [], cwd,
  getFixtures = () => ({}), notify = () => {}, launch = launchTestInstance }) {
  const home = path.join(directory, 'home'), descriptorPath = path.join(directory, 'instance.json');
  let descriptor, instance = null, preparing = null, initialized, operations = Promise.resolve();
  const enqueue = operation => {
    const result = operations.then(operation);
    operations = result.catch(() => {});
    return result;
  };
  let state = { phase: 'closed', prepared: false, home, directory, message: '首次打开时继承主 Moss 的环境，之后直接复用。' };
  const snapshot = () => structuredClone(state);
  const update = value => { state = { ...state, ...value }; notify(snapshot()); };
  const initialize = () => initialized ||= (async () => {
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    try { descriptor = JSON.parse(await fs.readFile(descriptorPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; descriptor = { id: randomUUID(), prepared: false }; }
    update({ id: descriptor.id, prepared: descriptor.prepared, preparedAt: descriptor.preparedAt, inheritedApps: descriptor.inheritedApps || [] });
  })();
  const save = async () => {
    const temporary = `${descriptorPath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(descriptor, null, 2), { mode: 0o600 });
    await fs.rename(temporary, descriptorPath);
  };

  async function open({ signal = new AbortController().signal, onProgress = async () => {} } = {}) {
    await initialize();
    signal.throwIfAborted();
    if (instance?.isAlive()) { instance.focus?.(); return instance; }
    preparing = new AbortController();
    signal = AbortSignal.any([signal, preparing.signal]);
    try {
      const reused = descriptor.prepared;
      update({ phase: 'starting', startedAt: Date.now(), progress: null, message: reused ? '正在打开已准备的测试实例…' : '首次准备测试环境…' });
      const run = { id: descriptor.id, directory, home, inheritedApps: descriptor.inheritedApps || [], cases: [] };
      const settings = reused
        ? JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8'))
        : getSettings();
      const target = await launch({ run, settings, appRuntime: getAppRuntime(), runtimeHome: getRuntimeHome(),
        ...getFixtures(),
        executable, args, cwd, signal, prepareEnvironment: !reused,
        onProgress: async progress => { update({ progress: { ...progress, updatedAt: Date.now() }, message: progress.label }); await onProgress(progress); },
      });
      if (signal.aborted) { await target.close(); signal.throwIfAborted(); }
      instance = target;
      descriptor = { ...descriptor, prepared: true, preparedAt: descriptor.preparedAt || Date.now(), inheritedApps: run.inheritedApps };
      try { await save(); }
      catch (error) { await target.close(); instance = null; throw error; }
      update({ phase: 'open', pid: target.pid, prepared: true, preparedAt: descriptor.preparedAt, inheritedApps: descriptor.inheritedApps,
        message: '测试实例已打开；测试结束后保留窗口和数据。', progress: null });
      void target.exited.then(() => {
        if (instance !== target) return;
        instance = null;
        update({ phase: 'closed', pid: null, message: '测试实例已关闭，环境和测试数据已保留，可随时重新打开。' });
      });
      return target;
    } catch (error) {
      update({ phase: 'closed', pid: null, progress: null, message: error.message });
      throw error;
    } finally { preparing = null; }
  }

  async function close() {
    const target = instance;
    if (target) await target.close();
    instance = null;
    update({ phase: 'closed', pid: null, progress: null, message: '测试窗口已关闭，环境和测试数据已保留。' });
  }

  async function refresh(options) {
    await initialize(); await close();
    descriptor.prepared = false; descriptor.preparedAt = null;
    await save(); update({ prepared: false });
    return open(options);
  }

  async function clearData(options) {
    await initialize(); await close();
    if (!descriptor.prepared) return open(options);
    update({ phase: 'starting', startedAt: Date.now(), progress: null, message: '正在清理测试数据，保留已安装环境和历史报告…' });
    for (const name of dataDirectories) await fs.rm(path.join(home, name), { recursive: true, force: true });
    for (const name of ['moss.db', 'moss.db-wal', 'moss.db-shm']) await fs.rm(path.join(home, name), { force: true });
    const appStatePath = path.join(home, 'app-runtime-state.json');
    const appState = await fs.readFile(appStatePath, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (appState) {
      appState.runtimes = {};
      await fs.writeFile(appStatePath, JSON.stringify(appState), { mode: 0o600 });
    }
    return open(options);
  }

  return { home, snapshot,
    open: options => enqueue(() => open(options)),
    close: () => { preparing?.abort(new Error('已取消测试实例准备。')); return enqueue(close); },
    refresh: options => enqueue(() => refresh(options)),
    clearData: options => enqueue(() => clearData(options)),
    async getStatus() { await initialize(); return snapshot(); },
    attachRun: (run, options) => enqueue(async () => {
      const target = await open(options);
      // Previous demos can enable Apps. Compare the next run against the retained
      // instance's current installation state, rather than its first-launch snapshot.
      const appState = await fs.readFile(path.join(home, 'app-runtime-state.json'), 'utf8').then(JSON.parse).catch(error => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      const inheritedApps = appState?.installations ? Object.values(appState.installations).filter(item => item.activeVersion)
        .map(item => ({ id: item.appId, version: item.activeVersion, enabled: Boolean(item.enabled), grants: [...(item.grants || [])] }))
        : descriptor.inheritedApps;
      Object.assign(run, { home, targetId: descriptor.id, inheritedApps,
        instanceLogPath: path.join(directory, 'instance.log') });
      return target;
    }),
  };
}
