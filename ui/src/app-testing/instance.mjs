import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { inheritTestApps, inheritTestResources } from './profile.mjs';

export const TEST_QUERY = 'moss-self-test';

/** Only a Host-created, isolated profile can enter target mode. */
export function configureSelfTestTarget(app, env = process.env) {
  const id = env.MOSS_SELF_TEST_RUN_ID;
  if (!id) return null;
  const home = env.MOSS_HOME;
  if (!/^[a-f0-9-]{36}$/.test(id) || !home || !path.isAbsolute(home)) throw new Error('Invalid Moss self-test profile');
  const marker = JSON.parse(fs.readFileSync(path.join(home, '.self-test-target.json'), 'utf8'));
  if (marker.id !== id || marker.home !== fs.realpathSync(home) || marker.parentPid !== Number(env.MOSS_SELF_TEST_PARENT_PID)) throw new Error('Moss self-test profile does not match its launcher');
  const parentPid = marker.parentPid;
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0 || parentPid === process.pid) throw new Error('Invalid self-test parent');
  const timer = setInterval(() => {
    try { process.kill(parentPid, 0); } catch (error) { if (error.code === 'ESRCH') app.quit(); }
  }, 5000);
  timer.unref();
  process.on('message', message => { if (message?.type === 'moss-self-test-stop' && message.id === id) app.quit(); });
  app.once('will-quit', () => clearInterval(timer));
  return { id, fixture: marker.fixture };
}

export function selfTestRendererUrl(value, target) {
  if (!target) return value;
  const url = new URL(value);
  url.searchParams.set(TEST_QUERY, target.id);
  return url.href;
}

// CDP device emulation changes the layout viewport without resizing Electron's
// native content area. Resize the isolated window itself so screenshots and
// what the person at the desktop sees cover the same controls.
export function resizeTestWindow(window, screen, size) {
  if (![size?.width, size?.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid test window size');
  }
  const previous = window.getBounds();
  const workArea = screen.getDisplayMatching(previous).workArea;
  const minimum = window.getMinimumSize();
  const minWidth = Math.min(minimum[0], workArea.width);
  const minHeight = Math.min(minimum[1], workArea.height);
  const width = Math.min(workArea.width, Math.max(minWidth, Math.round(size.width)));
  const height = Math.min(workArea.height, Math.max(minHeight, Math.round(size.height)));
  window.webContents.disableDeviceEmulation();
  if (window.isMinimized()) window.restore();
  if (window.isMaximized()) window.unmaximize();
  window.setMinimumSize(minWidth, minHeight);
  window.setBounds({ width, height,
    x: Math.max(workArea.x, Math.min(previous.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(previous.y, workArea.y + workArea.height - height)),
  });
  return { bounds: window.getBounds(), contentBounds: window.getContentBounds(), workArea };
}

export function targetSettings(settings, includeConfiguration = true) {
  // The running target inherits all current settings. Cleanup keeps only display/local defaults.
  return { ...(includeConfiguration ? structuredClone(settings) : { language: settings.language || 'chinese', agentMode: 'local' }),
    permissionMode: 'bypassPermissions' };
}

export function targetEnvironment(source, run) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !/^(MOSS_|CLAUDE_|ANTHROPIC_|OPENAI_|AZURE_|AWS_|GOOGLE_|ELECTRON_RUN_AS_NODE|NODE_OPTIONS|NODE_PATH|VITE_DEV_SERVER_URL)/.test(key)));
  return { ...env, MOSS_HOME: run.home, MOSS_CONFIG_DIR: run.home, MOSS_SELF_TEST_RUN_ID: run.id,
    MOSS_SELF_TEST_PARENT_PID: String(process.pid), MOSS_OPEN_DEVTOOLS: 'false',
    ...(run.runtimeHome ? { MOSS_RUNTIME_HOME: run.runtimeHome } : {}),
    ...(run.pythonRuntimeHome ? { MOSS_MCP_PYTHON_HOME: run.pythonRuntimeHome } : {}) };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function probeTarget(endpoint, id, signal) {
  const response = await fetch(`${endpoint}/json/list`, { signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]), redirect: 'error' });
  if (!response.ok) return null;
  const pages = await response.json();
  return Array.isArray(pages) ? pages.find(page => {
    try { return page.type === 'page' && new URL(page.url).searchParams.get(TEST_QUERY) === id; } catch { return false; }
  }) || null : null;
}

export async function launchTestInstance({ run, executable, args = [], cwd, settings, appRuntime, runtimeHome, fixtures = [], fixtureTitle = '', prepareEnvironment = true, signal, onProgress = async () => {}, env = process.env, timeoutMs = 45_000 }) {
  await fsp.mkdir(run.home, { recursive: true, mode: 0o700 });
  const home = await fsp.realpath(run.home);
    const fixtureDirectory = path.join(home, 'self-test-workspace');
    await fsp.mkdir(fixtureDirectory, { recursive: true });
    for (const fixture of fixtures) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(fixture.name)) throw new Error('Invalid test fixture name');
      await fsp.writeFile(path.join(fixtureDirectory, fixture.name), fixture.content, { flag: 'wx' }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
    await fsp.writeFile(path.join(home, '.self-test-target.json'), JSON.stringify({ id: run.id, home, parentPid: process.pid,
      fixture: fixtureTitle ? { title: fixtureTitle, workspace: fixtureDirectory } : null }), { mode: 0o600 });
    if (prepareEnvironment) {
      run.inheritedApps = await inheritTestApps({ runtime: appRuntime, home, signal, onProgress });
      await inheritTestResources({ sourceHome: appRuntime?.rootDir, home, signal, onProgress });
    }
    await onProgress({ stage: 'launch', label: '设置与 App 已继承，正在启动独立 Moss 并等待界面就绪…' });
    await fsp.writeFile(path.join(home, 'settings.json'), JSON.stringify(targetSettings(settings)), { mode: 0o600 });
    const port = await freePort();
    signal.throwIfAborted();
    const endpoint = `http://127.0.0.1:${port}`;
    const log = fs.createWriteStream(path.join(run.directory, 'instance.log'), { flags: 'a', mode: 0o600 });
    // Dependency environments are keyed by interpreter + fixed requirements and
    // protected by the SDK's install lock. Reuse code, like Node/Python itself;
    // App configuration, credentials, conversations and business data stay local.
    const pythonRuntimeHome = env.MOSS_MCP_PYTHON_HOME || (appRuntime?.rootDir ? path.join(appRuntime.rootDir, 'mcp', 'python') : undefined);
    const child = spawn(executable, [...args, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1'], {
      cwd, env: targetEnvironment(env, { ...run, home, runtimeHome, pythonRuntimeHome }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.once('close', () => log.end());
    let exited = false, failure, closing;
    const exit = new Promise(resolve => {
      child.once('error', error => { failure = error; exited = true; resolve(); });
      child.once('exit', (code, childSignal) => { exited = true; failure ||= new Error(`测试实例退出（${childSignal || code}）。`); resolve(); });
    });
    const close = () => closing ||= (async () => {
      if (!exited && child.connected) child.send({ type: 'moss-self-test-stop', id: run.id }, () => {});
      if (!exited) await Promise.race([exit, delay(3000)]);
      if (!exited) { child.kill('SIGTERM'); await Promise.race([exit, delay(1500)]); }
      if (!exited) { child.kill('SIGKILL'); await Promise.race([exit, delay(1500)]); }
      if (!exited) throw new Error('测试实例未能退出。');
    })();
    const resize = size => new Promise((resolve, reject) => {
      if (exited || !child.connected) { reject(new Error('测试实例已退出。')); return; }
      const requestId = randomUUID();
      const finish = (error, value) => {
        clearTimeout(timer);
        child.off('message', receive);
        child.off('exit', stopped);
        if (error) reject(error); else resolve(value);
      };
      const receive = message => {
        if (message?.type !== 'moss-self-test-resized' || message.id !== run.id || message.requestId !== requestId) return;
        finish(message.error ? new Error(message.error) : null, message.result);
      };
      const stopped = () => finish(new Error('测试实例已退出。'));
      const timer = setTimeout(() => finish(new Error('调整测试窗口超时。')), 5000);
      child.on('message', receive);
      child.once('exit', stopped);
      child.send({ type: 'moss-self-test-resize', id: run.id, requestId, size }, error => { if (error) finish(error); });
    });
    try {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (exited) throw failure;
        const page = await probeTarget(endpoint, run.id, signal).catch(() => null);
        if (page) return { id: run.id, endpoint, page, pid: child.pid, close, resize, exited: exit, isAlive: () => !exited,
          focus: () => { if (child.connected) child.send({ type: 'moss-self-test-focus', id: run.id }, () => {}); },
        };
        await delay(200, undefined, { signal });
      }
      throw new Error('测试实例未在限定时间内打开主界面。请查看 instance.log。');
    } catch (error) { await close(); throw error; }
}
