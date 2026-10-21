import './build-mcp-app.mjs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(uiRoot, 'build');
const destination = path.join(uiRoot, 'dist', 'renderer', 'build');
const runtimeSource = path.join(uiRoot, 'electron-direct.mjs');
const runtimeDestination = path.join(uiRoot, 'dist', 'runtime', 'electron-direct.mjs');

await fsp.rm(destination, { recursive: true, force: true });
await fsp.mkdir(path.dirname(destination), { recursive: true });
await fsp.cp(source, destination, { recursive: true });
// The build directory can contain owner-only files. The renderer serves these
// assets to the unprivileged moss user in the Web image.
async function makePublic(directory) {
  await fsp.chmod(directory, 0o755);
  for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await makePublic(filename);
    else if (entry.isFile()) await fsp.chmod(filename, 0o644);
  }
}
await makePublic(destination);
await fsp.mkdir(path.dirname(runtimeDestination), { recursive: true });
await fsp.copyFile(runtimeSource, runtimeDestination);
