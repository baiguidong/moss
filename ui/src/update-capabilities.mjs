export function supportsAutomaticUpdates(platform = process.platform, portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR)) {
  return platform === 'win32' && !portable;
}

export function getUpdateCapabilities({ platform, arch, isPackaged, portable = false, hasNsisMarker = false }) {
  const base = { platform, arch, packageType: portable ? 'portable' : platform === 'darwin' ? 'dmg' : 'nsis' };
  if (!isPackaged) return { ...base, mode: 'development', reason: '开发模式不检查或安装更新。' };
  if (!['x64', 'arm64'].includes(arch) || !['darwin', 'win32'].includes(platform)) {
    return { ...base, mode: 'unsupported', reason: '当前系统或架构暂不支持桌面更新。' };
  }
  if (platform === 'darwin' || portable) return { ...base, mode: 'manual' };
  if (!hasNsisMarker) return { ...base, mode: 'unsupported', reason: '未识别到 Windows 安装版，请从发布页下载安装包。' };
  return { ...base, mode: 'nativeUpdater' };
}

// Never fall back to a different architecture or package format.
export function pickRecommendedReleaseAsset(assets, platform = process.platform, arch = process.arch, packageType = 'nsis', version) {
  if (!['x64', 'arm64'].includes(arch)) return undefined;
  const prefix = platform === 'darwin' ? 'Moss-' : platform === 'win32'
    ? `Moss-${packageType === 'portable' ? 'Portable' : 'Setup'}-` : null;
  if (!prefix) return undefined;
  const suffix = `-${arch}.${platform === 'darwin' ? 'dmg' : 'exe'}`;
  const matches = assets.filter(({ name }) => typeof name === 'string' && (
    version ? name === `${prefix}${version}${suffix}`
      : name.startsWith(prefix) && name.endsWith(suffix) && name.length > prefix.length + suffix.length
  ));
  return matches.length === 1 ? matches[0] : undefined;
}
