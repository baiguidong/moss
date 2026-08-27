import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { execSync, spawn } from 'node:child_process';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(uiRoot, '..');
const viteBin = path.join(uiRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const electronPackageRoot = path.join(uiRoot, 'node_modules', 'electron');
const electronExecutable = path.join(
  electronPackageRoot,
  'dist',
  fs.readFileSync(path.join(electronPackageRoot, 'path.txt'), 'utf8').trim()
);
const watchedFiles = [
  path.join(uiRoot, 'src', 'main.mjs'),
  path.join(uiRoot, 'src', 'preload.mjs'),
  path.join(uiRoot, 'src', 'appearance-settings.mjs'),
  path.join(uiRoot, 'src', 'desktop-settings.mjs'),
  path.join(uiRoot, 'src', 'browser-view-manager.mjs'),
  path.join(uiRoot, 'src', 'local-audit-engine.mjs'),
  path.join(uiRoot, 'src', 'local-audit-service.mjs'),
  path.join(uiRoot, 'src', 'plugin-app-preload.mjs'),
  path.join(uiRoot, 'src', 'plugin-app-protocol.mjs'),
];
const command = process.argv[2] || 'start';

let electronProcess = null;
let shuttingDown = false;
let restartTimer = null;
let devServerUrl = '';
let electronTransition = Promise.resolve();
const intentionallyStoppedElectronProcesses = new WeakSet();

if (command !== 'start') {
  console.error('Usage: node scripts/dev.mjs start');
  process.exit(1);
}

function spawnChild(command, args, extraEnv = {}) {
  return spawn(process.execPath, [command, ...args], {
    cwd: uiRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...extraEnv,
    },
  });
}

function buildElectronDirect() {
  console.log('Building electron-direct.mjs');
  const result = spawn('bun', ['run', 'build:electron-direct'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  });

  return new Promise((resolve, reject) => {
    result.on('error', reject);
    result.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`electron-direct build exited with code ${code}`));
    });
  });
}

function buildAdapters() {
  console.log('Building IM adapters');
  const result = spawn(process.execPath, [path.join(uiRoot, 'scripts', 'build-adapters.mjs')], {
    cwd: uiRoot,
    stdio: 'inherit',
    env: process.env,
  });

  return new Promise((resolve, reject) => {
    result.on('error', reject);
    result.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`adapter build exited with code ${code}`));
    });
  });
}

function findAvailablePort(preferred, maxAttempts = 20) {
  for (let index = 0; index < maxAttempts; index += 1) {
    const port = preferred + index;
    try {
      execSync(
        `node -e "const s=require('net').createServer();s.listen(${port},'127.0.0.1',()=>{s.close();process.exit(0)});s.on('error',()=>process.exit(1))"`,
        { timeout: 2000, stdio: 'ignore' }
      );
      return port;
    } catch {
      // try next port
    }
  }
  throw new Error(`No available port in range ${preferred}-${preferred + maxAttempts - 1}`);
}

function isServerReady(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve((response.statusCode || 500) < 500);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1000, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReady(url)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off('exit', handleExit);
      resolve(false);
    }, timeoutMs);
    const handleExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', handleExit);
  });
}

async function stopElectron() {
  const child = electronProcess;
  electronProcess = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  intentionallyStoppedElectronProcesses.add(child);
  child.kill('SIGTERM');
  if (await waitForExit(child, 3000)) return;

  child.kill('SIGKILL');
  await waitForExit(child, 1000);
}

async function restartElectron() {
  await stopElectron();
  if (shuttingDown) return;

  const child = spawn(electronExecutable, ['.'], {
    cwd: uiRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
      NODE_ENV: 'development',
    },
  });
  electronProcess = child;

  child.on('exit', (code, signal) => {
    if (electronProcess === child) electronProcess = null;
    if (shuttingDown) return;
    if (intentionallyStoppedElectronProcesses.has(child)) return;
    if (signal === 'SIGTERM') return;
    if (code && code !== 0) {
      console.error(`electron exited with code ${code}`);
    }
  });
}

function enqueueElectronRestart() {
  electronTransition = electronTransition
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
    })
    .then(() => restartElectron());
  return electronTransition;
}

function scheduleElectronRestart() {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void enqueueElectronRestart();
  }, 150);
}

async function shutdown(viteProcess) {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  await electronTransition.catch(() => {});
  await stopElectron();
  if (viteProcess && !viteProcess.killed) {
    viteProcess.kill('SIGTERM');
  }
}

async function main() {
  await Promise.all([buildElectronDirect(), buildAdapters()]);

  let vitePort;
  try {
    vitePort = findAvailablePort(5173, 30);
  } catch {
    vitePort = findAvailablePort(5500, 20);
  }

  devServerUrl = `http://127.0.0.1:${vitePort}`;
  console.log(`Starting dev server at ${devServerUrl}`);

  const viteProcess = spawnChild(viteBin, [], {
    NODE_ENV: 'development',
    VITE_DEV_SERVER_PORT: String(vitePort),
  });

  viteProcess.on('exit', (code) => {
    if (!shuttingDown) {
      void shutdown(viteProcess).finally(() => process.exit(code || 0));
    }
  });

  for (const filePath of watchedFiles.filter((filePath) => fs.existsSync(filePath))) {
    fs.watch(filePath, () => {
      scheduleElectronRestart();
    });
  }

  process.on('SIGINT', () => {
    void shutdown(viteProcess).finally(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    void shutdown(viteProcess).finally(() => process.exit(0));
  });

  await waitForServer(devServerUrl);
  await enqueueElectronRestart();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
