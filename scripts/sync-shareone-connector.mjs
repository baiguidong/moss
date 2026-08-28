import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(repoRoot, 'ui', 'resources', 'connector-sources', 'shareone');
const catalogPath = path.join(repoRoot, 'ui', 'resources', 'connectors', 'workbuddy-connectors-config.zip');
const connectorPrefix = 'connectors/shareone/';
const stableDate = new Date('2026-08-28T00:00:00.000Z');

async function listFiles(root, relative = '') {
  const directory = path.join(root, relative);
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

const zip = await JSZip.loadAsync(await fsp.readFile(catalogPath));
for (const entryName of Object.keys(zip.files)) {
  if (entryName.startsWith(connectorPrefix) || entryName === 'icons/shareone.png') {
    zip.remove(entryName);
  }
}

const catalogEntry = JSON.parse(await fsp.readFile(path.join(sourceDir, 'catalog-entry.json'), 'utf8'));
const manifestPath = '.codebuddy-connector/connectors.json';
const manifest = JSON.parse(await zip.file(manifestPath).async('string'));
const connectors = Array.isArray(manifest.connectors) ? manifest.connectors : [];
const existingIndex = connectors.findIndex((entry) => entry?.id === catalogEntry.id);
if (existingIndex >= 0) connectors[existingIndex] = catalogEntry;
else connectors.push(catalogEntry);
manifest.connectors = connectors;
zip.file(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  date: stableDate,
  createFolders: false,
});

for (const relativePath of await listFiles(sourceDir)) {
  if (relativePath === 'catalog-entry.json' || relativePath === 'icon.png') continue;
  const data = await fsp.readFile(path.join(sourceDir, relativePath));
  zip.file(`${connectorPrefix}${relativePath.replaceAll(path.sep, '/')}`, data, {
    date: stableDate,
    createFolders: false,
  });
}
zip.file('icons/shareone.png', await fsp.readFile(path.join(sourceDir, 'icon.png')), {
  date: stableDate,
  createFolders: false,
});

const output = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  compressionOptions: { level: 9 },
  platform: 'UNIX',
});
const temporaryPath = `${catalogPath}.tmp`;
await fsp.writeFile(temporaryPath, output);
fs.renameSync(temporaryPath, catalogPath);
console.log(`Updated ${path.relative(repoRoot, catalogPath)} with ShareOne connector ${catalogEntry.id}.`);
