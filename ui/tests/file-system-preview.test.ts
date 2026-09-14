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
