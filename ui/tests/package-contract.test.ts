import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTargets, sha256File } from '../scripts/download-runtimes.mjs';
import {
  MANAGED_RUNTIME_VERSIONS,
  RUNTIME_ARTIFACTS,
  SUPPORTED_RUNTIME_TARGETS,
} from '../src/runtime/runtime-manifest.mjs';
import { targetArch } from '../scripts/after-pack.mjs';
import { assertUnsignedPe } from '../scripts/verify-package.mjs';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(uiRoot, '..');
const desktopPackage = JSON.parse(readFileSync(path.join(uiRoot, 'package.json'), 'utf8'));
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

describe('desktop package contract', () => {
  test('publishes and updates from the current repository', () => {
    expect(desktopPackage.build.publish).toEqual({
      provider: 'github',
      owner: 'baiguidong',
      repo: 'moss',
    });
    const updateSource = readFileSync(path.join(uiRoot, 'src', 'update-ipc.mjs'), 'utf8');
    expect(updateSource).toContain("const DEFAULT_REPO = 'baiguidong/moss';");
    const releaseSource = readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    expect(releaseSource).toContain('--repo "$GITHUB_REPOSITORY"');
    expect(`${JSON.stringify(desktopPackage)}\n${updateSource}\n${releaseSource}`)
      .not.toMatch(/(?:sudoprivacy|moss-ai)\/moss/);
  });

  test('keeps desktop and agent versions aligned', () => {
    expect(desktopPackage.version).toBe(rootPackage.version);
    const buildSource = readFileSync(path.join(repoRoot, 'scripts', 'build.js'), 'utf8');
    expect(buildSource).not.toContain('MACRO.VERSION="2.1.88"');
    expect(buildSource).toContain('JSON.stringify(buildVersion)');
  });

  test('packages native image processing and physical ripgrep resources', () => {
    expect(desktopPackage.build.files).toContain('src/**/*');
    expect(desktopPackage.build.files).toContain('dist/runtime/**/*');
    const buildSource = readFileSync(path.join(repoRoot, 'scripts', 'build.js'), 'utf8');
    const copySource = readFileSync(path.join(uiRoot, 'scripts', 'copy-build-resources.mjs'), 'utf8');
    expect(buildSource).toContain("--outfile=ui/electron-direct.mjs");
    expect(buildSource).not.toContain('bin/cli-node.js');
    expect(copySource).toContain("'dist', 'runtime', 'electron-direct.mjs'");
    const rootModules = desktopPackage.build.extraResources.find(
      (entry: { from?: string }) => entry.from === '../node_modules',
    );
    expect(rootModules.filter).toContain('sharp/**/*');
    expect(rootModules.filter).toContain('@img/**/*');
    expect(desktopPackage.build.extraResources.some(
      (entry: { from?: string; to?: string }) => entry.from === '../vendor/ripgrep' && entry.to === 'ripgrep',
    )).toBe(true);
    expect(desktopPackage.build.afterPack).toBe('scripts/after-pack.mjs');

    const macRipgrep = path.join(repoRoot, 'vendor', 'ripgrep', 'arm64-darwin', 'rg');
    const winRipgrep = path.join(repoRoot, 'vendor', 'ripgrep', 'x64-win32', 'rg.exe');
    expect(statSync(macRipgrep).size).toBeGreaterThan(1_000_000);
    expect(statSync(winRipgrep).size).toBeGreaterThan(1_000_000);
  });

  test('keeps desktop signing and notarization disabled', () => {
    expect(desktopPackage.build.mac.identity).toBeNull();
    expect(desktopPackage.build.mac.hardenedRuntime).toBe(false);
    expect(desktopPackage.build.mac.notarize).toBe(false);
    expect(desktopPackage.build.dmg.sign).toBe(false);
    expect(desktopPackage.build.win.cscLink).toBe('');
    expect(desktopPackage.build.win.verifyUpdateCodeSignature).toBe(false);
    expect(desktopPackage.build.nsis.artifactName).toBe('${productName}-Setup-${version}-${arch}.${ext}');
    expect(desktopPackage.build.portable.artifactName).toBe('${productName}-Portable-${version}-${arch}.${ext}');
    expect(desktopPackage.scripts['release:mac']).not.toContain('--require-signature');
    expect(desktopPackage.scripts['release:win']).not.toContain('--require-signature');
    expect(desktopPackage.scripts['release:mac']).toStartWith('node scripts/clean-installers.mjs');
    expect(desktopPackage.scripts['release:win']).toStartWith('node scripts/clean-installers.mjs');
    expect(desktopPackage.scripts['dist:win']).toContain('electron-builder --win --x64');
    const verifierSource = readFileSync(path.join(uiRoot, 'scripts', 'verify-package.mjs'), 'utf8');
    expect(verifierSource).toContain('verifyUnsignedPackage(platform, paths, installerFiles)');
    expect(verifierSource).toContain('certificateTableOffset !== 0 || certificateTableSize !== 0');
    expect(verifierSource).toContain('macOS app unexpectedly contains a distribution signature');
    expect(verifierSource).toContain("path.join(paths.resourcesDir, 'apps', 'README.md')");
    expect(verifierSource).toContain("'connectors', 'cloud-auth-providers.json'");
    expect(verifierSource).toContain("'connectors', 'connector-mcp-overrides.json'");
    const workflowSources = [
      readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8'),
      readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8'),
    ].join('\n');
    expect(workflowSources).toContain("CSC_IDENTITY_AUTO_DISCOVERY: 'false'");
    expect(workflowSources).not.toMatch(/APPLE_(?:ID|TEAM|API)|CSC_LINK|WIN_CSC_LINK/);
  });

  test('rejects a Windows certificate table while accepting an unsigned PE', () => {
    const temporary = mkdtempSync(path.join(os.tmpdir(), 'moss-pe-test-'));
    const createPe = (certificateOffset: number, certificateSize: number) => {
      const data = Buffer.alloc(512);
      data.writeUInt16LE(0x5a4d, 0);
      data.writeUInt32LE(0x80, 0x3c);
      data.writeUInt32LE(0x00004550, 0x80);
      data.writeUInt16LE(240, 0x80 + 20);
      const optionalHeader = 0x80 + 24;
      data.writeUInt16LE(0x20b, optionalHeader);
      data.writeUInt32LE(16, optionalHeader + 108);
      data.writeUInt32LE(certificateOffset, optionalHeader + 112 + 32);
      data.writeUInt32LE(certificateSize, optionalHeader + 112 + 36);
      return data;
    };
    const unsignedPath = path.join(temporary, 'unsigned.exe');
    const signedPath = path.join(temporary, 'signed.exe');
    try {
      writeFileSync(unsignedPath, createPe(0, 0));
      writeFileSync(signedPath, createPe(384, 128));
      expect(() => assertUnsignedPe(unsignedPath)).not.toThrow();
      expect(() => assertUnsignedPe(signedPath)).toThrow('unexpectedly Authenticode signed');
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  test('installs adapter dependencies in every clean CI build that compiles adapters', () => {
    const ciSource = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const releaseSource = readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    const serverCiJob = ciSource.split('  package-server-linux-amd64:')[1] || '';
    const serverReleaseJob = releaseSource.split('  build-server-linux-amd64:')[1]
      ?.split('\n  publish-release:')[0] || '';
    expect(ciSource.match(/bun install --frozen-lockfile --cwd adapters/g)?.length).toBe(4);
    expect(serverCiJob).toContain('needs: quality');
    expect(serverCiJob).toContain('bun install --frozen-lockfile --cwd adapters');
    expect(serverReleaseJob).toContain('bun install --frozen-lockfile --cwd adapters');
  });
});

describe('managed runtime contract', () => {
  test('uses the requested package architecture instead of the host architecture', () => {
    expect(targetArch({ arch: 1 })).toBe('x64');
    expect(targetArch({ arch: 3 })).toBe('arm64');
    expect(targetArch({ arch: 'x64' })).toBe('x64');
    expect(() => targetArch({ arch: 99 })).toThrow('Unknown electron-builder architecture');
  });

  test('supports only release platforms with complete artifact sets', () => {
    expect(SUPPORTED_RUNTIME_TARGETS).toEqual(['darwin-arm64', 'win32-x64']);
    expect(parseTargets(['--all'], 'linux', 'x64')).toEqual(SUPPORTED_RUNTIME_TARGETS);
    expect(() => parseTargets(['--target=darwin-x64'])).toThrow('Unsupported runtime target');
    expect(Object.keys(RUNTIME_ARTIFACTS['darwin-arm64'])).toEqual(['node', 'python']);
    expect(Object.keys(RUNTIME_ARTIFACTS['win32-x64'])).toEqual(['node', 'python', 'git']);
  });

  test('pins full runtime versions and valid SHA-256 digests', () => {
    expect(MANAGED_RUNTIME_VERSIONS).toEqual({
      node: '22.22.2',
      python: '3.13.15',
      git: '2.47.1.windows.1',
    });
    for (const artifacts of Object.values(RUNTIME_ARTIFACTS)) {
      for (const artifact of Object.values(artifacts)) {
        expect(artifact.url).toMatch(/^https:\/\//);
        expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    const downloaderSource = readFileSync(path.join(uiRoot, 'scripts', 'download-runtimes.mjs'), 'utf8');
    expect(downloaderSource).toContain('|| 600_000');
  });

  test('ships checksum-valid macOS runtime archives', async () => {
    for (const artifact of Object.values(RUNTIME_ARTIFACTS['darwin-arm64'])) {
      const archivePath = path.join(uiRoot, 'resources', 'runtimes', artifact.filename);
      expect(await sha256File(archivePath)).toBe(artifact.sha256);
    }
  });
});
