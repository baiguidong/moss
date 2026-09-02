import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(uiRoot, 'build');
const destination = path.join(uiRoot, 'dist', 'renderer', 'build');

await fsp.rm(destination, { recursive: true, force: true });
await fsp.mkdir(path.dirname(destination), { recursive: true });
await fsp.cp(source, destination, { recursive: true });
