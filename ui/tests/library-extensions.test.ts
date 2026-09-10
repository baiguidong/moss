import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createLibraryExtensionManager,
  LIBRARY_EXTENSION_PACKAGES,
} from '../src/library/library-extensions.mjs';

describe('Library extension manager', () => {
  test('offers only parser extensions used by the Library worker', () => {
    expect(LIBRARY_EXTENSION_PACKAGES.map((entry) => entry.id))
      .toEqual(['unstructured', 'pypdf']);
  });

  test('installs selected allowlisted packages into the managed Python extension path', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-library-extensions-'));
    const pythonPath = path.join(root, 'python');
    await fsp.writeFile(pythonPath, 'fixture');
    const installedIds = new Set<string>();
    const calls: string[][] = [];
    const manager = createLibraryExtensionManager({
      libraryRoot: path.join(root, 'library'),
      pythonRuntimeRoot: path.join(root, 'runtimes', 'python'),
      pythonVersion: '3.13.15',
      getPythonPath: () => pythonPath,
      runProcess: async (_command: string, args: string[]) => {
        calls.push(args);
        if (args[0] === '-m') {
          for (const entry of LIBRARY_EXTENSION_PACKAGES) {
            if (args.includes(entry.spec)) installedIds.add(entry.id);
          }
          return { stdout: '', stderr: '' };
        }
        return {
          stdout: JSON.stringify(LIBRARY_EXTENSION_PACKAGES.map((entry) => ({
            id: entry.id,
            installed: installedIds.has(entry.id),
            version: installedIds.has(entry.id) ? '1.0.0' : null,
          }))),
          stderr: '',
        };
      },
    });
    try {
      expect((await manager.getStatus()).status).toBe('not-installed');
      const status = await manager.install(['pypdf']);
      expect(status.status).toBe('partial');
      expect(status.packages.filter((entry) => entry.installed).map((entry) => entry.id))
        .toEqual(['pypdf']);
      const installArgs = calls.find((args) => args[0] === '-m');
      expect(installArgs).toContain('--ignore-installed');
      expect(installArgs).toContain('pypdf');
      expect(installArgs).not.toContain('unstructured[all-docs]');
      expect(manager.getModulePaths()).toHaveLength(1);
      expect(fs.existsSync(manager.getModulePaths()[0])).toBe(true);
      expect(manager.getModulePaths()[0]).toBe(path.join(
        root,
        'runtimes',
        'python',
        'extensions',
        'library',
        '3.13.15',
        'site-packages',
      ));

      const next = await manager.install(['unstructured']);
      expect(next.status).toBe('ready');
      const installCalls = calls.filter((args) => args[0] === '-m');
      expect(installCalls[1]).toContain('pypdf');
      expect(installCalls[1]).toContain('unstructured[all-docs]');
    } finally {
      manager.dispose();
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  test('redacts credentials from installation errors', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-library-extensions-error-'));
    const pythonPath = path.join(root, 'python');
    await fsp.writeFile(pythonPath, 'fixture');
    const manager = createLibraryExtensionManager({
      libraryRoot: path.join(root, 'library'),
      pythonRuntimeRoot: path.join(root, 'runtimes', 'python'),
      pythonVersion: '3.13.15',
      getPythonPath: () => pythonPath,
      runProcess: async (_command: string, args: string[]) => {
        if (args[0] === '-m') {
          throw new Error('https://alice:password@example.test/simple?token=secret-value');
        }
        return { stdout: '[]', stderr: '' };
      },
    });
    try {
      await expect(manager.install()).rejects.toThrow('https://***:***@example.test/simple?token=***');
      const status = await manager.getStatus();
      expect(status.error).not.toContain('alice');
      expect(status.error).not.toContain('secret-value');
    } finally {
      manager.dispose();
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  test('rejects package ids outside the fixed allowlist', async () => {
    const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-library-extensions-invalid-'));
    const pythonPath = path.join(root, 'python');
    await fsp.writeFile(pythonPath, 'fixture');
    const manager = createLibraryExtensionManager({
      pythonRuntimeRoot: path.join(root, 'runtimes', 'python'),
      pythonVersion: '3.13.15',
      getPythonPath: () => pythonPath,
      runProcess: async () => ({ stdout: '[]', stderr: '' }),
    });
    try {
      await expect(manager.install(['renderer-controlled-package'])).rejects
        .toThrow('包含不支持的资料库扩展');
    } finally {
      manager.dispose();
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});
