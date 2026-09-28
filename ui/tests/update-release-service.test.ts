import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { assetFromMetadata, assetFromChecksums, createReleaseService, fetchUpdateResource } from '../src/update-release-service.mjs';

const digest = createHash('sha512').update('ok').digest('base64');
const repo = 'baiguidong/moss';
const caps = { platform: 'darwin', arch: 'arm64', packageType: 'dmg' };
const makeRelease = (version: string, options = {}) => ({
  tag_name: `v${version}`, draft: false, prerelease: false, body: 'notes', ...options,
  assets: [
    { name: `Moss-${version}-arm64.dmg`, size: 2, browser_download_url: `https://github.com/${repo}/releases/download/v${version}/Moss-${version}-arm64.dmg` },
    { name: 'latest-mac.yml', size: 200, browser_download_url: `https://github.com/${repo}/releases/download/v${version}/latest-mac.yml` },
  ],
});
const metadata = (version: string) => JSON.stringify({ version, files: [{ url: `Moss-${version}-arm64.dmg`, size: 2, sha512: digest }] });

function service(releases: unknown[], currentVersion = '1.0.0', extra = {}) {
  const urls: string[] = [];
  const result = createReleaseService({ repo, currentVersion, capabilities: caps, fetchImpl: async (url: string) => {
    urls.push(url);
    return new Response(url.includes('api.github') ? JSON.stringify(releases) : metadata('1.10.0'));
  }, ...extra });
  return { result, urls };
}

describe('release discovery', () => {
  test('uses SemVer, excludes drafts and all prereleases, binds metadata to the selected tag', async () => {
    const { result, urls } = service([makeRelease('1.2.0'), makeRelease('1.10.0'), makeRelease('9.0.0', { draft: true }), makeRelease('8.0.0', { prerelease: true }), makeRelease('7.0.0-beta.1'), makeRelease('bad')]);
    const candidate = await result.check();
    expect(candidate.version).toBe('1.10.0');
    expect(candidate.asset.sha512).toBe(digest);
    expect(candidate.id).toMatch(/^[a-f0-9]{64}$/);
    expect(urls[1]).toBe(`https://github.com/${repo}/releases/download/v1.10.0/latest-mac.yml`);
  });
  test('never downgrades or reinstalls the same version', async () => {
    for (const current of ['1.10.0', '2.0.0', '2.0.0-beta.1']) {
      const { result, urls } = service([makeRelease('1.10.0')], current);
      expect(await result.check()).toBeNull();
      expect(urls.length).toBe(1);
    }
  });
  test('distinguishes unsupported packages and missing releases from up-to-date', async () => {
    const { result } = service([makeRelease('1.10.0')], '1.0.0', { capabilities: { ...caps, arch: 'x64' } });
    expect((await result.check()).unsupported).toBe(true);
    await expect(service([]).result.check()).rejects.toThrow('稳定版本');
    await expect(service([makeRelease('1.10.0')], 'bad').result.check()).rejects.toThrow('版本号无效');
  });
  test('rejects cross-repository assets and absent checksums', async () => {
    const release = makeRelease('1.10.0');
    release.assets[0].browser_download_url = release.assets[0].browser_download_url.replace('/moss/', '/other/');
    await expect(service([release]).result.check()).rejects.toThrow('不属于');
    const missing = makeRelease('1.10.0'); missing.assets.pop();
    await expect(service([missing]).result.check()).rejects.toThrow('latest-mac.yml');
  });
  test('checks size, version, filename and SHA-512 schema', () => {
    const asset = { name: 'Moss-1.10.0-arm64.dmg', size: 2 };
    expect(assetFromMetadata(metadata('1.10.0'), '1.10.0', asset).sha512).toBe(digest);
    expect(() => assetFromMetadata(metadata('1.10.0'), '1.9.0', asset)).toThrow();
    expect(() => assetFromMetadata(metadata('1.10.0'), '1.10.0', { ...asset, size: 3 })).toThrow();
    expect(() => assetFromMetadata(metadata('1.10.0').replace(digest, 'invalid'), '1.10.0', asset)).toThrow();
    const hex = Buffer.from(digest, 'base64').toString('hex');
    expect(assetFromChecksums(`${hex}  ${asset.name}\n`, asset).sha512).toBe(digest);
    expect(() => assetFromChecksums(`${hex}  other.exe\n`, asset)).toThrow();
  });
  test('validates every redirect and caps redirect loops', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://localhost/private' } }); };
    await expect(fetchUpdateResource('https://github.com/file', { fetchImpl })).rejects.toThrow('不受信任');
    expect(calls).toBe(1);
    await expect(fetchUpdateResource('https://github.com/file', { fetchImpl: async () => new Response(null, { status: 302, headers: { location: '/loop' } }) })).rejects.toThrow('次数过多');
    await expect(fetchUpdateResource('https://github.com/file', { fetchImpl: async () => new Response('', { status: 403 }) })).rejects.toThrow('HTTP 403');
  });
});
