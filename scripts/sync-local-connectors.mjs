import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcesRoot = path.join(repoRoot, 'ui', 'resources', 'connector-sources');
const catalogPath = path.join(repoRoot, 'ui', 'resources', 'connectors', 'workbuddy-connectors-config.zip');
const manifestPath = '.codebuddy-connector/connectors.json';
const stableDate = new Date('2026-09-11T00:00:00.000Z');
const iconExtensions = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];

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

async function discoverSourceNames() {
  const entries = await fsp.readdir(sourcesRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function validateSourceName(sourceName) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(sourceName)) {
    throw new Error(`Invalid connector source name: ${sourceName}`);
  }
}

export async function syncLocalConnectors(requestedSourceNames = [], removedConnectorIds = []) {
  const sourceNames = requestedSourceNames.length > 0
    ? [...new Set(requestedSourceNames)]
    : await discoverSourceNames();
  const zip = await JSZip.loadAsync(await fsp.readFile(catalogPath));
  const manifest = JSON.parse(await zip.file(manifestPath).async('string'));
  const connectors = Array.isArray(manifest.connectors) ? manifest.connectors : [];

  for (const connectorId of [...new Set(removedConnectorIds)]) {
    validateSourceName(connectorId);
    const existingIndex = connectors.findIndex((entry) => entry?.id === connectorId);
    const existing = existingIndex >= 0 ? connectors[existingIndex] : null;
    const packageSource = String(existing?.source || connectorId).trim();
    for (const entryName of Object.keys(zip.files)) {
      if (entryName.startsWith(`connectors/${packageSource}/`)) zip.remove(entryName);
      if (iconExtensions.some((extension) => entryName === `icons/${connectorId}${extension}`)) {
        zip.remove(entryName);
      }
    }
    if (existingIndex >= 0) connectors.splice(existingIndex, 1);
  }

  for (const sourceName of sourceNames) {
    validateSourceName(sourceName);
    const sourceDir = path.join(sourcesRoot, sourceName);
    const catalogEntry = JSON.parse(await fsp.readFile(path.join(sourceDir, 'catalog-entry.json'), 'utf8'));
    const connectorId = String(catalogEntry.id || '').trim();
    const packageSource = String(catalogEntry.source || connectorId).trim();
    if (packageSource !== sourceName || !connectorId) {
      throw new Error(`Connector ${sourceName} must use its directory name as catalog source.`);
    }

    const connectorPrefix = `connectors/${packageSource}/`;
    for (const entryName of Object.keys(zip.files)) {
      if (entryName.startsWith(connectorPrefix)) zip.remove(entryName);
      if (iconExtensions.some((extension) => entryName === `icons/${connectorId}${extension}`)) {
        zip.remove(entryName);
      }
    }

    const existingIndex = connectors.findIndex((entry) => entry?.id === connectorId);
    if (existingIndex >= 0) connectors[existingIndex] = catalogEntry;
    else connectors.push(catalogEntry);

    const sourceFiles = await listFiles(sourceDir);
    const iconPath = sourceFiles.find((relativePath) => (
      path.posix.basename(relativePath, path.posix.extname(relativePath)) === 'icon'
      && iconExtensions.includes(path.posix.extname(relativePath).toLowerCase())
    ));
    if (!iconPath) throw new Error(`Connector ${sourceName} is missing icon.svg or icon.png.`);

    for (const relativePath of sourceFiles) {
      if (relativePath === 'catalog-entry.json' || relativePath === iconPath) continue;
      zip.file(
        `${connectorPrefix}${relativePath.replaceAll(path.sep, '/')}`,
        await fsp.readFile(path.join(sourceDir, relativePath)),
        { date: stableDate, createFolders: false },
      );
    }
    const iconExtension = path.extname(iconPath).toLowerCase();
    zip.file(
      `icons/${connectorId}${iconExtension}`,
      await fsp.readFile(path.join(sourceDir, iconPath)),
      { date: stableDate, createFolders: false },
    );
  }

  manifest.connectors = connectors;
  zip.file(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
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
  console.log(`Updated ${path.relative(repoRoot, catalogPath)} with: ${sourceNames.join(', ')}.`);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const removed = args
    .filter((arg) => arg.startsWith('--remove='))
    .map((arg) => arg.slice('--remove='.length))
    .filter(Boolean);
  await syncLocalConnectors(args.filter((arg) => !arg.startsWith('--remove=')), removed);
}
