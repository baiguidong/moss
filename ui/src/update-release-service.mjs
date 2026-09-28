import { createHash } from 'node:crypto';
import semver from 'semver';
import * as yaml from 'js-yaml';
import { pickRecommendedReleaseAsset } from './update-capabilities.mjs';

const DOWNLOAD_HOSTS = new Set(['github.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com', 'release-assets.githubusercontent.com']);
export function assertUpdateUrl(raw, { api = false } = {}) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !(DOWNLOAD_HOSTS.has(url.hostname) || (api && url.hostname === 'api.github.com'))) {
    throw new Error('更新地址不受信任。');
  }
  return url;
}

export async function fetchUpdateResource(url, { fetchImpl = fetch, signal, api = false } = {}) {
  for (let redirects = 0; redirects <= 5; redirects++) {
    assertUpdateUrl(url, { api });
    const response = await fetchImpl(url, { signal, redirect: 'manual', headers: { 'User-Agent': 'Moss', Accept: api ? 'application/vnd.github+json' : '*/*' } });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) throw new Error('更新下载重定向缺少地址。');
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`更新请求失败（HTTP ${response.status}），请稍后重试。`);
    }
    return response;
  }
  throw new Error('更新下载重定向次数过多。');
}

async function readText(url, options) {
  const response = await fetchUpdateResource(url, options);
  if (!response.body) throw new Error('更新服务器返回了空内容。');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('更新元数据过大。');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function validateSha512(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(value) || Buffer.from(value, 'base64').length !== 64) {
    throw new Error('更新包缺少有效的 SHA-512 校验信息。');
  }
  return value;
}

export function assetFromMetadata(text, version, asset) {
  const metadata = yaml.load(text, { schema: yaml.JSON_SCHEMA });
  if (!metadata || metadata.version !== version || !Array.isArray(metadata.files)) throw new Error('更新元数据版本不匹配。');
  const entries = metadata.files.filter(entry => entry?.url === asset.name || entry?.url === encodeURIComponent(asset.name));
  if (entries.length !== 1 || entries[0].size !== asset.size || !Number.isSafeInteger(asset.size) || asset.size <= 0) {
    throw new Error('更新元数据中的文件名或大小不匹配。');
  }
  return { ...asset, sha512: validateSha512(entries[0].sha512) };
}

export function assetFromChecksums(text, asset) {
  const lines = text.split(/\r?\n/).filter(Boolean).map(line => /^([a-f0-9]{128}) [ *](.+)$/i.exec(line));
  const matches = lines.filter(line => line?.[2] === asset.name);
  if (matches.length !== 1) throw new Error('便携版缺少匹配的 SHA-512 校验信息。');
  return { ...asset, sha512: Buffer.from(matches[0][1], 'hex').toString('base64') };
}

export function createReleaseService({ repo, currentVersion, capabilities, fetchImpl = fetch }) {
  return {
    async check() {
      if (!semver.valid(currentVersion)) throw new Error('当前版本号无效，无法检查更新。');
      const options = { fetchImpl, signal: AbortSignal.timeout(30_000) };
      const releases = JSON.parse(await readText(`https://api.github.com/repos/${repo}/releases?per_page=100`, { ...options, api: true }));
      if (!Array.isArray(releases)) throw new Error('更新服务器返回格式错误。');
      const stable = releases.filter(release => !release.draft && !release.prerelease
        && typeof release.tag_name === 'string' && semver.valid(release.tag_name.replace(/^v/, ''))
        && !semver.prerelease(release.tag_name.replace(/^v/, '')))
        .sort((a, b) => semver.rcompare(a.tag_name.replace(/^v/, ''), b.tag_name.replace(/^v/, '')));
      if (!stable.length) throw new Error('尚未找到已发布的稳定版本。');
      const release = stable[0];
      const version = release.tag_name.replace(/^v/, '');
      if (!semver.gt(version, currentVersion)) return null;
      const tag = release.tag_name;
      const feedUrl = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/`;
      const htmlUrl = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const rawAsset = pickRecommendedReleaseAsset(assets, capabilities.platform, capabilities.arch, capabilities.packageType, version);
      if (!rawAsset) return { unsupported: true, version, htmlUrl, reason: `此版本尚无适用于 ${capabilities.platform} ${capabilities.arch}（${capabilities.packageType}）的安装包。` };
      const getAsset = (raw) => {
        const url = new URL(raw.browser_download_url);
        if (url.href !== new URL(encodeURIComponent(raw.name), feedUrl).href) throw new Error('更新资产不属于当前版本。');
        if (!Number.isSafeInteger(raw.size) || raw.size <= 0) throw new Error('更新资产大小无效。');
        return { name: raw.name, size: raw.size, url: url.href };
      };
      let asset = getAsset(rawAsset);
      const metadataName = capabilities.packageType === 'portable' ? 'SHA512SUMS' : capabilities.platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
      const rawMetadata = assets.filter(item => item.name === metadataName);
      if (rawMetadata.length !== 1) throw new Error(`发布版本缺少 ${metadataName}，请前往发布页。`);
      const metadata = await readText(getAsset(rawMetadata[0]).url, options);
      asset = capabilities.packageType === 'portable' ? assetFromChecksums(metadata, asset) : assetFromMetadata(metadata, version, asset);
      const id = createHash('sha256').update(JSON.stringify({ tag, version, asset, platform: capabilities.platform, arch: capabilities.arch })).digest('hex');
      return { id, tag, version, asset, feedUrl, htmlUrl, notes: typeof release.body === 'string' ? release.body.slice(0, 20000) : '' };
    },
  };
}
