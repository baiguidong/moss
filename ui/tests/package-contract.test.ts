import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
import { assertUnsignedPe, indexAsarEntries, normalizeAsarEntry } from '../scripts/verify-package.mjs';

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
    const rendererBuildSource = readFileSync(path.join(uiRoot, 'scripts', 'build-renderer.mjs'), 'utf8');
    expect(buildSource).toContain("--outfile=ui/electron-direct.mjs");
    expect(buildSource).not.toContain('bin/cli-node.js');
    expect(copySource).toContain("'dist', 'runtime', 'electron-direct.mjs'");
    expect(desktopPackage.scripts['build:renderer']).toBe('node scripts/build-renderer.mjs');
    expect(rendererBuildSource).toContain("'--max-old-space-size=6144'");
    const rootModules = desktopPackage.build.extraResources.find(
      (entry: { from?: string }) => entry.from === '../node_modules',
    );
    expect(rootModules.filter).toContain('sharp/**/*');
    expect(rootModules.filter).toContain('@img/**/*');
    expect(desktopPackage.build.extraResources.some(
      (entry: { from?: string; to?: string }) => entry.from === '../vendor/ripgrep' && entry.to === 'ripgrep',
    )).toBe(true);
    expect(desktopPackage.build.extraResources.some(
      (entry: { from?: string; to?: string }) => entry.from === 'resources/licenses' && entry.to === 'licenses',
    )).toBe(true);
    expect(desktopPackage.build.afterPack).toBe('scripts/after-pack.mjs');
    expect(desktopPackage.dependencies['@open-file-viewer/core']).toBe('0.1.45');
    expect(desktopPackage.dependencies.leaflet).toBe('1.9.4');
    expect(desktopPackage.build.files).toContain('dist/renderer/**/*');

    const macRipgrep = path.join(repoRoot, 'vendor', 'ripgrep', 'arm64-darwin', 'rg');
    const winRipgrep = path.join(repoRoot, 'vendor', 'ripgrep', 'x64-win32', 'rg.exe');
    expect(statSync(macRipgrep).size).toBeGreaterThan(1_000_000);
    expect(statSync(winRipgrep).size).toBeGreaterThan(1_000_000);
  });

  test('runs Library agent tools in-process without a bundled MCP server', () => {
    const mainSource = readFileSync(path.join(uiRoot, 'src', 'main.mjs'), 'utf8');
    const agentRuntimeSource = readFileSync(path.join(repoRoot, 'src', 'electron-direct.ts'), 'utf8');
    const libraryToolsSource = readFileSync(
      path.join(repoRoot, 'src', 'tools', 'LibraryTool', 'LibraryTools.ts'),
      'utf8',
    );
    const verifierSource = readFileSync(path.join(uiRoot, 'scripts', 'verify-package.mjs'), 'utf8');

    expect(mainSource).toContain("libraryEnabled: Boolean(desktopSettings.library?.enabled === true && libraryService)");
    expect(mainSource).toContain('handleLibraryAgentToolEvent');
    expect(libraryToolsSource).toContain('LibraryWriteTool');
    expect(libraryToolsSource).toContain('user has confirmed which files should be added');
    const directoryDraftSource = mainSource.slice(
      mainSource.indexOf('function buildLibraryDirectoryImportDraft'),
      mainSource.indexOf('function remoteSessionTimestamp'),
    );
    expect(directoryDraftSource).toContain('draftPrompt: buildLibraryDirectoryImportDraft');
    expect(directoryDraftSource).not.toContain('createSessionRecord');
    expect(directoryDraftSource).not.toContain('runSessionPrompt');
    expect(directoryDraftSource).not.toContain("sessionKind: 'library-import'");
    expect(directoryDraftSource).toContain('请按以下 Markdown 结构回复');
    expect(directoryDraftSource).not.toContain('`Glob`');
    expect(directoryDraftSource).not.toContain('`Bash`');
    expect(mainSource).not.toContain('LIBRARY_DIRECTORY_AGENT_PROMPT_PATH');
    expect(mainSource).not.toContain("sessionKind === 'library-import'");
    expect(mainSource).not.toContain('libraryDirectorySystemPrompt');
    expect(mainSource).not.toContain('librarySystemPrompt');
    expect(agentRuntimeSource).toContain("import { LibraryTools } from './tools/LibraryTool/LibraryTools.js'");
    expect(agentRuntimeSource).toContain('applyChatToolFilter(assembled)');
    expect(agentRuntimeSource).toContain('Chat 模式不能创建或控制 worker');
    expect(mainSource).not.toContain('MOSS_LIBRARY_DB_PATH');
    expect(mainSource).not.toContain('MOSS_LIBRARY_CORE');
    expect(verifierSource).not.toContain('library_mcp_server.mjs');
    expect(verifierSource).not.toContain("skills', 'local-kb'");
    expect(mainSource).toContain("RETIRED_BUNDLED_SKILL_NAMES = Object.freeze(['local-kb'])");
    expect(existsSync(path.join(repoRoot, 'skills', 'local-kb'))).toBe(false);
    expect(existsSync(path.join(uiRoot, 'resources', 'library', 'library_mcp_server.mjs'))).toBe(false);
    expect(existsSync(path.join(uiRoot, 'resources', 'library', 'prompts', 'personal-directory-import-agent.md'))).toBe(false);
    expect(verifierSource).not.toContain('personal-directory-import-agent.md');
  });

  test('exposes only chat and boss as desktop conversation modes', () => {
    const appSource = readFileSync(path.join(uiRoot, 'src', 'renderer-react', 'App.tsx'), 'utf8');
    const chatSource = readFileSync(
      path.join(uiRoot, 'src', 'renderer-react', 'components', 'chat-area.tsx'),
      'utf8',
    );
    const rendererTypes = readFileSync(
      path.join(uiRoot, 'src', 'renderer-react', 'types.d.ts'),
      'utf8',
    );

    expect(appSource).toContain("type ComposerIntent = 'chat' | 'boss'");
    expect(chatSource).toContain('type ComposerIntent = "chat" | "boss"');
    expect(chatSource).toContain('id: "boss"');
    expect(chatSource).not.toContain('id: "plan"');
    expect(chatSource).not.toContain('id: "coordinator"');
    expect(rendererTypes).toContain("mode?: 'chat' | 'boss'");
  });

  test('keeps the persisted Chat or Boss selection authoritative when resuming', () => {
    const mainSource = readFileSync(path.join(uiRoot, 'src', 'main.mjs'), 'utf8');
    const agentRuntimeSource = readFileSync(path.join(repoRoot, 'src', 'electron-direct.ts'), 'utf8');

    expect(agentRuntimeSource).toContain('sessionOptions.coordinatorMode\n      ?? (prepared.mode');
    expect(mainSource).toContain('coordinatorMode: desiredCoordinatorMode');
    expect(mainSource).toContain('sessionRecord.isCoordinatorMode = desiredCoordinatorMode');
    expect(mainSource).not.toContain('sessionRecord.isCoordinatorMode = Boolean(sessionRecord.projectId)\n      || metadata.mode');
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
    expect(verifierSource).toContain("path.join(paths.resourcesDir, 'apps', 'moss.feishu', 'app-signature.json')");
    expect(verifierSource).toContain("'connectors', 'cloud-auth-providers.json'");
    expect(verifierSource).toContain("'connectors', 'connector-mcp-overrides.json'");
    expect(verifierSource).toContain("'connectors', 'connector-cli-overrides.json'");
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

  test('normalizes ASAR entry paths on Windows and POSIX', () => {
    expect(normalizeAsarEntry('\\dist\\runtime\\electron-direct.mjs'))
      .toBe('/dist/runtime/electron-direct.mjs');
    expect(normalizeAsarEntry('/src/main.mjs')).toBe('/src/main.mjs');

    const entries = indexAsarEntries([
      '\\dist\\renderer\\assets\\3MFLoader.js',
      '/src/main.mjs',
    ]);
    expect(entries.get('/dist/renderer/assets/3MFLoader.js'))
      .toBe('dist\\renderer\\assets\\3MFLoader.js');
    expect(entries.get('/src/main.mjs')).toBe('src/main.mjs');
  });

  test('prepares bundled Apps from immutable release artifacts instead of App source', () => {
    const ciSource = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
    const releaseSource = readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
    const lock = JSON.parse(readFileSync(path.join(repoRoot, 'config', 'bundled-apps.lock.json'), 'utf8'));
    const bundledAppsSource = readFileSync(path.join(repoRoot, 'scripts', 'bundled-apps.mjs'), 'utf8');
    const desktopBuild = readFileSync(path.join(repoRoot, 'ui', 'scripts', 'build-adapters.mjs'), 'utf8');
    const serverBuild = readFileSync(path.join(repoRoot, 'scripts', 'build.js'), 'utf8');
    const trustedPublishers = JSON.parse(readFileSync(
      path.join(uiRoot, 'resources', 'app-market', 'trusted-publishers.json'),
      'utf8',
    ));
    expect(lock).toMatchObject({
      schemaVersion: 1,
      apps: [{
        id: 'moss.feishu',
        version: '0.1.2',
        url: 'https://github.com/baiguidong/moss-apps/releases/download/moss.feishu-v0.1.2/moss.feishu-0.1.2.zip',
        publisherId: 'moss',
        keyId: 'release-1',
      }],
    });
    expect(lock.apps[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(trustedPublishers.publishers.moss.keys['release-1']).toBe('publishers/moss/release-1.pem');
    expect(existsSync(path.join(uiRoot, 'resources', 'app-market', 'publishers', 'moss', 'release-1.pem'))).toBe(true);
    expect(bundledAppsSource).toContain('requireTrustedPublisher: true');
    expect(desktopBuild).toContain('prepareBundledApps');
    expect(serverBuild).toContain('prepareBundledApps');
    expect(`${ciSource}\n${releaseSource}`).not.toContain('apps/feishu');
    expect(existsSync(path.join(repoRoot, 'apps', 'feishu'))).toBe(false);
    expect(existsSync(path.join(repoRoot, 'adapters', 'feishu', 'index.ts'))).toBe(false);
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

  test('removes obsolete managed runtime versions after verifying the current version', () => {
    const runtimeSource = readFileSync(path.join(uiRoot, 'src', 'runtime', 'managed-runtimes.mjs'), 'utf8');
    expect(runtimeSource).toContain('async function pruneObsoleteRuntimeVersions');
    expect(runtimeSource).toContain("await pruneObsoleteRuntimeVersions('node', version)");
    expect(runtimeSource).toContain("await pruneObsoleteRuntimeVersions('python', version)");
    expect(runtimeSource).toContain("entry.name === currentVersion");
  });

  test('ships checksum-valid macOS runtime archives', async () => {
    for (const artifact of Object.values(RUNTIME_ARTIFACTS['darwin-arm64'])) {
      const archivePath = path.join(uiRoot, 'resources', 'runtimes', artifact.filename);
      expect(await sha256File(archivePath)).toBe(artifact.sha256);
    }
  });
});
