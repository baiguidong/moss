import { afterEach, describe, expect, it } from 'bun:test';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

import { registerFileSystemIpcHandlers } from '../src/file-system-ipc.mjs';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => fsp.rm(target, { recursive: true, force: true })));
});

describe('file-system image preview', () => {
  it('converts TIFF input to a browser-compatible PNG data URL', async () => {
    const handlers = new Map<string, (...args: any[]) => Promise<any>>();
    registerFileSystemIpcHandlers({
      ipcMain: { handle: (name: string, handler: (...args: any[]) => Promise<any>) => handlers.set(name, handler) },
      uiRoot: '/tmp',
      getSessionRecord: () => ({ workspace: '/tmp' }),
      maxImageBase64Bytes: 1024 * 1024,
      maxReadTextBytes: 1024 * 1024,
    });
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-image-preview-test-'));
    cleanupPaths.push(tempDir);
    const filePath = path.join(tempDir, 'sample.tiff');
    await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 120, b: 220 } },
    }).tiff().toFile(filePath);

    const handler = handlers.get('fs:getImageBase64');
    expect(handler).toBeDefined();
    const result = await handler?.(null, { path: filePath });

    expect(result).toStartWith('data:image/png;base64,');
  });
});

describe('explicit file-card preview', () => {
  async function setup() {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-file-preview-test-'));
    cleanupPaths.push(tempDir);
    const workspace = path.join(tempDir, 'workspace');
    await fsp.mkdir(workspace);
    const sessions = {
      local: { id: 'local', workspace, agentMode: 'local' },
      remote: { id: 'remote', agentMode: 'remote-direct', remoteWorkspace: '/remote' },
    };
    const calls: Array<{ session: any; filePath: string }> = [];
    const handlers = new Map<string, (...args: any[]) => Promise<any>>();
    registerFileSystemIpcHandlers({
      ipcMain: { handle: (name: string, handler: (...args: any[]) => Promise<any>) => handlers.set(name, handler) },
      getSessionRecord: (id: keyof typeof sessions) => {
        if (!sessions[id]) throw new Error('Session not found');
        return sessions[id];
      },
      readWorkspaceFile: async (session: any, filePath: string) => {
        calls.push({ session, filePath });
        return {
          path: filePath,
          content: session.agentMode === 'remote-direct' ? 'remote content' : await fsp.readFile(filePath, 'utf8'),
          contentType: 'markdown',
          metadata: { previewEngine: 'native' },
        };
      },
      uiRoot: tempDir,
      maxImageBase64Bytes: 1024,
      maxReadTextBytes: 1024,
    });
    return { tempDir, workspace, sessions, calls, preview: handlers.get('preview:read-file')!, resolveFiles: handlers.get('preview:resolve-files')! };
  }

  it('resolves readable files with exact names and canonical paths, including files outside the workspace', async () => {
    const { tempDir, workspace, resolveFiles } = await setup();
    const fileName = process.platform === 'win32' ? '《报告》 空格.md' : '《报告》 空格.md:12';
    const filePath = path.join(workspace, fileName);
    const outside = path.join(tempDir, 'outside.md');
    const alias = path.join(tempDir, 'alias.md');
    await fsp.writeFile(filePath, '# report');
    await fsp.writeFile(outside, '# outside');
    await fsp.symlink(filePath, alias);
    const results = await resolveFiles(null, { sessionId: 'local', paths: [filePath, alias, outside, filePath] });
    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ inputPath: filePath, file: {
      path: await fsp.realpath(filePath), name: fileName, size: 8, relativePath: fileName,
    } });
    expect(results[1].file).toEqual(results[0].file);
    expect(results[2].file.path).toBe(await fsp.realpath(outside));
    expect(results[2].file.relativePath).toBeUndefined();
  });

  it('rejects relative paths, URIs, directories, missing files and unreadable files without guessing', async () => {
    const { workspace, resolveFiles } = await setup();
    const filePath = path.join(workspace, 'exists.md');
    await fsp.writeFile(filePath, '# report');
    const invalid = ['exists.md', './exists.md', '~/exists.md', `file://${filePath}`, 'moss-knowledge://resource/id', '/tmp/bad\0.md'];
    if (process.platform === 'win32') invalid.push('/exists.md', '\\exists.md', 'C:exists.md');
    const results = await resolveFiles(null, { sessionId: 'local', paths: [...invalid, workspace, path.join(workspace, 'missing.md')] });
    expect(results.slice(0, invalid.length).every((result: any) => result.error === 'INVALID_PATH')).toBe(true);
    expect(results[invalid.length].error).toBe('NOT_FILE');
    expect(results.at(-1).error).toBe('ENOENT');
    if (process.platform !== 'win32' && process.getuid?.() !== 0) {
      await fsp.chmod(filePath, 0);
      try {
        expect((await resolveFiles(null, { sessionId: 'local', paths: [filePath] }))[0].error).toBe('EACCES');
      } finally { await fsp.chmod(filePath, 0o600); }
    }
  });

  it('rejects remote, unknown and missing sessions even when the path exists locally', async () => {
    const { workspace, resolveFiles } = await setup();
    const filePath = path.join(workspace, 'exists.md');
    await fsp.writeFile(filePath, '# report');
    for (const sessionId of ['remote', 'missing', undefined]) {
      expect(await resolveFiles(null, { sessionId, paths: [filePath] })).toEqual([{ inputPath: filePath, error: 'NOT_LOCAL_SESSION' }]);
    }
  });

  it('handles non-regular files without waiting for a writer', async () => {
    if (process.platform === 'win32') return;
    const { workspace, resolveFiles } = await setup();
    const fifo = path.join(workspace, 'pipe.md');
    const processResult = Bun.spawnSync(['mkfifo', fifo]);
    expect(processResult.exitCode).toBe(0);
    expect(await resolveFiles(null, { sessionId: 'local', paths: [fifo] })).toEqual([{ inputPath: fifo, error: 'NOT_FILE' }]);
  });

  it('rechecks availability after a file is deleted', async () => {
    const { workspace, resolveFiles } = await setup();
    const filePath = path.join(workspace, 'report.md');
    await fsp.writeFile(filePath, '# report');
    const resolved = await resolveFiles(null, { sessionId: 'local', paths: [filePath] });
    expect(resolved[0].file).toBeDefined();
    await fsp.unlink(filePath);
    expect((await resolveFiles(null, { sessionId: 'local', paths: [resolved[0].file.path] }))[0].error).toBe('ENOENT');
  });

  it('previews files outside the workspace without enabling workspace edits', async () => {
    const { tempDir, workspace, preview, calls, sessions } = await setup();
    const filePath = path.join(tempDir, 'WELCOME.md');
    await fsp.writeFile(filePath, '# Welcome');
    const result = await preview(null, { sessionId: 'local', filePath });
    expect(result.content).toBe('# Welcome');
    expect(result.metadata).toEqual({ previewEngine: 'native', previewEditable: false, previewSaveable: false });
    expect(calls[0].session.workspace).toBe(await fsp.realpath(tempDir));
    expect(sessions.local.workspace).toBe(workspace);
    expect((await preview(null, { filePath })).content).toBe('# Welcome');
  });

  it('retains the session reader for workspace files, including aliased workspace paths', async () => {
    const { tempDir, workspace, preview, calls, sessions } = await setup();
    const filePath = path.join(workspace, 'report.md');
    await fsp.writeFile(filePath, '# Report');
    const alias = path.join(tempDir, 'workspace-alias');
    await fsp.symlink(workspace, alias, 'dir');
    sessions.local.workspace = alias;
    const result = await preview(null, { sessionId: 'local', filePath });
    expect(result.content).toBe('# Report');
    expect(result.metadata.previewSaveable).toBeUndefined();
    expect(calls[0]).toEqual({ session: sessions.local, filePath: path.join(alias, 'report.md') });
  });

  it('routes remote previews through the authenticated session reader without local file access', async () => {
    const { preview, calls, sessions } = await setup();
    const result = await preview(null, { sessionId: 'remote', filePath: '/remote/only-on-server.md' });
    expect(result.content).toBe('remote content');
    expect(calls[0]).toEqual({ session: sessions.remote, filePath: '/remote/only-on-server.md' });
    await expect(preview(null, { sessionId: 'missing', filePath: '/tmp/missing.md' })).rejects.toThrow('Session not found');
  });
});
