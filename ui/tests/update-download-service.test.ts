import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, readdir, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDownloadService, verifyUpdateFile } from '../src/update-download-service.mjs';

const dirs: string[] = [];
const data = Buffer.from('a verified installer');
const candidate = { id: 'a'.repeat(64), asset: { name: 'Moss-1.2.3-arm64.dmg', url: 'https://github.com/baiguidong/moss/releases/download/v1.2.3/Moss-1.2.3-arm64.dmg', size: data.length, sha512: createHash('sha512').update(data).digest('base64') } };
async function setup(fetchImpl = async () => new Response(data)) {
  const directory = await mkdtemp(path.join(tmpdir(), 'moss-update-')); dirs.push(directory);
  return { directory, service: createDownloadService({ directory, fetchImpl }) };
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

test('verifies downloads, reuses only intact cache, repairs tampered cache and leaves user files alone', async () => {
  let calls = 0;
  const { service, directory } = await setup(async () => { calls++; return new Response(data); });
  const userFile = path.join(directory, candidate.asset.name);
  await writeFile(userFile, 'user file');
  const file = await service.download(candidate);
  expect(await readFile(file)).toEqual(data);
  expect(await service.download(candidate)).toBe(file);
  expect(calls).toBe(1);
  await writeFile(file, Buffer.alloc(data.length));
  await service.download(candidate);
  expect(calls).toBe(2);
  expect(await readFile(userFile, 'utf8')).toBe('user file');
  expect(await readdir(path.dirname(file))).toEqual([candidate.asset.name]);
});

test('digest mismatch and truncated/oversized downloads leave no final file or partial file', async () => {
  for (const body of [Buffer.alloc(data.length), Buffer.from('short'), Buffer.alloc(data.length + 1)]) {
    const { service, directory } = await setup(async () => new Response(body));
    await expect(service.download(candidate)).rejects.toThrow();
    expect(await readdir(path.join(directory, candidate.id))).toEqual([]);
  }
});

test('cancellation cleans only the current partial file', async () => {
  const controller = new AbortController();
  const { service, directory } = await setup(async () => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(data.subarray(0, 3));
      setTimeout(() => controller.abort(), 15);
    },
  })));
  await expect(service.download(candidate, { signal: controller.signal })).rejects.toThrow();
  expect(await readdir(path.join(directory, candidate.id))).toEqual([]);
});

test('opening rejects missing, modified and symbolic-link files', async () => {
  const { service, directory } = await setup();
  const file = await service.download(candidate);
  await verifyUpdateFile(file, candidate.asset);
  await writeFile(file, Buffer.alloc(data.length));
  await expect(verifyUpdateFile(file, candidate.asset)).rejects.toThrow();
  await rm(file);
  await expect(verifyUpdateFile(file, candidate.asset)).rejects.toThrow();
  const target = path.join(directory, 'target'); await writeFile(target, data);
  await symlink(target, file);
  await expect(verifyUpdateFile(file, candidate.asset)).rejects.toThrow();
});

test('rejects unsafe names and symlink cache directories', async () => {
  const { service, directory } = await setup();
  await expect(service.download({ ...candidate, asset: { ...candidate.asset, name: '../evil.dmg' } })).rejects.toThrow();
  const target = path.join(directory, 'target'); await mkdir(target);
  await symlink(target, path.join(directory, candidate.id), 'dir');
  await expect(service.download(candidate)).rejects.toThrow('更新目录无效');
});

test('stalled download times out and removes the partial file', async () => {
  const { directory } = await setup();
  const service = createDownloadService({ directory, idleTimeout: 10, fetchImpl: async () => new Response(new ReadableStream({ start(stream) { stream.enqueue(data.subarray(0, 3)); } })) });
  await expect(service.download(candidate)).rejects.toThrow();
  expect(await readdir(path.join(directory, candidate.id))).toEqual([]);
});
