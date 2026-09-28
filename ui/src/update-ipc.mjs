import electron from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';
import { getUpdateCapabilities } from './update-capabilities.mjs';
import { createReleaseService } from './update-release-service.mjs';
import { createDownloadService } from './update-download-service.mjs';
import { createAutoUpdaterService } from './auto-updater-service.mjs';
import { createUpdateCoordinator } from './update-coordinator.mjs';
import { registerUpdateHandlers } from './update-ipc-handlers.mjs';

const { ipcMain, app, shell, net, powerMonitor } = electron;
const DEFAULT_REPO = 'baiguidong/moss';
let mainWindow = null;
let coordinator;
let startupTimer;
let interval;
let lastCheck = 0;

export function setMainWindowRef(win) { mainWindow = win; }

export async function initUpdateIpcHandlers({ prepareForInstall, getInstallBlockers }) {
  const portable = Boolean(process.env.PORTABLE_EXECUTABLE_FILE || process.env.PORTABLE_EXECUTABLE_DIR);
  const capabilities = getUpdateCapabilities({
    platform: process.platform, arch: process.arch, isPackaged: app.isPackaged, portable,
    hasNsisMarker: fs.existsSync(path.join(path.dirname(process.execPath), 'Uninstall Moss.exe')),
  });
  const currentVersion = app.getVersion();
  const prefsPath = path.join(app.getPath('userData'), 'update-preferences.json');
  let preferences = {};
  try {
    const saved = JSON.parse(fs.readFileSync(prefsPath, 'utf8'));
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) preferences = saved;
  } catch { /* Defaults on first launch. */ }
  let nativeUpdater;
  if (capabilities.mode === 'nativeUpdater') {
    const { default: updaterModule } = await import('electron-updater');
    nativeUpdater = createAutoUpdaterService({ updater: updaterModule.autoUpdater, logger: log });
  }
  const fetchImpl = (url, options) => net.fetch(url, options);
  coordinator = createUpdateCoordinator({
    currentVersion, capabilities, releasePage: `https://github.com/${DEFAULT_REPO}/releases`, preferences,
    savePreferences(next) {
      fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
      fs.writeFileSync(`${prefsPath}.tmp`, JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(`${prefsPath}.tmp`, prefsPath);
    },
    releases: createReleaseService({ repo: DEFAULT_REPO, currentVersion, capabilities, fetchImpl }),
    downloader: createDownloadService({ directory: path.join(app.getPath('downloads'), 'Moss Updates'), fetchImpl }),
    nativeUpdater, prepareForInstall, getInstallBlockers,
    openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file),
    onState(state) {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', state);
    },
  });
  registerUpdateHandlers({ ipcMain, coordinator, getWindow: () => mainWindow, openExternal: url => shell.openExternal(url) });
}

export function startUpdateChecks() {
  if (!app.isPackaged || process.env.MOSS_DISABLE_AUTO_UPDATE === 'true' || process.env.CI === 'true' || interval) return;
  const check = () => {
    if (Date.now() - lastCheck < 60_000) return;
    lastCheck = Date.now();
    void coordinator.check({ background: true });
  };
  startupTimer = setTimeout(check, 5000);
  interval = setInterval(check, 6 * 60 * 60 * 1000);
  startupTimer.unref?.();
  interval.unref?.();
  powerMonitor.on('resume', check);
  app.once('will-quit', () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
    powerMonitor.off('resume', check);
    coordinator.dispose();
  });
}
