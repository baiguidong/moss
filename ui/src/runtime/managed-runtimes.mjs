import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import electron from 'electron';
import { mossLog } from '../log-ipc.mjs';

const { app } = electron;

export const MANAGED_RUNTIME_VERSIONS = Object.freeze({
  node: '22.22.2',
  python: '3.13',
  git: '2.47.1.windows.1',
});

const RUNTIME_HOME = path.join(os.homedir(), '.moss', 'runtimes');
const REGISTRY_PATH = path.join(RUNTIME_HOME, 'registry.json');

function platformId() {
  return `${process.platform}-${process.arch}`;
}

function resourcesRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'runtimes');
  }
  return path.resolve(app.getAppPath(), 'resources', 'runtimes');
}

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['--version'], { stdio: 'ignore', shell: process.platform === 'win32' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
      }
    });
  });
}

async function readRegistry() {
  try {
    const raw = await fsp.readFile(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, runtimes: {} };
  }
}

async function writeRegistry(registry) {
  await fsp.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await fsp.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

function runtimeInstallDir(name, version) {
  return path.join(RUNTIME_HOME, name, 'versions', version);
}

function nodeExecutablePath() {
  const root = runtimeInstallDir('node', MANAGED_RUNTIME_VERSIONS.node);
  return process.platform === 'win32' ? path.join(root, 'node.exe') : path.join(root, 'bin', 'node');
}

function pythonExecutableCandidates() {
  const root = runtimeInstallDir('python', MANAGED_RUNTIME_VERSIONS.python);
  if (process.platform === 'win32') {
    return [
      path.join(root, 'install', 'python.exe'),
      path.join(root, 'python.exe'),
    ];
  }
  return [
    path.join(root, 'install', 'bin', 'python3'),
    path.join(root, 'bin', 'python3'),
  ];
}

function pythonExecutablePath() {
  return pythonExecutableCandidates().find((candidate) => fs.existsSync(candidate)) || pythonExecutableCandidates()[0];
}

function gitRoot() {
  return path.join(RUNTIME_HOME, 'git', 'PortableGit');
}

function gitBashExecutablePath() {
  return path.join(gitRoot(), 'bin', 'bash.exe');
}

function gitExecutablePath() {
  return path.join(gitRoot(), 'cmd', 'git.exe');
}

function archiveCandidates(name) {
  const id = platformId();
  if (name === 'node') {
    return process.platform === 'win32'
      ? [`node-${id}.zip`]
      : [`node-${id}.tar.gz`];
  }
  if (name === 'python') {
    return [`python-${id}.tar.gz`, `python-${id}.zip`];
  }
  if (name === 'git' && process.platform === 'win32') {
    return [`portablegit-${id}.zip`, `portablegit-${id}.7z.exe`];
  }
  return [];
}

function findResource(name) {
  const root = resourcesRoot();
  for (const filename of archiveCandidates(name)) {
    const candidate = path.join(root, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function clearDirectory(targetDir) {
  await fsp.rm(targetDir, { recursive: true, force: true });
  await fsp.mkdir(targetDir, { recursive: true });
}

async function extractTarGz(archivePath, targetDir) {
  await clearDirectory(targetDir);
  await run('tar', ['-xzf', archivePath, '-C', targetDir]);
}

async function extractZip(archivePath, targetDir) {
  await clearDirectory(targetDir);
  if (process.platform === 'win32') {
    await run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(archivePath)} -DestinationPath ${JSON.stringify(targetDir)} -Force`,
    ]);
    return;
  }
  await run('unzip', ['-q', archivePath, '-d', targetDir]);
}

async function extractPortableGit(archivePath, targetDir) {
  if (archivePath.endsWith('.zip')) {
    await extractZip(archivePath, targetDir);
    return;
  }
  await clearDirectory(targetDir);
  await run(archivePath, ['-y', `-o${targetDir}`]);
}

async function flattenSingleTopLevelDir(targetDir, expectedExecutable) {
  if (fs.existsSync(expectedExecutable)) return;
  const entries = await fsp.readdir(targetDir, { withFileTypes: true });
  const dirs = entries.filter((entry) => entry.isDirectory());
  if (entries.length !== 1 || dirs.length !== 1) return;
  const childDir = path.join(targetDir, dirs[0].name);
  const childEntries = await fsp.readdir(childDir);
  for (const entry of childEntries) {
    await fsp.rename(path.join(childDir, entry), path.join(targetDir, entry));
  }
  await fsp.rmdir(childDir);
}

async function chmodExecutable(filePath) {
  if (process.platform !== 'win32' && fs.existsSync(filePath)) {
    await fsp.chmod(filePath, 0o755);
  }
}

async function verifyExecutable(filePath, args = ['--version']) {
  if (!fs.existsSync(filePath)) return false;
  try {
    await run(filePath, args);
    return true;
  } catch {
    return false;
  }
}

async function markInstalled(name, version, executablePath, installPath) {
  const registry = await readRegistry();
  registry.runtimes ??= {};
  registry.runtimes[name] ??= {};
  registry.runtimes[name][version] = {
    source: 'managed',
    executablePath,
    installPath,
    installedAt: Date.now(),
    verified: true,
  };
  registry.lastUpdated = Date.now();
  await writeRegistry(registry);
}

async function ensureNodeRuntime() {
  const version = MANAGED_RUNTIME_VERSIONS.node;
  const installDir = runtimeInstallDir('node', version);
  const executablePath = nodeExecutablePath();
  if (await verifyExecutable(executablePath)) {
    await markInstalled('node', version, executablePath, installDir);
    return { ok: true, executablePath, installPath: installDir, installed: false };
  }
  const resource = findResource('node');
  if (!resource) return { ok: false, missing: true, name: 'node' };
  if (resource.endsWith('.zip')) {
    await extractZip(resource, installDir);
  } else {
    await extractTarGz(resource, installDir);
  }
  await flattenSingleTopLevelDir(installDir, executablePath);
  await chmodExecutable(executablePath);
  if (!(await verifyExecutable(executablePath))) {
    throw new Error(`Managed Node.js runtime failed verification: ${executablePath}`);
  }
  await markInstalled('node', version, executablePath, installDir);
  return { ok: true, executablePath, installPath: installDir, installed: true };
}

async function ensurePythonRuntime() {
  const version = MANAGED_RUNTIME_VERSIONS.python;
  const installDir = runtimeInstallDir('python', version);
  const executablePath = pythonExecutablePath();
  if (await verifyExecutable(executablePath)) {
    await markInstalled('python', version, executablePath, installDir);
    return { ok: true, executablePath, installPath: installDir, installed: false };
  }
  const resource = findResource('python');
  if (!resource) return { ok: false, missing: true, name: 'python' };
  if (resource.endsWith('.zip')) {
    await extractZip(resource, installDir);
  } else {
    await extractTarGz(resource, installDir);
  }
  await flattenSingleTopLevelDir(installDir, pythonExecutableCandidates()[0]);
  const verifiedPath = pythonExecutableCandidates().find((candidate) => fs.existsSync(candidate)) || pythonExecutableCandidates()[0];
  await chmodExecutable(verifiedPath);
  if (!(await verifyExecutable(verifiedPath))) {
    throw new Error(`Managed Python runtime failed verification: ${verifiedPath}`);
  }
  await markInstalled('python', version, verifiedPath, installDir);
  return { ok: true, executablePath: verifiedPath, installPath: installDir, installed: true };
}

async function ensureGitRuntime() {
  if (process.platform !== 'win32') {
    return { ok: true, skipped: true };
  }
  const version = MANAGED_RUNTIME_VERSIONS.git;
  const installDir = gitRoot();
  const executablePath = gitBashExecutablePath();
  if (await verifyExecutable(executablePath)) {
    await markInstalled('git', version, executablePath, installDir);
    return { ok: true, executablePath, installPath: installDir, installed: false };
  }
  const resource = findResource('git');
  if (!resource) return { ok: false, missing: true, name: 'git' };
  await extractPortableGit(resource, installDir);
  if (!(await verifyExecutable(executablePath))) {
    throw new Error(`Managed Git Bash runtime failed verification: ${executablePath}`);
  }
  await markInstalled('git', version, executablePath, installDir);
  return { ok: true, executablePath, installPath: installDir, installed: true };
}

function managedPathEntries() {
  const entries = [path.dirname(nodeExecutablePath()), path.dirname(pythonExecutablePath())];
  if (process.platform === 'win32') {
    entries.push(
      path.join(path.dirname(pythonExecutablePath()), 'Scripts'),
      path.dirname(gitBashExecutablePath()),
      path.join(gitRoot(), 'usr', 'bin'),
      path.dirname(gitExecutablePath()),
    );
  }
  return entries;
}

function prependPathEntries(entries) {
  const delimiter = path.delimiter;
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') || 'PATH';
  const existing = process.env[pathKey] || '';
  const filtered = entries.filter(Boolean).filter((entry) => fs.existsSync(entry));
  const managedEntries = new Set(managedPathEntries());
  const currentParts = existing.split(delimiter).filter(Boolean);
  const next = [
    ...filtered,
    ...currentParts.filter((entry) => !managedEntries.has(entry) && !filtered.includes(entry)),
  ];
  process.env[pathKey] = next.join(delimiter);
}

export function applyManagedRuntimeEnv(options = {}) {
  const nodeEnabled = options.node !== false;
  const pythonEnabled = options.python !== false;
  const gitEnabled = options.git !== false;
  const entries = [];
  const nodePath = nodeExecutablePath();
  if (nodeEnabled && fs.existsSync(nodePath)) {
    entries.push(path.dirname(nodePath));
    process.env.MOSS_NODE_PATH = nodePath;
  } else {
    delete process.env.MOSS_NODE_PATH;
  }
  const pythonPath = pythonExecutablePath();
  if (pythonEnabled && fs.existsSync(pythonPath)) {
    entries.push(path.dirname(pythonPath));
    if (process.platform === 'win32') {
      entries.push(path.join(path.dirname(pythonPath), 'Scripts'));
    }
    process.env.MOSS_PYTHON_PATH = pythonPath;
  } else {
    delete process.env.MOSS_PYTHON_PATH;
  }
  if (process.platform === 'win32' && gitEnabled) {
    const bashPath = gitBashExecutablePath();
    const gitPath = gitExecutablePath();
    if (fs.existsSync(bashPath)) {
      entries.push(path.dirname(bashPath), path.join(gitRoot(), 'usr', 'bin'), path.dirname(gitPath));
      process.env.MOSS_GIT_BASH_PATH = bashPath;
      process.env.CLAUDE_CODE_GIT_BASH_PATH = bashPath;
      process.env.MOSS_GIT_PATH = gitPath;
    }
  } else {
    delete process.env.MOSS_GIT_BASH_PATH;
    delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
    delete process.env.MOSS_GIT_PATH;
  }
  prependPathEntries(entries);
}

export async function ensureManagedRuntimes(options = {}) {
  const results = {};
  for (const [name, fn] of [
    ['node', ensureNodeRuntime],
    ['python', ensurePythonRuntime],
    ['git', ensureGitRuntime],
  ]) {
    if (options[name] === false) {
      results[name] = { ok: true, disabled: true };
      continue;
    }
    try {
      results[name] = await fn();
      if (results[name]?.ok) {
        mossLog('info', 'runtime', `${name} runtime ready`, {
          installed: Boolean(results[name].installed),
          path: results[name].executablePath,
        });
      } else if (results[name]?.missing) {
        mossLog('warn', 'runtime', `${name} runtime resource missing`, {
          resourcesRoot: resourcesRoot(),
          platform: platformId(),
        });
      }
    } catch (error) {
      results[name] = { ok: false, error: error instanceof Error ? error.message : String(error) };
      mossLog('error', 'runtime', `${name} runtime failed`, results[name]);
    }
  }
  applyManagedRuntimeEnv(options);
  return results;
}

export function getManagedRuntimeStatus() {
  return {
    node: {
      path: nodeExecutablePath(),
      installed: fs.existsSync(nodeExecutablePath()),
      resourceAvailable: Boolean(findResource('node')),
    },
    python: {
      path: pythonExecutablePath(),
      installed: fs.existsSync(pythonExecutablePath()),
      resourceAvailable: Boolean(findResource('python')),
    },
    git: process.platform === 'win32'
      ? {
          path: gitBashExecutablePath(),
          installed: fs.existsSync(gitBashExecutablePath()),
          resourceAvailable: Boolean(findResource('git')),
        }
      : { skipped: true },
    registryPath: REGISTRY_PATH,
    resourcesRoot: resourcesRoot(),
  };
}
