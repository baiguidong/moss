import { describe, expect, test } from 'bun:test';
import { getUpdateCapabilities, pickRecommendedReleaseAsset, supportsAutomaticUpdates } from '../src/update-capabilities.mjs';

describe('update package compatibility', () => {
  test('macOS and Portable never use the native installer', () => {
    expect(supportsAutomaticUpdates('darwin')).toBe(false);
    expect(supportsAutomaticUpdates('win32', true)).toBe(false);
    expect(supportsAutomaticUpdates('win32', false)).toBe(true);
    expect(getUpdateCapabilities({ platform: 'win32', arch: 'x64', isPackaged: true }).mode).toBe('unsupported');
    expect(getUpdateCapabilities({ platform: 'win32', arch: 'x64', isPackaged: true, hasNsisMarker: true }).mode).toBe('nativeUpdater');
    expect(getUpdateCapabilities({ platform: 'win32', arch: 'x64', isPackaged: true, portable: true, hasNsisMarker: true }).mode).toBe('manual');
    expect(getUpdateCapabilities({ platform: 'darwin', arch: 'arm64', isPackaged: false }).mode).toBe('development');
  });
  test('strictly selects the architecture and package format', () => {
    const dmg = { name: 'Moss-1.2.3-arm64.dmg' };
    const setup = { name: 'Moss-Setup-1.2.3-x64.exe' };
    const portable = { name: 'Moss-Portable-1.2.3-x64.exe' };
    const assets = [portable, dmg, setup, { name: 'Moss-1.2.3-arm64-mac.zip' }];
    expect(pickRecommendedReleaseAsset(assets, 'darwin', 'arm64', 'dmg', '1.2.3')).toBe(dmg);
    expect(pickRecommendedReleaseAsset(assets, 'win32', 'x64', 'nsis', '1.2.3')).toBe(setup);
    expect(pickRecommendedReleaseAsset(assets, 'win32', 'x64', 'portable', '1.2.3')).toBe(portable);
    for (const [platform, arch] of [['darwin', 'x64'], ['win32', 'arm64'], ['linux', 'x64'], ['win32', 'ia32']]) {
      expect(pickRecommendedReleaseAsset(assets, platform, arch)).toBeUndefined();
    }
    expect(pickRecommendedReleaseAsset([{ name: 'Moss Setup 1.2.3.exe' }], 'win32', 'x64')).toBeUndefined();
    expect(pickRecommendedReleaseAsset(assets, 'darwin', 'arm64', 'dmg', '1.2.4')).toBeUndefined();
    expect(pickRecommendedReleaseAsset([dmg, dmg], 'darwin', 'arm64')).toBeUndefined();
  });
});
