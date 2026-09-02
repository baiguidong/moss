export function supportsAutomaticUpdates(platform = process.platform) {
  return platform === 'win32';
}

export const UNSIGNED_AUTO_UPDATE_MESSAGE =
  'Automatic installation is disabled for unsigned builds; download the installer from the release instead.';

export function scoreReleaseAsset(asset, platform = process.platform, arch = process.arch) {
  const name = String(asset?.name || '');
  const nameLower = name.toLowerCase();
  const extension = name.slice(name.lastIndexOf('.'));
  const platformHints = platform === 'win32'
    ? ['win', 'win32', 'windows']
    : platform === 'darwin'
      ? ['mac', 'darwin', 'osx']
      : ['linux'];
  const archHints = arch === 'arm64' ? ['arm64', 'aarch64'] : ['x64', 'x86_64', 'amd64'];
  let score = 0;

  if (platformHints.some((hint) => nameLower.includes(hint))) score += 20;
  if (archHints.some((hint) => nameLower.includes(hint))) score += 10;

  if (platform === 'win32') {
    if (extension === '.exe') score += 100;
    if (extension === '.msi') score += 90;
    if (extension === '.zip') score += 50;
    if (/\bsetup\b/i.test(name)) score += 30;
    if (/\bportable\b/i.test(name)) score -= 10;
  } else if (platform === 'darwin') {
    if (extension === '.dmg') score += 100;
    if (extension === '.zip') score += 70;
  } else {
    if (extension === '.AppImage') score += 100;
    if (extension === '.deb') score += 90;
    if (extension === '.rpm') score += 80;
    if (extension === '.zip') score += 40;
  }

  return score;
}

export function pickRecommendedReleaseAsset(assets, platform = process.platform, arch = process.arch) {
  return assets
    .map((asset) => ({ asset, score: scoreReleaseAsset(asset, platform, arch) }))
    .sort((left, right) => right.score - left.score)[0]?.asset;
}
