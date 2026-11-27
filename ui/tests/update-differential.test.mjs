import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createDownloadService, promoteMacUpdateBase } from '../src/update-download-service.mjs';

const name = 'Moss-1.2.3-arm64-mac.zip';
const candidate = { id: 'a'.repeat(64), version: '1.2.3', asset: {
  name, size: 12, url: 'https://github.com/baiguidong/moss/releases/download/v1.2.3/' + name,
  sha512: createHash('sha512').update('CCCCnew!AAAA').digest('base64'),
} };
const blockmap = checksums => gzipSync(JSON.stringify({
  version: '2', files: [{ name: 'file', offset: 0, sizes: [4, 4, 4], checksums }],
}));

async function fixture(t, sendRange) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-delta-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const baseFile = path.join(directory, 'base-arm64.zip');
  await fs.writeFile(baseFile, 'AAAABBBBCCCC');
  const requests = [];
  const service = createDownloadService({ directory, baseFile, baseVersion: '1.0.0', fetchImpl: async (url, { headers }) => {
    requests.push(headers.Range || url);
    if (url.includes('/v1.0.0/Moss-1.0.0-arm64-mac.zip.blockmap')) return new Response(blockmap(['A', 'B', 'C']));
    if (url === candidate.asset.url + '.blockmap') return new Response(blockmap(['C', 'N', 'A']));
    assert.equal(url, candidate.asset.url);
    if (headers.Range) {
      assert.equal(headers.Range, 'bytes=4-7');
      return sendRange ? sendRange() : new Response('new!', { status: 206, headers: { 'Content-Range': 'bytes 4-7/12' } });
    }
    return new Response('CCCCnew!AAAA');
  } });
  return { directory, baseFile, service, requests };
}

test('reorders old blocks, fetches only missing bytes and promotes a legacy install receipt', async t => {
  const { directory, baseFile, service, requests } = await fixture(t);
  let progress;
  const file = await service.download(candidate, { onProgress: value => { progress = value; } });
  assert.equal(requests.length, 3);
  assert.equal(progress.total, 4);
  assert.equal(progress.transferred, 4);
  assert.equal(await fs.readFile(file, 'utf8'), 'CCCCnew!AAAA');
  const receipt = { directory, arch: 'arm64', currentVersion: candidate.version, attempt: {
    from: '1.0.0', version: candidate.version, candidateId: candidate.id, path: file, asset: candidate.asset,
  } };
  assert.equal(await promoteMacUpdateBase({ ...receipt, currentVersion: '1.2.2' }), false);
  assert.equal(await promoteMacUpdateBase(receipt), true);
  assert.equal(await promoteMacUpdateBase(receipt), true);
  assert.equal(await fs.readFile(baseFile, 'utf8'), 'CCCCnew!AAAA');
});

test('range or digest failure requires an explicit full download and cleans partial output', async t => {
  for (const response of [
    () => new Response('CCCCnew!AAAA'),
    () => new Response('new!', { status: 206, headers: { 'Content-Range': 'bytes 3-6/12' } }),
    () => new Response('evil', { status: 206, headers: { 'Content-Range': 'bytes 4-7/12' } }),
  ]) {
    const { directory, service, requests } = await fixture(t, response);
    await assert.rejects(service.download(candidate), { code: 'FULL_DOWNLOAD_REQUIRED' });
    assert.deepEqual(await fs.readdir(path.join(directory, candidate.id)), []);
    assert.ok(!requests.includes(candidate.asset.url));
    await service.download(candidate, { full: true });
    assert.equal(requests.at(-1), candidate.asset.url);
  }
});

test('cancelling a range stops the transfer and never falls back', async t => {
  const controller = new AbortController();
  const { service, requests } = await fixture(t, () => {
    controller.abort();
    return new Response();
  });
  await assert.rejects(service.download(candidate, { signal: controller.signal }), { name: 'AbortError' });
  assert.ok(!requests.includes(candidate.asset.url));
});
