import electron from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function bundledResourcePath(name) {
  return electron.app?.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', name);
}
