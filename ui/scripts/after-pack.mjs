import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME_ARTIFACTS } from '../src/runtime/runtime-manifest.mjs';

const ELECTRON_BUILDER_ARCHES = Object.freeze([
  'ia32',
  'x64',
  'armv7l',
  'arm64',
  'universal',
]);

export function targetArch(context) {
  const arch = typeof context.arch === 'number'
    ? ELECTRON_BUILDER_ARCHES[context.arch]
    : String(context.arch || '');
  if (!arch) throw new Error(`Unknown electron-builder architecture: ${context.arch}`);
  return arch;
}

function resourcesDirectory(context) {
  return context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
}

async function requireFile(filePath, label) {
  const stat = await fsp.stat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.size === 0) {
    throw new Error(`Packaged ${label} is missing or empty: ${filePath}`);
  }
}

export default async function afterPack(context) {
  const platform = context.electronPlatformName;
  const arch = targetArch(context);
  const target = `${platform}-${arch}`;
  const artifacts = RUNTIME_ARTIFACTS[target];
  if (!artifacts) throw new Error(`Unsupported package target: ${target}`);

  const resourcesDir = resourcesDirectory(context);
  const runtimesDir = path.join(resourcesDir, 'runtimes');
  const allowedRuntimeFiles = new Set([
    'README.md',
    ...Object.values(artifacts).map((artifact) => artifact.filename),
  ]);
  for (const entry of await fsp.readdir(runtimesDir)) {
    if (!allowedRuntimeFiles.has(entry)) {
      await fsp.rm(path.join(runtimesDir, entry), { recursive: true, force: true });
    }
  }
  for (const artifact of Object.values(artifacts)) {
    await requireFile(path.join(runtimesDir, artifact.filename), artifact.filename);
  }

  const ripgrepDir = path.join(resourcesDir, 'ripgrep');
  const requiredRipgrepDir = `${arch}-${platform}`;
  for (const entry of await fsp.readdir(ripgrepDir)) {
    const entryPath = path.join(ripgrepDir, entry);
    if ((await fsp.stat(entryPath)).isDirectory() && entry !== requiredRipgrepDir) {
      await fsp.rm(entryPath, { recursive: true, force: true });
    }
  }
  const ripgrepPath = path.join(
    ripgrepDir,
    requiredRipgrepDir,
    platform === 'win32' ? 'rg.exe' : 'rg',
  );
  await requireFile(ripgrepPath, 'ripgrep');
  if (platform !== 'win32') await fsp.chmod(ripgrepPath, 0o755);

  const sharpPackage = path.join(resourcesDir, 'node_modules', '@img', `sharp-${target}`, 'package.json');
  const sharpPlatformDir = path.join(resourcesDir, 'node_modules', '@img');
  const allowedSharpPackages = new Set([
    'colour',
    `sharp-${target}`,
    `sharp-libvips-${target}`,
  ]);
  for (const entry of await fsp.readdir(sharpPlatformDir)) {
    if (!allowedSharpPackages.has(entry)) {
      await fsp.rm(path.join(sharpPlatformDir, entry), { recursive: true, force: true });
    }
  }
  await requireFile(sharpPackage, `sharp-${target}`);
  await requireFile(path.join(resourcesDir, 'node_modules', 'sharp', 'package.json'), 'sharp');

  if (!fs.existsSync(path.join(resourcesDir, 'connectors', 'workbuddy-connectors-config.zip'))) {
    throw new Error('Packaged connector catalog is missing.');
  }
  if (!fs.existsSync(path.join(resourcesDir, 'connectors', 'connector-cli-overrides.json'))) {
    throw new Error('Packaged connector CLI overrides are missing.');
  }
}
