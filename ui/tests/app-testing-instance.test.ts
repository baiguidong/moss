import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetEnvironment, targetSettings, selfTestRendererUrl, probeTarget } from '../src/app-testing/instance.mjs';
import { restoreTestController, closeTestController, validateTestToolUse, TEST_ALLOWED_TOOLS } from '../src/app-testing/browser.mjs';
import { inheritTestApps, clearTestAppCredentials } from '../src/app-testing/profile.mjs';
import { AppCredentialAdapter } from '../src/apps/app-runtime.mjs';
import { createReusableTestInstance } from '../src/app-testing/reusable-instance.mjs';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temporary() { const root = await mkdtemp(path.join(tmpdir(), 'moss-self-test-unit-')); roots.push(root); return root; }
function deferred() { let resolve!: (value?: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; }

describe('fixed reusable test instance', () => {
  test('serializes concurrent management and restores the prepared profile after a parent restart', async () => {
    const directory = await temporary(), entered = deferred(), release = deferred(), launches: any[] = [], updates: any[] = [];
    let alive = 0;
    const options = { directory, getSettings: () => ({ model: 'real' }), getAppRuntime: () => null, getRuntimeHome: () => '',
      notify: (state: any) => updates.push(state),
      launch: async (input: any) => {
        launches.push({ id: input.run.id, home: input.run.home, prepare: input.prepareEnvironment });
        expect(alive).toBe(0);
        if (launches.length === 1) { entered.resolve(); await release.promise; }
        await writeFile(path.join(input.run.home, 'settings.json'), JSON.stringify(input.settings));
        await input.onProgress({ stage: 'launch', label: '启动中' });
        const exit = deferred(); let running = true; alive++;
        return { pid: launches.length, exited: exit.promise, isAlive: () => running,
          close: async () => { if (running) { running = false; alive--; exit.resolve(); } } };
      },
    };
    const manager = createReusableTestInstance(options as any);
    const first = manager.open(); await entered.promise;
    const duplicate = manager.open(), refresh = manager.refresh(), reopened = manager.open();
    release.resolve();
    expect(await duplicate).toBe(await first);
    expect(await reopened).toBe(await refresh);
    expect(launches.map(item => item.prepare)).toEqual([true, true]);
    expect(updates.some(state => state.phase === 'starting' && state.startedAt > 0 && state.progress?.updatedAt > 0)).toBe(true);
    const id = manager.snapshot().id;
    await manager.close();
    const restored = createReusableTestInstance(options as any);
    expect((await restored.getStatus()).id).toBe(id);
    await restored.open();
    expect(launches[2]).toEqual({ ...launches[0], prepare: false });
    await restored.close();
    expect(alive).toBe(0);
  });

  test('closing during preparation cancels copying and leaves the profile unprepared', async () => {
    const entered = deferred(), directory = await temporary();
    const manager = createReusableTestInstance({ directory, getSettings: () => ({}), getAppRuntime: () => null, getRuntimeHome: () => '',
      launch: ({ signal }: any) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        entered.resolve();
      }),
    } as any);
    const opening = manager.open().catch((error: Error) => error);
    await entered.promise;
    await manager.close();
    expect((await opening).message).toContain('已取消测试实例准备');
    expect(manager.snapshot()).toMatchObject({ phase: 'closed', prepared: false, progress: null });
  });

  test('reuses one profile and process, retains data after close, and only refreshes on request', async () => {
    const directory = await temporary(), launches: any[] = [];
    const manager = createReusableTestInstance({ directory, getSettings: () => ({ model: 'real', permissionMode: 'bypassPermissions' }),
      getAppRuntime: () => null, getRuntimeHome: () => '/shared/runtimes',
      launch: async (options: any) => {
        launches.push({ home: options.run.home, id: options.run.id, prepare: options.prepareEnvironment });
        await writeFile(path.join(options.run.home, 'settings.json'), JSON.stringify(options.settings));
        await writeFile(path.join(options.run.home, 'app-runtime-state.json'), JSON.stringify({ runtimes: {} }));
        const exit = deferred(); let alive = true;
        return { endpoint: 'http://127.0.0.1:1', exited: exit.promise, isAlive: () => alive, focus: () => {},
          close: async () => { alive = false; exit.resolve(); } };
      },
    } as any);
    const first = await manager.open();
    expect(await manager.open()).toBe(first);
    expect(launches).toHaveLength(1);
    const data = path.join(manager.home, 'sessions');
    await mkdir(data); await writeFile(path.join(data, 'demo.txt'), 'retain');
    await manager.close();
    expect(await readFile(path.join(data, 'demo.txt'), 'utf8')).toBe('retain');
    await manager.open();
    expect(launches[1]).toEqual({ ...launches[0], prepare: false });
    const removed = ['app-tasks/run.json', 'app-authoring/draft.json', 'cloud-transfers/job.json', 'apps-data/workflow/run.json', 'cron_tasks.json'];
    const retained = ['apps/example/versions/1.0.0/package.json', 'credentials/test.json', 'skills/test/SKILL.md'];
    for (const file of [...removed, ...retained]) {
      await mkdir(path.dirname(path.join(manager.home, file)), { recursive: true });
      await writeFile(path.join(manager.home, file), 'fixture');
    }
    await writeFile(path.join(directory, 'report.json'), 'previous report');
    await manager.clearData();
    await expect(readFile(path.join(data, 'demo.txt'))).rejects.toThrow();
    for (const file of removed) await expect(readFile(path.join(manager.home, file))).rejects.toThrow();
    for (const file of retained) expect(await readFile(path.join(manager.home, file), 'utf8')).toBe('fixture');
    expect(await readFile(path.join(directory, 'report.json'), 'utf8')).toBe('previous report');
    expect(launches[2].prepare).toBe(false);
    await manager.refresh();
    expect(launches[3].prepare).toBe(true);
    expect(new Set(launches.map(item => item.id)).size).toBe(1);
    await writeFile(path.join(manager.home, 'app-runtime-state.json'), JSON.stringify({ installations: {
      workflow: { appId: 'moss.workflow', activeVersion: '1.0.0', enabled: true, grants: ['execution:run'] },
    } }));
    const nextRun: any = {};
    await manager.attachRun(nextRun);
    expect(nextRun.inheritedApps).toEqual([{ id: 'moss.workflow', version: '1.0.0', enabled: true, grants: ['execution:run'] }]);
    expect(launches).toHaveLength(4);
    await manager.close();
  });
});

test('a cleanup failure leaves a closed retryable target instead of an endless preparation state', async () => {
  const directory = await temporary();
  const manager = createReusableTestInstance({ directory, getSettings: () => ({}), getAppRuntime: () => null, getRuntimeHome: () => '' } as any);
  await manager.getStatus();
  await writeFile(path.join(manager.home, 'app-runtime-state.json'), '{broken');
  await expect(manager.clearData()).rejects.toThrow();
  expect(manager.snapshot()).toMatchObject({ phase: 'closed', pid: null, progress: null });
});

describe('test target isolation and App browser connection', () => {
  test('limits controller tools while refusing stale or mismatched test browser connections', () => {
    const record = { id: 'controller', appTestRunId: 'run' };
    const run = { id: 'run', phase: 'running', sessionId: 'controller' };
    expect(TEST_ALLOWED_TOOLS).toContain('Read');
    expect(TEST_ALLOWED_TOOLS).toContain('moss_test_browser__*');
    expect(TEST_ALLOWED_TOOLS).toContain('self_test');
    expect(TEST_ALLOWED_TOOLS).not.toContain('Bash');
    expect(TEST_ALLOWED_TOOLS).not.toContain('*');
    for (const name of ['Read', 'Bash', 'Write', 'ToolSearch', 'self_test', 'mcp__moss_test_browser__browser_click']) {
      expect(validateTestToolUse(record, true, name)).toBeNull();
    }
    const browser = 'mcp__moss_test_browser__browser_click';
    expect(validateTestToolUse(record, false, browser)?.behavior).toBe('deny');
    expect(validateTestToolUse(record, false, browser)?.behavior).toBe('deny');
    expect(validateTestToolUse(record, false, browser)?.behavior).toBe('deny');
  });
  test('closes the test MCP once without touching another browser connection', async () => {
    const calls: string[] = [];
    const runtime = {
      abort: () => calls.push('abort'), dispose: () => calls.push('dispose'),
      getAppState: () => ({ mcp: { clients: [
        { name: 'moss_test_browser', type: 'connected', cleanup: async () => calls.push('test-closed') },
        { name: 'ordinary-browser', type: 'connected', cleanup: async () => calls.push('wrong-browser') },
      ] } }),
    };
    await Promise.all([closeTestController(runtime), closeTestController(runtime)]);
    expect(calls).toEqual(['abort', 'test-closed', 'dispose']);
  });
  test('uses the original model with full permissions and removes credentials on cleanup', () => {
    const settings = { model: 'model', apiKey: 'secret', url: 'https://api.example.test', remoteDirectApiKey: 'remote-secret', agentMail: { enabled: true }, mcp: { servers: {} }, appearance: { theme: 'dark' }, toolLoading: { Bash: 'resident' } };
    expect(targetSettings(settings, false)).not.toHaveProperty('apiKey');
    expect(targetSettings(settings, false)).not.toHaveProperty('remoteDirectApiKey');
    expect(targetSettings(settings)).toMatchObject({ ...settings, permissionMode: 'bypassPermissions' });
    const copied = targetSettings(settings);
    copied.appearance.theme = 'light';
    expect(settings.appearance.theme).toBe('dark');
    const env = targetEnvironment({ PATH: '/bin', MOSS_HOME: '/real-profile', MOSS_CONFIG_DIR: '/real-config', OPENAI_API_KEY: 'secret', NODE_OPTIONS: '--inspect', ELECTRON_RUN_AS_NODE: '1' }, { home: '/isolated', id: 'run' });
    expect(env).toMatchObject({ MOSS_HOME: '/isolated', MOSS_CONFIG_DIR: '/isolated', PATH: '/bin' });
    expect(env).not.toHaveProperty('OPENAI_API_KEY');
    expect(env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    expect(env).not.toHaveProperty('MOSS_MCP_PYTHON_HOME');
    const cached = targetEnvironment({ MOSS_MCP_PYTHON_HOME: '/untrusted/cache' }, {
      home: '/isolated', id: 'run', runtimeHome: '/shared/runtimes', pythonRuntimeHome: '/shared/dependencies',
    });
    expect(cached.MOSS_HOME).toBe('/isolated');
    expect(cached.MOSS_RUNTIME_HOME).toBe('/shared/runtimes');
    expect(cached.MOSS_MCP_PYTHON_HOME).toBe('/shared/dependencies');
    expect(selfTestRendererUrl('file:///app/index.html', { id: 'run' })).toContain('moss-self-test=run');
  });

  test('inherits installed packages, enabled state, grants and configuration without writing through to the source', async () => {
    const root = await temporary(), home = path.join(root, 'target'), appsDir = path.join(root, 'source/apps');
    const sourcePackage = path.join(appsDir, 'moss.example', 'versions', '1.0.0');
    await mkdir(sourcePackage, { recursive: true });
    await writeFile(path.join(sourcePackage, 'app.moss.json'), 'original package');
    await writeFile(path.join(root, 'source/app-registry.json'), JSON.stringify({ version: 2, apps: [
      { id: 'moss.example', name: 'Example App', currentVersion: 'stale-version' }, { id: 'moss.removed' },
    ] }));
    const state = { version: 5,
      installations: { 'moss.example': { appId: 'moss.example', activeVersion: '1.0.0', enabled: false, grants: ['mcp:connect'] } },
      instances: { example: { id: 'example', appId: 'moss.example', enabled: true, config: { theme: 'dark' } } },
      runtimes: { stale: { pid: 12345, desiredState: 'running' } },
    };
    const runtime = { appsDir, rootDir: path.join(root, 'source'), state: { snapshot: () => state }, storageAppId: (id: string) => id,
      credentialAdapter: { get: async () => ({ token: 'private-app-token' }) } };
    const progress: any[] = [];
    expect(await inheritTestApps({ runtime, home, onProgress: async (event: any) => { progress.push(event); } })).toEqual([{ id: 'moss.example', version: '1.0.0', enabled: false, grants: ['mcp:connect'] }]);
    expect(progress.map(event => event.current)).toEqual([0, 1]);
    const saved = JSON.parse(await readFile(path.join(home, 'app-runtime-state.json'), 'utf8'));
    expect(saved).toEqual({ ...state, runtimes: {} });
    const registry = JSON.parse(await readFile(path.join(home, 'app-registry.json'), 'utf8'));
    expect(registry.apps).toHaveLength(1);
    expect(registry.apps[0]).toMatchObject({ id: 'moss.example', name: 'Example App', currentVersion: '1.0.0' });
    expect(JSON.parse(await readFile(path.join(home, 'apps/moss.example/current.json'), 'utf8')).version).toBe('1.0.0');
    const copiedPackage = path.join(home, 'apps/moss.example/versions/1.0.0/app.moss.json');
    await writeFile(copiedPackage, 'modified by test');
    expect(await readFile(path.join(sourcePackage, 'app.moss.json'), 'utf8')).toBe('original package');
    expect(await new AppCredentialAdapter(home).get('moss.example', 'example')).toEqual({ token: 'private-app-token' });
    expect(await readFile(path.join(home, 'credentials/app-secrets.json'), 'utf8')).not.toContain('private-app-token');
    await clearTestAppCredentials(home);
    expect(await new AppCredentialAdapter(home).get('moss.example', 'example')).toEqual({});
  });

  test('does not silently skip missing packages or a canceled inheritance', async () => {
    const root = await temporary();
    const runtime = { appsDir: root, state: { snapshot: () => ({ version: 5, instances: {}, installations: {
      broken: { appId: 'moss.missing', activeVersion: '1.0.0', enabled: true },
    } }) } };
    await expect(inheritTestApps({ runtime, home: path.join(root, 'target') })).rejects.toThrow();
    await expect(inheritTestApps({ runtime, home: path.join(root, 'target'), signal: AbortSignal.abort(new Error('canceled')) })).rejects.toThrow('canceled');
  });

  test('a different CDP page cannot be mistaken for this run', async () => {
    const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => Response.json([{ type: 'page', url: 'file:///moss?moss-self-test=other' }]) });
    try { expect(await probeTarget(`http://127.0.0.1:${server.port}`, 'requested', new AbortController().signal)).toBeNull(); }
    finally { server.stop(true); }
  });

  test('restored test conversations cannot reconnect to the ordinary Chrome service', async () => {
    const sessionDir = await temporary();
    const runId = '12345678-1234-1234-1234-123456789012';
    await writeFile(path.join(sessionDir, 'app-test-controller.json'), JSON.stringify({ runId }));
    const record: any = { sessionDir };
    restoreTestController(record);
    expect(record).toMatchObject({ appTestRunId: runId, appTestMcpServers: {} });
  });
});
