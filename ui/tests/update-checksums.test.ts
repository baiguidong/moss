import { expect, test } from 'bun:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { writeUpdateChecksums } from '../scripts/write-update-checksums.mjs';
import { assetFromChecksums } from '../src/update-release-service.mjs';

test('release-generated checksums match final NSIS and Portable bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'moss-checksums-'));
  try {
    const names = ['Moss-Setup-1.2.3-x64.exe', 'Moss-Portable-1.2.3-x64.exe'];
    await expect(writeUpdateChecksums({ directory, version: '1.2.3' })).rejects.toThrow();
    for (const name of names) await writeFile(path.join(directory, name), name);
    await writeUpdateChecksums({ directory, version: '1.2.3' });
    const text = await readFile(path.join(directory, 'SHA512SUMS'), 'utf8');
    for (const name of names) expect(assetFromChecksums(text, { name }).sha512).toBe(createHash('sha512').update(name).digest('base64'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
