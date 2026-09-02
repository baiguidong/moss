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
await fsp.mkdir(path.dirname(runtimeDestination), { recursive: true });
await fsp.copyFile(runtimeSource, runtimeDestination);
