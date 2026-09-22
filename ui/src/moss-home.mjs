import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function canonicalizePath(value) {
  const absolutePath = path.resolve(value).normalize('NFC');
  const missingSegments = [];
  let existingPath = absolutePath;

  while (true) {
    try {
      const realPath = fs.realpathSync.native(existingPath);
      return path.join(realPath, ...missingSegments.reverse()).normalize('NFC');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;

      const parentPath = path.dirname(existingPath);
      if (parentPath === existingPath) return absolutePath;
      missingSegments.push(path.basename(existingPath));
      existingPath = parentPath;
    }
  }
}

function normalizePathForComparison(value) {
  const normalized = canonicalizePath(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function resolveMossHome(
  configuredHome = process.env.MOSS_HOME,
  { homeDirectory = os.homedir(), cwd = process.cwd() } = {},
) {
  const defaultHome = path.join(homeDirectory, '.moss');
  const value = typeof configuredHome === 'string' ? configuredHome.trim() : '';
  if (!value) return canonicalizePath(defaultHome);

  const expanded = value === '~'
    ? homeDirectory
    : value.startsWith('~/') || value.startsWith('~\\')
      ? path.join(homeDirectory, value.slice(2))
      : value;
  return canonicalizePath(path.resolve(cwd, expanded));
}

export const DEFAULT_MOSS_HOME = resolveMossHome('');
export const MOSS_HOME = resolveMossHome();

export function isDefaultMossHome(
  mossHome = MOSS_HOME,
  defaultMossHome = DEFAULT_MOSS_HOME,
) {
  return normalizePathForComparison(mossHome) === normalizePathForComparison(defaultMossHome);
}

export function getIsolatedElectronPaths(
  mossHome = MOSS_HOME,
  defaultMossHome = DEFAULT_MOSS_HOME,
) {
  const resolvedMossHome = resolveMossHome(mossHome);
  if (isDefaultMossHome(resolvedMossHome, defaultMossHome)) return null;

  const root = path.join(resolvedMossHome, 'electron');
  return Object.freeze({
    root,
    userData: path.join(root, 'user-data'),
    sessionData: path.join(root, 'session-data'),
    crashDumps: path.join(root, 'crash-dumps'),
    logs: path.join(root, 'logs'),
  });
}

export function getDesktopCacheRoot(
  mossHome = MOSS_HOME,
  legacyCacheRoot,
  defaultMossHome = DEFAULT_MOSS_HOME,
) {
  const resolvedMossHome = resolveMossHome(mossHome);
  return isDefaultMossHome(resolvedMossHome, defaultMossHome)
    ? legacyCacheRoot
    : path.join(resolvedMossHome, 'cache');
}

export function configureDesktopProfile(
  app,
  {
    env = process.env,
    mossHome = MOSS_HOME,
    defaultMossHome = DEFAULT_MOSS_HOME,
  } = {},
) {
  const hasExplicitMossHome = typeof env.MOSS_HOME === 'string' && env.MOSS_HOME.trim() !== '';
  const resolvedMossHome = resolveMossHome(mossHome);
  env.MOSS_HOME = resolvedMossHome;
  // The embedded Agent runtime uses MOSS_CONFIG_DIR for its user-scoped
  // settings, memory, tasks, and skills. An explicit/custom MOSS_HOME is
  // authoritative, while the default profile keeps legacy MOSS_CONFIG_DIR.
  const hasMossConfigDir = typeof env.MOSS_CONFIG_DIR === 'string'
    && env.MOSS_CONFIG_DIR.trim() !== '';
  if (hasExplicitMossHome
    || !isDefaultMossHome(resolvedMossHome, defaultMossHome)
    || !hasMossConfigDir) {
    env.MOSS_CONFIG_DIR = resolvedMossHome;
  }

  const electronPaths = getIsolatedElectronPaths(resolvedMossHome, defaultMossHome);
  if (!electronPaths) {
    return Object.freeze({ mossHome: resolvedMossHome, isolatedElectronData: false, electronPaths: null });
  }

  for (const directory of Object.values(electronPaths)) {
    fs.mkdirSync(directory, { recursive: true });
  }
  app.setPath('userData', electronPaths.userData);
  app.setPath('sessionData', electronPaths.sessionData);
  app.setPath('crashDumps', electronPaths.crashDumps);
  app.setAppLogsPath(electronPaths.logs);

  return Object.freeze({ mossHome: resolvedMossHome, isolatedElectronData: true, electronPaths });
}
