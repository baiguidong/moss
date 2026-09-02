import { describe, expect, test } from 'bun:test';
import {
  pickRecommendedReleaseAsset,
  supportsAutomaticUpdates,
  UNSIGNED_AUTO_UPDATE_MESSAGE,
} from '../src/update-capabilities.mjs';

describe('unsigned update capabilities', () => {
  test('uses manual downloads on macOS and automatic install only on Windows', () => {
    expect(supportsAutomaticUpdates('darwin')).toBe(false);
    expect(supportsAutomaticUpdates('linux')).toBe(false);
    expect(supportsAutomaticUpdates('win32')).toBe(true);
    expect(UNSIGNED_AUTO_UPDATE_MESSAGE).toContain('unsigned builds');
  });

  test('prefers an installer over portable Windows builds', () => {
    const portable = { name: 'Moss 2.1.88.exe' };
    const installer = { name: 'Moss Setup 2.1.88.exe' };
    expect(pickRecommendedReleaseAsset([portable, installer], 'win32', 'x64')).toBe(installer);
  });

  test('prefers DMG for manual macOS updates', () => {
    const zip = { name: 'Moss-2.1.88-arm64-mac.zip' };
    const dmg = { name: 'Moss-2.1.88-arm64.dmg' };
    expect(pickRecommendedReleaseAsset([zip, dmg], 'darwin', 'arm64')).toBe(dmg);
  });
});
