import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export const LIBRARY_EXTENSION_PACKAGES = Object.freeze([
  Object.freeze({
    id: 'unstructured',
    label: '高级通用文档解析',
    description: '大型可选扩展，增强复杂文字文档、演示文稿、表格和 PDF 的结构提取。',
    spec: 'unstructured[all-docs]',
    distribution: 'unstructured',
  }),
  Object.freeze({
    id: 'pypdf',
    label: 'PDF 文本读取',
    description: '轻量可选扩展，用于读取包含文字层的 PDF。',
    spec: 'pypdf',
    distribution: 'pypdf',
  }),
]);

function sanitizeInstallError(value) {
  return String(value || '')
    .replace(/\b(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@')
    .replace(/\b((?:api[_-]?key|token|password|secret)=)[^&\s]+/gi, '$1***');
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env,
    });
    options.onSpawn?.(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 2 * 1024 * 1024) stdout = stdout.slice(-2 * 1024 * 1024);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 2 * 1024 * 1024) stderr = stderr.slice(-2 * 1024 * 1024);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      options.onSpawn?.(null);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail = sanitizeInstallError(stderr.trim().split('\n').slice(-12).join('\n'));
      reject(new Error(detail || `Python 扩展安装进程退出，代码 ${code}。`));
    });
  });
}

function pythonEnv(modulePath) {
  return {
    ...process.env,
    PYTHONNOUSERSITE: '1',
    PYTHONUTF8: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PYTHONPATH: modulePath,
  };
}

function emptyPackages() {
  return LIBRARY_EXTENSION_PACKAGES.map((entry) => ({
    id: entry.id,
    label: entry.label,
    description: entry.description,
    spec: entry.spec,
    installed: false,
    version: null,
  }));
}

const PROBE_SCRIPT = [
  'import importlib.metadata',
  'import importlib.util',
  'import json',
  `packages = ${JSON.stringify(LIBRARY_EXTENSION_PACKAGES.map((entry) => ({
    id: entry.id,
    module: entry.id,
    distribution: entry.distribution,
  })))}`,
  'result = []',
  'for package in packages:',
  '    installed = importlib.util.find_spec(package["module"]) is not None',
  '    version = None',
  '    if installed:',
  '        try:',
  '            version = importlib.metadata.version(package["distribution"])',
  '        except importlib.metadata.PackageNotFoundError:',
  '            pass',
  '    result.append({"id": package["id"], "installed": installed, "version": version})',
  'print(json.dumps(result))',
].join('\n');

export function createLibraryExtensionManager(options) {
  const pythonVersion = String(options.pythonVersion || 'unknown');
  const pythonRuntimeRoot = path.resolve(options.pythonRuntimeRoot);
  const extensionRoot = path.join(pythonRuntimeRoot, 'extensions', 'library', pythonVersion);
  const modulePath = path.join(extensionRoot, 'site-packages');
  const statePath = path.join(extensionRoot, 'state.json');
  const getPythonPath = options.getPythonPath;
  const onChanged = typeof options.onChanged === 'function' ? options.onChanged : () => {};
  const execute = options.runProcess || runProcess;
  let installation = null;
  let activeChild = null;
  let lastError = '';

  if (options.libraryRoot) {
    const legacyExtensionRoot = path.join(
      path.resolve(options.libraryRoot),
      'extensions',
      `python-${pythonVersion}`,
    );
    if (!fs.existsSync(extensionRoot) && fs.existsSync(legacyExtensionRoot)) {
      try {
        fs.mkdirSync(path.dirname(extensionRoot), { recursive: true });
        fs.renameSync(legacyExtensionRoot, extensionRoot);
      } catch (error) {
        lastError = sanitizeInstallError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  function selectPackages(packageIds) {
    const requestedIds = packageIds === undefined
      ? LIBRARY_EXTENSION_PACKAGES.map((entry) => entry.id)
      : packageIds;
    if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
      throw new Error('请至少选择一个资料库扩展。');
    }
    const uniqueIds = [...new Set(requestedIds)];
    const allowedIds = new Set(LIBRARY_EXTENSION_PACKAGES.map((entry) => entry.id));
    const invalidIds = uniqueIds.filter((id) => typeof id !== 'string' || !allowedIds.has(id));
    if (invalidIds.length > 0) {
      throw new Error('包含不支持的资料库扩展。');
    }
    return LIBRARY_EXTENSION_PACKAGES.filter((entry) => uniqueIds.includes(entry.id));
  }

  async function readInstalledAt() {
    try {
      const state = JSON.parse(await fsp.readFile(statePath, 'utf8'));
      return Number(state.installedAt) || null;
    } catch {
      return null;
    }
  }

  async function probe(target = modulePath) {
    const pythonPath = getPythonPath?.();
    if (!pythonPath || !fs.existsSync(pythonPath) || !fs.existsSync(target)) return emptyPackages();
    const result = await execute(pythonPath, ['-c', PROBE_SCRIPT], {
      env: pythonEnv(target),
      onSpawn: (child) => { activeChild = child; },
    });
    const values = JSON.parse(String(result.stdout || '').trim() || '[]');
    const byId = new Map(values.map((entry) => [entry.id, entry]));
    return LIBRARY_EXTENSION_PACKAGES.map((entry) => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      spec: entry.spec,
      installed: byId.get(entry.id)?.installed === true,
      version: byId.get(entry.id)?.version || null,
    }));
  }

  async function getStatus({ ignoreInstallation = false } = {}) {
    const pythonPath = getPythonPath?.();
    const runtimeAvailable = Boolean(pythonPath && fs.existsSync(pythonPath));
    let packages = emptyPackages();
    if (runtimeAvailable) {
      try {
        packages = await probe();
      } catch (error) {
        lastError = sanitizeInstallError(error instanceof Error ? error.message : String(error));
      }
    }
    const installedCount = packages.filter((entry) => entry.installed).length;
    const ready = installedCount === packages.length;
    return {
      status: installation && !ignoreInstallation
        ? 'installing'
        : ready
          ? 'ready'
          : lastError
            ? 'error'
            : installedCount > 0
              ? 'partial'
            : runtimeAvailable
              ? 'not-installed'
              : 'unavailable',
      runtimeAvailable,
      pythonVersion,
      installedAt: installedCount > 0 ? await readInstalledAt() : null,
      error: ready ? '' : lastError,
      packages,
    };
  }

  async function performInstall(packageIds) {
    lastError = '';
    const stagingPath = path.join(extensionRoot, `.installing-${randomUUID()}`);
    const backupPath = path.join(extensionRoot, `.previous-${randomUUID()}`);
    onChanged({ status: 'installing' });
    try {
      const pythonPath = getPythonPath?.();
      if (!pythonPath || !fs.existsSync(pythonPath)) {
        throw new Error('受管 Python 运行时不可用，请先在设置中安装 Python。');
      }
      const requestedPackages = selectPackages(packageIds);
      await fsp.mkdir(extensionRoot, { recursive: true });
      await fsp.mkdir(stagingPath, { recursive: true });
      const installedPackages = await probe();
      const desiredIds = new Set([
        ...installedPackages.filter((entry) => entry.installed).map((entry) => entry.id),
        ...requestedPackages.map((entry) => entry.id),
      ]);
      const desiredPackages = LIBRARY_EXTENSION_PACKAGES.filter((entry) => desiredIds.has(entry.id));
      await execute(pythonPath, [
        '-m', 'pip', 'install',
        '--disable-pip-version-check',
        '--no-input',
        '--ignore-installed',
        '--upgrade',
        '--upgrade-strategy', 'only-if-needed',
        '--target', stagingPath,
        ...desiredPackages.map((entry) => entry.spec),
      ], {
        env: pythonEnv(stagingPath),
        onSpawn: (child) => { activeChild = child; },
      });
      const packages = await probe(stagingPath);
      const missing = packages.filter((entry) => desiredIds.has(entry.id) && !entry.installed);
      if (missing.length > 0) {
        throw new Error(`以下扩展未能通过安装验证：${missing.map((entry) => entry.spec).join('、')}`);
      }
      if (fs.existsSync(modulePath)) await fsp.rename(modulePath, backupPath);
      try {
        await fsp.rename(stagingPath, modulePath);
      } catch (error) {
        if (fs.existsSync(backupPath)) await fsp.rename(backupPath, modulePath);
        throw error;
      }
      await fsp.rm(backupPath, { recursive: true, force: true });
      const installedAt = Date.now();
      await fsp.writeFile(statePath, `${JSON.stringify({
        schemaVersion: 1,
        pythonVersion,
        installedAt,
        packages: packages.map(({ id, version }) => ({ id, version })),
      }, null, 2)}\n`, 'utf8');
      const status = await getStatus({ ignoreInstallation: true });
      onChanged({ status: status.status, installedAt });
      return status;
    } catch (error) {
      lastError = sanitizeInstallError(error instanceof Error ? error.message : String(error));
      await fsp.rm(stagingPath, { recursive: true, force: true });
      onChanged({ status: 'error', error: lastError });
      throw new Error(lastError);
    } finally {
      activeChild = null;
    }
  }

  function install(packageIds) {
    if (!installation) {
      installation = performInstall(packageIds).finally(() => {
        installation = null;
      });
    }
    return installation;
  }

  return {
    getModulePaths() {
      return fs.existsSync(modulePath) ? [modulePath] : [];
    },
    getStatus,
    install,
    dispose() {
      activeChild?.kill?.('SIGTERM');
      activeChild = null;
    },
  };
}
