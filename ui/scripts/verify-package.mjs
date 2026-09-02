#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractFile, listPackage } from '@electron/asar';
import JSZip from 'jszip';
import { load as parseYaml } from 'js-yaml';
import {
  MANAGED_RUNTIME_VERSIONS,
  RUNTIME_ARTIFACTS,
} from '../src/runtime/runtime-manifest.mjs';
import { sha256File } from './download-runtimes.mjs';

const __filename = fileURLToPath(import.meta.url);
const uiRoot = path.resolve(path.dirname(__filename), '..');

function argument(name, fallback = '') {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) || fallback;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`);
  }
  return `${result.stdout || ''}${result.stderr || ''}`.trim();
}

function requireFile(filePath, label) {
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(`${label} is missing or empty: ${filePath}`);
  }
  return filePath;
}

function requireDirectory(dirPath, label) {
  if (!fs.statSync(dirPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`${label} directory is missing: ${dirPath}`);
  }
  return dirPath;
}

function digestFile(filePath, algorithm, encoding) {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const input = fs.createReadStream(filePath);
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest(encoding)));
  });
}

async function verifySharpChild(resourcesDir) {
  const requireFromApp = createRequire(path.join(
    resourcesDir,
    'app.asar',
    'dist',
    'runtime',
    'electron-direct.mjs',
  ));
  const sharp = requireFromApp('sharp');
  const output = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#2f855a' },
  }).png().toBuffer();
  if (!Buffer.isBuffer(output) || output.length < 20) throw new Error('Sharp returned an invalid PNG.');
  process.stdout.write(`sharp ${sharp.versions.sharp} ok\n`);
}

if (process.argv.includes('--sharp-child')) {
  const resourcesDir = argument('resources');
  await verifySharpChild(resourcesDir);
  process.exit(0);
}

function packagePaths(platform, arch) {
  const installersDir = path.join(uiRoot, 'dist', 'installers');
  if (platform === 'darwin') {
    const appDir = argument('app', path.join(installersDir, `mac-${arch}`, 'Moss.app'));
    return {
      appDir,
      resourcesDir: path.join(appDir, 'Contents', 'Resources'),
      executable: path.join(appDir, 'Contents', 'MacOS', 'Moss'),
      installersDir,
    };
  }
  if (platform === 'win32') {
    const appDir = argument('app', path.join(installersDir, 'win-unpacked'));
    return {
      appDir,
      resourcesDir: path.join(appDir, 'resources'),
      executable: path.join(appDir, 'Moss.exe'),
      installersDir,
    };
  }
  throw new Error(`Unsupported package platform: ${platform}`);
}

async function verifyConnectorCatalog(catalogPath) {
  const zip = await JSZip.loadAsync(await fsp.readFile(catalogPath));
  const manifestEntry = zip.file('.codebuddy-connector/connectors.json');
  if (!manifestEntry) throw new Error('Connector manifest is missing from the catalog.');
  const manifest = JSON.parse(await manifestEntry.async('text'));
  const connectors = Array.isArray(manifest.connectors) ? manifest.connectors : [];
  if (connectors.length === 0) throw new Error('Connector catalog is empty.');
  const missingPackages = connectors.filter((connector) => {
    const source = String(connector.source || connector.id || '').trim();
    return !source || !Object.values(zip.files).some((entry) => (
      !entry.dir && entry.name.startsWith(`connectors/${source}/`)
    ));
  });
  if (missingPackages.length > 0) {
    throw new Error(`Connector packages are missing: ${missingPackages.map((entry) => entry.id).join(', ')}`);
  }
  return connectors.length;
}

async function extractAndVerifyRuntimes(resourcesDir, platform, arch) {
  const target = `${platform}-${arch}`;
  const artifacts = RUNTIME_ARTIFACTS[target];
  const runtimesDir = path.join(resourcesDir, 'runtimes');
  const temporary = await fsp.mkdtemp(path.join(os.tmpdir(), 'moss-package-runtimes-'));
  try {
    for (const artifact of Object.values(artifacts)) {
      const archivePath = requireFile(path.join(runtimesDir, artifact.filename), artifact.filename);
      const actualHash = await sha256File(archivePath);
      if (actualHash !== artifact.sha256) {
        throw new Error(`Packaged checksum mismatch for ${artifact.filename}: ${actualHash}`);
      }
    }

    const nodeDir = path.join(temporary, 'node');
    await fsp.mkdir(nodeDir);
    if (platform === 'win32') {
      run('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath ${JSON.stringify(path.join(runtimesDir, artifacts.node.filename))} -DestinationPath ${JSON.stringify(nodeDir)} -Force`,
      ]);
    } else {
      run('tar', ['-xzf', path.join(runtimesDir, artifacts.node.filename), '-C', nodeDir]);
    }
    const nodeExecutable = platform === 'win32'
      ? path.join(nodeDir, `node-v${MANAGED_RUNTIME_VERSIONS.node}-win-x64`, 'node.exe')
      : path.join(nodeDir, `node-v${MANAGED_RUNTIME_VERSIONS.node}-darwin-${arch}`, 'bin', 'node');
    const nodeVersion = run(requireFile(nodeExecutable, 'managed Node.js'), ['--version']);
    if (nodeVersion !== `v${MANAGED_RUNTIME_VERSIONS.node}`) {
      throw new Error(`Managed Node.js version mismatch: ${nodeVersion}`);
    }

    const pythonDir = path.join(temporary, 'python');
    await fsp.mkdir(pythonDir);
    run('tar', ['-xzf', path.join(runtimesDir, artifacts.python.filename), '-C', pythonDir]);
    const pythonExecutable = platform === 'win32'
      ? path.join(pythonDir, 'python', 'python.exe')
      : path.join(pythonDir, 'python', 'bin', 'python3');
    const pythonVersion = run(requireFile(pythonExecutable, 'managed Python'), ['--version']);
    if (pythonVersion !== `Python ${MANAGED_RUNTIME_VERSIONS.python}`) {
      throw new Error(`Managed Python version mismatch: ${pythonVersion}`);
    }

    if (platform === 'win32') {
      const gitDir = path.join(temporary, 'PortableGit');
      run(path.join(runtimesDir, artifacts.git.filename), ['-y', `-o${gitDir}`]);
      const gitVersion = run(requireFile(path.join(gitDir, 'cmd', 'git.exe'), 'managed Git'), ['--version']);
      run(requireFile(path.join(gitDir, 'bin', 'bash.exe'), 'managed Git Bash'), ['--version']);
      if (!gitVersion.includes('2.47.1.windows.1')) {
        throw new Error(`Managed Git version mismatch: ${gitVersion}`);
      }
    }

    return { nodeVersion, pythonVersion };
  } finally {
    await fsp.rm(temporary, { recursive: true, force: true });
  }
}

function commandResult(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

export function assertUnsignedPe(filePath) {
  const file = fs.openSync(filePath, 'r');
  try {
    const dosHeader = Buffer.alloc(64);
    if (fs.readSync(file, dosHeader, 0, dosHeader.length, 0) !== dosHeader.length
      || dosHeader.readUInt16LE(0) !== 0x5a4d) {
      throw new Error(`Invalid PE DOS header: ${filePath}`);
    }
    const peOffset = dosHeader.readUInt32LE(0x3c);
    const coffHeader = Buffer.alloc(24);
    if (fs.readSync(file, coffHeader, 0, coffHeader.length, peOffset) !== coffHeader.length
      || coffHeader.readUInt32LE(0) !== 0x00004550) {
      throw new Error(`Invalid PE header: ${filePath}`);
    }
    const optionalHeaderSize = coffHeader.readUInt16LE(20);
    const optionalHeader = Buffer.alloc(optionalHeaderSize);
    if (fs.readSync(file, optionalHeader, 0, optionalHeader.length, peOffset + 24) !== optionalHeader.length) {
      throw new Error(`Truncated PE optional header: ${filePath}`);
    }
    const magic = optionalHeader.readUInt16LE(0);
    const dataDirectoryOffset = magic === 0x20b ? 112 : magic === 0x10b ? 96 : -1;
    const directoryCountOffset = magic === 0x20b ? 108 : magic === 0x10b ? 92 : -1;
    if (dataDirectoryOffset < 0 || optionalHeader.length < dataDirectoryOffset + 40) {
      throw new Error(`Unsupported PE optional header: ${filePath}`);
    }
    if (optionalHeader.readUInt32LE(directoryCountOffset) <= 4) {
      throw new Error(`PE optional header has no certificate table entry: ${filePath}`);
    }
    const certificateTableOffset = optionalHeader.readUInt32LE(dataDirectoryOffset + 32);
    const certificateTableSize = optionalHeader.readUInt32LE(dataDirectoryOffset + 36);
    if (certificateTableOffset !== 0 || certificateTableSize !== 0) {
      throw new Error(`Windows executable is unexpectedly Authenticode signed: ${filePath}`);
    }
  } finally {
    fs.closeSync(file);
  }
}

function verifyUnsignedPackage(platform, paths, installerFiles) {
  if (platform === 'darwin') {
    const details = commandResult('codesign', ['-dv', '--verbose=4', paths.appDir]);
    const output = `${details.stdout || ''}${details.stderr || ''}`;
    if (/^Authority=/m.test(output) || /TeamIdentifier=(?!not set)/.test(output)) {
      throw new Error(`macOS app unexpectedly contains a distribution signature:\n${output.trim()}`);
    }
    for (const name of installerFiles.filter((entry) => entry.endsWith('.dmg'))) {
      const result = commandResult('codesign', ['-dv', path.join(paths.installersDir, name)]);
      const output = `${result.stdout || ''}${result.stderr || ''}`;
      if (!output.includes('code object is not signed at all')) {
        throw new Error(`DMG is unexpectedly code signed or could not be inspected: ${name}\n${output.trim()}`);
      }
    }
    return;
  }

  const executables = [
    paths.executable,
    ...installerFiles
      .filter((name) => name.toLowerCase().endsWith('.exe'))
      .map((name) => path.join(paths.installersDir, name)),
  ];
  for (const executable of executables) assertUnsignedPe(executable);
}

async function verifyUpdateMetadata(platform, paths, installerFiles, appVersion) {
  const manifestName = platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml';
  const manifestPath = requireFile(path.join(paths.installersDir, manifestName), manifestName);
  const manifest = parseYaml(await fsp.readFile(manifestPath, 'utf8'));
  if (!manifest || typeof manifest !== 'object' || manifest.version !== appVersion) {
    throw new Error(`${manifestName} has an invalid version.`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error(`${manifestName} does not list any update artifacts.`);
  }

  const listedNames = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.url !== 'string' || typeof entry.sha512 !== 'string'
      || !Number.isSafeInteger(entry.size) || entry.size <= 0) {
      throw new Error(`${manifestName} contains an invalid file entry.`);
    }
    const artifactName = decodeURIComponent(path.basename(entry.url));
    const artifactPath = requireFile(path.join(paths.installersDir, artifactName), `${manifestName} artifact`);
    listedNames.add(artifactName);
    if (fs.statSync(artifactPath).size !== entry.size) {
      throw new Error(`${manifestName} size mismatch for ${artifactName}.`);
    }
    const actualSha512 = await digestFile(artifactPath, 'sha512', 'base64');
    if (actualSha512 !== entry.sha512) {
      throw new Error(`${manifestName} SHA-512 mismatch for ${artifactName}.`);
    }
    requireFile(`${artifactPath}.blockmap`, `${artifactName} blockmap`);
  }

  if (typeof manifest.path !== 'string' || !listedNames.has(decodeURIComponent(path.basename(manifest.path)))) {
    throw new Error(`${manifestName} primary update path is not present in its file list.`);
  }
  if (platform === 'darwin') {
    if (![...listedNames].some((name) => name.endsWith('.dmg'))
      || ![...listedNames].some((name) => name.endsWith('.zip'))) {
      throw new Error('latest-mac.yml must reference both DMG and ZIP artifacts.');
    }
  } else {
    const setupFiles = installerFiles.filter((name) => /^Moss-Setup-.+-x64\.exe$/i.test(name));
    const portableFiles = installerFiles.filter((name) => /^Moss-Portable-.+-x64\.exe$/i.test(name));
    if (setupFiles.length !== 1 || portableFiles.length !== 1 || !listedNames.has(setupFiles[0])) {
      throw new Error('Windows output must contain one NSIS installer, one portable executable, and update metadata for the installer.');
    }
  }
}

async function main() {
  const platform = argument('platform', process.platform);
  const arch = argument('arch', process.arch);
  const target = `${platform}-${arch}`;
  if (!RUNTIME_ARTIFACTS[target]) throw new Error(`Unsupported package target: ${target}`);
  const paths = packagePaths(platform, arch);
  requireDirectory(paths.appDir, 'packaged app');
  requireFile(paths.executable, 'packaged executable');
  const asarPath = requireFile(path.join(paths.resourcesDir, 'app.asar'), 'app.asar');
  const asarEntries = new Set(listPackage(asarPath));
  for (const entry of [
    '/dist/runtime/electron-direct.mjs',
    '/src/main.mjs',
    '/src/preload.mjs',
    '/dist/renderer/index.html',
    '/dist/renderer/build/icon.png',
  ]) {
    if (!asarEntries.has(entry)) throw new Error(`app.asar is missing ${entry}`);
  }

  const appPackage = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'));
  const rootPackage = JSON.parse(await fsp.readFile(path.resolve(uiRoot, '..', 'package.json'), 'utf8'));
  if (appPackage.version !== rootPackage.version) {
    throw new Error(`Desktop/root version mismatch: ${appPackage.version} != ${rootPackage.version}`);
  }
  const updateSource = extractFile(asarPath, 'src/update-ipc.mjs').toString('utf8');
  if (!updateSource.includes("const DEFAULT_REPO = 'baiguidong/moss';")) {
    throw new Error('Packaged manual updater does not target baiguidong/moss.');
  }
  const updateConfig = await fsp.readFile(
    requireFile(path.join(paths.resourcesDir, 'app-update.yml'), 'app update configuration'),
    'utf8',
  );
  if (!/^owner: baiguidong$/m.test(updateConfig) || !/^repo: moss$/m.test(updateConfig)) {
    throw new Error('Packaged auto updater does not target baiguidong/moss.');
  }
  if (/^publisherName:/m.test(updateConfig)) {
    throw new Error('Unsigned Windows updates must not declare a publisherName.');
  }

  requireFile(path.join(paths.resourcesDir, 'adapters', 'feishu.mjs'), 'Feishu adapter');
  requireFile(path.join(paths.resourcesDir, 'packages', 'app-sdk', 'src', 'index.mjs'), 'App SDK');
  requireFile(path.join(paths.resourcesDir, 'packages', 'app-runtime', 'src', 'index.mjs'), 'App runtime');
  requireFile(path.join(paths.resourcesDir, 'shared', 'security', 'credential-crypto.mjs'), 'credential crypto');
  requireFile(path.join(paths.resourcesDir, 'skills', 'local-kb', 'SKILL.md'), 'local knowledge-base skill');
  requireFile(path.join(paths.resourcesDir, 'skills', 'convert-skill-to-app', 'SKILL.md'), 'skill-to-app skill');
  requireFile(path.join(paths.resourcesDir, 'assistants', 'app-builder', 'assistant.md'), 'app-builder assistant');
  requireFile(path.join(paths.resourcesDir, 'assistants', 'app-builder', '_moss_meta.json'), 'app-builder metadata');
  requireFile(path.join(paths.resourcesDir, 'apps', 'README.md'), 'bundled apps manifest');
  requireFile(path.join(paths.resourcesDir, 'connectors', 'cloud-auth-providers.json'), 'connector cloud auth configuration');
  requireFile(path.join(paths.resourcesDir, 'connectors', 'connector-mcp-overrides.json'), 'connector MCP overrides');

  const catalogPath = requireFile(
    path.join(paths.resourcesDir, 'connectors', 'workbuddy-connectors-config.zip'),
    'connector catalog',
  );
  const connectorCount = await verifyConnectorCatalog(catalogPath);
  const ripgrepPath = requireFile(
    path.join(paths.resourcesDir, 'ripgrep', `${arch}-${platform}`, platform === 'win32' ? 'rg.exe' : 'rg'),
    'ripgrep',
  );
  const ripgrepVersion = run(ripgrepPath, ['--version']).split(/\r?\n/, 1)[0];

  requireFile(path.join(paths.resourcesDir, 'node_modules', 'sharp', 'package.json'), 'sharp package');
  const sharpPlatformDir = requireDirectory(path.join(paths.resourcesDir, 'node_modules', '@img'), 'sharp platform packages');
  requireFile(path.join(sharpPlatformDir, `sharp-${target}`, 'package.json'), 'sharp native package');
  const unexpectedSharpPackages = fs.readdirSync(sharpPlatformDir)
    .filter((name) => name.startsWith('sharp-'))
    .filter((name) => name !== `sharp-${target}` && name !== `sharp-libvips-${target}`);
  if (unexpectedSharpPackages.length > 0) {
    throw new Error(`Packaged foreign Sharp binaries: ${unexpectedSharpPackages.join(', ')}`);
  }
  const sharpOutput = run(paths.executable, [__filename, '--sharp-child', `--resources=${paths.resourcesDir}`], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  const runtimeVersions = await extractAndVerifyRuntimes(paths.resourcesDir, platform, arch);

  const installerFiles = fs.readdirSync(paths.installersDir)
    .filter((name) => fs.statSync(path.join(paths.installersDir, name)).isFile())
    .filter((name) => !name.startsWith('builder-'));
  if (platform === 'darwin' && (!installerFiles.some((name) => name.endsWith('.dmg')) || !installerFiles.some((name) => name.endsWith('.zip')))) {
    throw new Error('Expected both DMG and ZIP macOS artifacts.');
  }
  if (platform === 'darwin') {
    for (const name of installerFiles.filter((entry) => entry.endsWith('.dmg'))) {
      run('hdiutil', ['verify', path.join(paths.installersDir, name)]);
    }
    for (const name of installerFiles.filter((entry) => entry.endsWith('.zip'))) {
      run('unzip', ['-tq', path.join(paths.installersDir, name)]);
    }
  }
  if (platform === 'win32' && installerFiles.filter((name) => name.endsWith('.exe')).length < 2) {
    throw new Error('Expected both NSIS and portable Windows artifacts.');
  }
  await verifyUpdateMetadata(platform, paths, installerFiles, appPackage.version);
  verifyUnsignedPackage(platform, paths, installerFiles);

  console.log(JSON.stringify({
    ok: true,
    target,
    appVersion: appPackage.version,
    connectorCount,
    ripgrepVersion,
    sharp: sharpOutput,
    ...runtimeVersions,
    unsigned: true,
    installerFiles,
  }, null, 2));
}

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
  });
}
