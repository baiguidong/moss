// Assemble the Host, shared renderer and installed runtime dependencies only.
// Preserve node_modules locations so nested/versioned dependencies resolve as
// they did in the locked build; frontend/build dependencies stay in that stage.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const target = path.resolve(process.argv[2] || '/opt/moss-release');
if (target === repo || target.startsWith(repo + path.sep)) throw new Error('Release directory must be outside the source tree.');
await fs.mkdir(target, { recursive: true });
for (const relative of ['package.json', 'cloud', 'bin', 'shared', 'packages', 'ui/package.json', 'ui/src', 'ui/dist', 'ui/electron-direct.mjs', 'ui/build', 'ui/resources']) {
  try { await fs.cp(path.join(repo, relative), path.join(target, relative), { recursive: true, filter: source => !source.includes('/node_modules/') && !source.includes('/resources/runtimes/') }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const copied = new Set();
async function copyPackage(name, from, optional = false) {
  let directory = from;
  let source;
  while (directory.startsWith(repo)) {
    const candidate = path.join(directory, 'node_modules', name);
    try { await fs.access(path.join(candidate, 'package.json')); source = candidate; break; } catch {}
    directory = path.dirname(directory);
  }
  if (!source) {
    if (optional) return;
    throw new Error(`Missing runtime dependency ${name} from ${from}`);
  }
  if (copied.has(source)) return;
  copied.add(source);
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  await fs.cp(source, path.join(target, path.relative(repo, source)), {
    recursive: true, dereference: true,
    filter: file => file === source || !path.relative(source, file).split(path.sep).includes('node_modules'),
  });
  for (const dependency of Object.keys(manifest.dependencies || {})) await copyPackage(dependency, source);
  for (const dependency of Object.keys(manifest.optionalDependencies || {})) await copyPackage(dependency, source, true);
  for (const dependency of Object.keys(manifest.peerDependencies || {})) await copyPackage(dependency, source, true);
}
const dependencies = ['@xmldom/xmldom', 'ajv', 'diff', 'electron', 'electron-log', 'electron-updater', 'js-yaml', 'jszip', 'mammoth', 'node-pty', 'proper-lockfile', 'semver', 'sharp', 'turndown', 'typescript', 'ws', 'xlsx-republish', 'yauzl'];
for (const name of dependencies) await copyPackage(name, path.join(repo, 'ui'));
// Shared packages resolve above ui/; preserve their root-level dependencies too.
for (const name of ['ajv', 'proper-lockfile', 'sharp', 'typescript']) await copyPackage(name, repo);
console.log(`Prepared WebUI release with ${copied.size} runtime packages at ${target}`);
