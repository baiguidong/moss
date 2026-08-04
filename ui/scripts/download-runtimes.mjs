#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = process.env.MOSS_NODE_VERSION || '22.22.2';
const PYTHON_SERIES = process.env.MOSS_PYTHON_SERIES || '3.13';
const GIT_FOR_WINDOWS_TAG = process.env.MOSS_GIT_FOR_WINDOWS_TAG || 'v2.47.1.windows.1';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UI_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(UI_ROOT, 'resources', 'runtimes');

const targets = parseTargets(process.argv.slice(2));

function parseTargets(args) {
  if (args.includes('--all')) {
    return [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'win32', arch: 'x64' },
    ];
  }

  const targetArg = args.find((arg) => arg.startsWith('--target='));
  if (targetArg) {
    const [, value] = targetArg.split('=');
    const [platform, arch] = value.split('-');
    if (!platform || !arch) throw new Error(`Invalid --target value: ${value}`);
    return [{ platform, arch }];
  }

  const platformArg = args.find((arg) => arg.startsWith('--platform='));
  const archArg = args.find((arg) => arg.startsWith('--arch='));
  return [{
    platform: platformArg ? platformArg.split('=')[1] : process.platform,
    arch: archArg ? archArg.split('=')[1] : process.arch,
  }];
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function nodePlatform(platform) {
  if (platform === 'win32') return 'win';
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  throw new Error(`Unsupported Node.js platform: ${platform}`);
}

function nodeArch(arch) {
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  throw new Error(`Unsupported Node.js arch: ${arch}`);
}

function pythonArchTriple(platform, arch) {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  throw new Error(`Unsupported Python target: ${platform}-${arch}`);
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'user-agent': 'moss-runtime-downloader',
        accept: 'application/vnd.github+json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(requestJson(new URL(res.headers.location, url).toString()));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} failed with HTTP ${res.statusCode}`));
        return;
      }
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
  });
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'user-agent': 'moss-runtime-downloader' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(downloadFile(new URL(res.headers.location, url).toString(), destination));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} failed with HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(destination);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function ensureDownload(url, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  if (!hasFlag('--force') && fs.existsSync(destination)) {
    console.log(`exists ${path.relative(process.cwd(), destination)}`);
    return;
  }
  const tempPath = `${destination}.tmp`;
  await fsp.rm(tempPath, { force: true });
  console.log(`download ${url}`);
  await downloadFile(url, tempPath);
  await fsp.rename(tempPath, destination);
  console.log(`saved ${path.relative(process.cwd(), destination)}`);
}

async function downloadNodeRuntime(target) {
  const ext = target.platform === 'win32' ? 'zip' : 'tar.gz';
  const runtimeName = `${nodePlatform(target.platform)}-${nodeArch(target.arch)}`;
  const filename = `node-v${NODE_VERSION}-${runtimeName}.${ext}`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${filename}`;
  const destination = path.join(OUT_DIR, `node-${target.platform}-${target.arch}.${ext}`);
  await ensureDownload(url, destination);
}

async function findPythonAsset(target) {
  const release = await requestJson('https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest');
  const triple = pythonArchTriple(target.platform, target.arch);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item) => {
    const name = String(item.name || '');
    return name.startsWith(`cpython-${PYTHON_SERIES}.`)
      && name.includes(`-${triple}-`)
      && !name.includes('-freethreaded-')
      && name.includes('install_only_stripped')
      && name.endsWith('.tar.gz');
  });
  if (!asset?.browser_download_url) {
    throw new Error(`No python-build-standalone asset found for ${PYTHON_SERIES} ${triple}.`);
  }
  return asset.browser_download_url;
}

async function downloadPythonRuntime(target) {
  const url = await findPythonAsset(target);
  const destination = path.join(OUT_DIR, `python-${target.platform}-${target.arch}.tar.gz`);
  await ensureDownload(url, destination);
}

async function findGitForWindowsAsset() {
  const release = await requestJson(`https://api.github.com/repos/git-for-windows/git/releases/tags/${GIT_FOR_WINDOWS_TAG}`);
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item) => {
    const name = String(item.name || '');
    return name.startsWith('PortableGit-') && name.includes('-64-bit.7z.exe');
  });
  if (!asset?.browser_download_url) {
    throw new Error(`No PortableGit 64-bit asset found for ${GIT_FOR_WINDOWS_TAG}.`);
  }
  return asset.browser_download_url;
}

async function downloadGitRuntime(target) {
  if (target.platform !== 'win32') return;
  if (target.arch !== 'x64') {
    throw new Error(`Git for Windows PortableGit target is only configured for win32-x64, got ${target.platform}-${target.arch}.`);
  }
  const url = await findGitForWindowsAsset();
  const destination = path.join(OUT_DIR, `portablegit-${target.platform}-${target.arch}.7z.exe`);
  await ensureDownload(url, destination);
}

async function main() {
  for (const target of targets) {
    console.log(`target ${target.platform}-${target.arch}`);
    await downloadNodeRuntime(target);
    await downloadPythonRuntime(target);
    await downloadGitRuntime(target);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
