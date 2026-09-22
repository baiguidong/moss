import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  configureDesktopProfile,
  getDesktopCacheRoot,
  getIsolatedElectronPaths,
  isDefaultMossHome,
  resolveMossHome,
} from '../src/moss-home.mjs';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fsp.rm(root, { recursive: true, force: true })
  )));
});

describe('MOSS_HOME desktop profile', () => {
  it('defaults to ~/.moss and resolves configured paths to canonical absolute paths', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-home-resolution-'));
    temporaryRoots.push(root);
    const homeDirectory = path.join(root, 'home');
    const cwd = path.join(root, 'working-directory');
    await Promise.all([
      fsp.mkdir(homeDirectory, { recursive: true }),
      fsp.mkdir(cwd, { recursive: true }),
    ]);

    expect(resolveMossHome('', { homeDirectory, cwd }))
      .toBe(path.join(fs.realpathSync.native(homeDirectory), '.moss'));
    expect(resolveMossHome('~/profiles/work', { homeDirectory, cwd }))
      .toBe(path.join(fs.realpathSync.native(homeDirectory), 'profiles', 'work'));
    expect(resolveMossHome('./profiles/test', { homeDirectory, cwd }))
      .toBe(path.join(fs.realpathSync.native(cwd), 'profiles', 'test'));
  });

  it('resolves symlink aliases before deriving the Electron profile', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-home-alias-'));
    temporaryRoots.push(root);
    const storageRoot = path.join(root, 'storage');
    const storageAlias = path.join(root, 'storage-alias');
    await fsp.mkdir(storageRoot, { recursive: true });
    await fsp.symlink(
      storageRoot,
      storageAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const directHome = path.join(storageRoot, 'profiles', 'work');
    const aliasedHome = path.join(storageAlias, 'profiles', 'work');
    const defaultMossHome = path.join(root, 'default');
    const resolvedHome = resolveMossHome(directHome);

    expect(resolveMossHome(aliasedHome)).toBe(resolvedHome);
    expect(getIsolatedElectronPaths(aliasedHome, defaultMossHome))
      .toEqual(getIsolatedElectronPaths(directHome, defaultMossHome));
  });

  it('keeps the historical Electron profile for the default Moss home', () => {
    const defaultMossHome = resolveMossHome('/tmp/moss-user-home/.moss');
    const calls: unknown[][] = [];
    const env: Record<string, string> = {};
    const app = {
      setPath: (...args: unknown[]) => calls.push(args),
      setAppLogsPath: (...args: unknown[]) => calls.push(args),
    };

    const profile = configureDesktopProfile(app, {
      env,
      mossHome: `${defaultMossHome}${path.sep}`,
      defaultMossHome,
    });

    expect(isDefaultMossHome(profile.mossHome, defaultMossHome)).toBe(true);
    expect(profile.isolatedElectronData).toBe(false);
    expect(profile.electronPaths).toBeNull();
    expect(calls).toEqual([]);
    expect(env.MOSS_HOME).toBe(defaultMossHome);
    expect(env.MOSS_CONFIG_DIR).toBe(defaultMossHome);
  });

  it('preserves MOSS_CONFIG_DIR when MOSS_HOME was not explicitly configured', () => {
    const defaultMossHome = resolveMossHome('/tmp/moss-user-home/.moss');
    const existingConfigDir = path.resolve('/tmp/legacy-moss-config');
    const env: Record<string, string> = { MOSS_CONFIG_DIR: existingConfigDir };
    const app = {
      setPath: () => undefined,
      setAppLogsPath: () => undefined,
    };

    configureDesktopProfile(app, { env, mossHome: defaultMossHome, defaultMossHome });

    expect(env.MOSS_HOME).toBe(defaultMossHome);
    expect(env.MOSS_CONFIG_DIR).toBe(existingConfigDir);
  });

  it('lets an explicit MOSS_HOME override MOSS_CONFIG_DIR even for the default path', () => {
    const defaultMossHome = resolveMossHome('/tmp/moss-user-home/.moss');
    const env: Record<string, string> = {
      MOSS_HOME: defaultMossHome,
      MOSS_CONFIG_DIR: path.resolve('/tmp/legacy-moss-config'),
    };
    const app = {
      setPath: () => undefined,
      setAppLogsPath: () => undefined,
    };

    configureDesktopProfile(app, { env, mossHome: defaultMossHome, defaultMossHome });

    expect(env.MOSS_CONFIG_DIR).toBe(defaultMossHome);
  });

  it('isolates Electron storage and its single-instance lock for a custom Moss home', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-home-profile-'));
    temporaryRoots.push(root);
    const mossHome = path.join(root, 'work');
    const defaultMossHome = path.join(root, 'default');
    const calls: Array<[string, string]> = [];
    const env: Record<string, string> = {};
    const app = {
      setPath: (name: string, value: string) => calls.push([name, value]),
      setAppLogsPath: (value: string) => calls.push(['logs', value]),
    };

    const profile = configureDesktopProfile(app, { env, mossHome, defaultMossHome });
    const paths = getIsolatedElectronPaths(mossHome, defaultMossHome);

    expect(profile.isolatedElectronData).toBe(true);
    expect(profile.electronPaths).toEqual(paths);
    expect(calls).toEqual([
      ['userData', paths?.userData || ''],
      ['sessionData', paths?.sessionData || ''],
      ['crashDumps', paths?.crashDumps || ''],
      ['logs', paths?.logs || ''],
    ]);
    const resolvedMossHome = resolveMossHome(mossHome);
    expect(env).toEqual({
      MOSS_HOME: resolvedMossHome,
      MOSS_CONFIG_DIR: resolvedMossHome,
    });
    for (const directory of Object.values(paths || {})) {
      expect(fs.statSync(directory).isDirectory()).toBe(true);
    }
  });

  it('keeps the legacy cache for the default profile and isolates custom caches', () => {
    const defaultMossHome = resolveMossHome('/tmp/moss-user-home/.moss');
    const customMossHome = resolveMossHome('/tmp/moss-user-home/work');
    const legacyCacheRoot = path.resolve('/tmp/electron-cache');

    expect(getDesktopCacheRoot(defaultMossHome, legacyCacheRoot, defaultMossHome))
      .toBe(legacyCacheRoot);
    expect(getDesktopCacheRoot(customMossHome, legacyCacheRoot, defaultMossHome))
      .toBe(path.join(customMossHome, 'cache'));
  });

  it('configures the Electron profile before requesting the single-instance lock', async () => {
    const source = await Bun.file(new URL('../src/main.mjs', import.meta.url)).text();
    expect(source.indexOf('configureDesktopProfile(app);')).toBeGreaterThan(-1);
    expect(source.indexOf('configureDesktopProfile(app);'))
      .toBeLessThan(source.indexOf('app.requestSingleInstanceLock()'));
  });
});
