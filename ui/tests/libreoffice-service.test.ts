import { afterEach, describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { libreOfficeService } from '../src/process/services/libreoffice-service.mjs';

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) => fsp.rm(target, { recursive: true, force: true })));
});

describe('LibreOffice installer contract', () => {
  it('uses the pinned official Document Foundation archive', () => {
    const downloadUrl = libreOfficeService.getDownloadUrl();
    expect(downloadUrl).toStartWith('https://downloadarchive.documentfoundation.org/libreoffice/old/26.2.1.2/');
    expect(downloadUrl).toContain('LibreOffice_26.2.1.2_');
  });

  it('calculates installer hashes without buffering the whole file', async () => {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-libreoffice-test-'));
    cleanupPaths.push(tempDir);
    const filePath = path.join(tempDir, 'installer.bin');
    await fsp.writeFile(filePath, 'installer-content');

    expect(await libreOfficeService.sha256File(filePath)).toBe(
      createHash('sha256').update('installer-content').digest('hex'),
    );
  });
});
