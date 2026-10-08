import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CUA_VERSION, CUA_ARTIFACTS } from '../src/computer-use/manifest.mjs';

export function verifyComputerUseResources(resourcesDir, target, { verifyHashes = false } = {}) {
  const artifact = CUA_ARTIFACTS[target];
  if (!artifact) return { supported: false };
  const root = path.join(resourcesDir, 'computer-use', CUA_VERSION, target);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.version !== CUA_VERSION || manifest.archiveSha256 !== artifact.sha256 || manifest.target !== target) throw new Error('Cua package version or provenance mismatch.');
  for (const name of artifact.files) {
    const data = fs.readFileSync(path.join(root, name));
    const record = manifest.files.find(f => f.name === name);
    if (!record || !data.length) throw new Error(`Cua package missing ${name}`);
    if (verifyHashes && createHash('sha256').update(data).digest('hex') !== record.sha256) throw new Error(`Cua staged file checksum mismatch: ${name}`);
  }
  fs.accessSync(path.join(root, 'cua-driver'), fs.constants.X_OK);
  const native = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', '@trycua', `cua-driver-${target}`);
  for (const name of ['libcua_driver_sdk.dylib', 'cua_driver_node_runtime.node']) {
    if (!fs.statSync(path.join(native, name)).size) throw new Error(`Cua SDK missing ${name}`);
  }
  return { supported: true, version: CUA_VERSION, bytes: manifest.files.reduce((n, f) => n + f.size, 0) };
}

export function verifyComputerUseSdk(executable, resourcesDir, target) {
  const info = verifyComputerUseResources(resourcesDir, target);
  if (!info.supported) return info;
  const modulePath = pathToFileURL(path.resolve(resourcesDir, 'app.asar.unpacked', 'node_modules', '@trycua', 'cua-driver', 'dist', 'index.js')).href;
  const code = `const sdk=await import(${JSON.stringify(modulePath)}); if(typeof sdk.EmbeddedCuaDriverHost !== 'function') throw new Error('SDK host missing'); console.log('Cua SDK loaded');`;
  const result = spawnSync(executable, ['--input-type=module', '-e', code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 30000 });
  if (result.error || result.status !== 0) throw new Error(`Packaged Cua SDK failed: ${result.error?.message || result.stderr}`);
  return info;
}
