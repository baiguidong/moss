import electron from 'electron';
import { createRequestRegistry } from './request-registry.mjs';

// Existing feature registrars keep their handle/on API while both transports
// share their actual handlers. Electron's own sender checks remain intact.
export const hostIpc = createRequestRegistry(electron.ipcMain);
