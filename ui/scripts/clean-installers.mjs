import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const installersDir = path.join(uiRoot, 'dist', 'installers');

await fsp.rm(installersDir, { recursive: true, force: true });
await fsp.mkdir(installersDir, { recursive: true });
