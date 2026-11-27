import { hostIpc as ipcMain } from './host/ipc.mjs';
import electron from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import log from 'electron-log';
import { getUpdateCapabilities } from './update-capabilities.mjs';
import { createReleaseService } from './update-release-service.mjs';
import { fetchElectronUpdate } from './update-electron-fetch.mjs';
import { createDownloadService } from './update-download-service.mjs';
import { createMacUpdateService } from './mac-update-service.mjs';
import { createAutoUpdaterService } from './auto-updater-service.mjs';
import { createUpdateCoordinator } from './update-coordinator.mjs';
import { registerUpdateHandlers } from './update-ipc-handlers.mjs';

const { app, shell, powerMonitor } = electron;
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
  const directory = process.platform === 'darwin'
    ? path.join(app.getPath('userData'), 'updates') : path.join(app.getPath('downloads'), 'Moss Updates');
  const attempt = preferences.installAttempt;
  if (attempt && attempt.from !== currentVersion) {
    // Only the Mac downloader owns this cache. Windows manages its own pending installer.
    if (process.platform === 'darwin' && attempt.version === currentVersion && /^[a-f0-9]{64}$/.test(attempt.candidateId)
      && /^Moss-[A-Za-z0-9.+-]+-mac\.zip$/.test(attempt.asset?.name)
      && attempt.path === path.join(directory, attempt.candidateId, attempt.asset.name)) {
      await fs.promises.unlink(attempt.path).catch(error => { if (error.code !== 'ENOENT') log.warn('Update ZIP cleanup', error); });
    }
    delete preferences.installAttempt;
  }
  const downloader = createDownloadService({ directory, fetchImpl: fetchElectronUpdate });
  let nativeUpdater;
  if (capabilities.mode === 'nativeUpdater' && capabilities.platform === 'darwin') {
    nativeUpdater = createMacUpdateService({ executable: process.execPath, downloader, quit: () => app.quit(),
      logPath: path.join(app.getPath('userData'), 'update-install.log') });
  } else if (capabilities.mode === 'nativeUpdater') {
    const { default: updaterModule } = await import('electron-updater');
    nativeUpdater = createAutoUpdaterService({ updater: updaterModule.autoUpdater, logger: log });
  }
  coordinator = createUpdateCoordinator({
    currentVersion, capabilities, releasePage: `https://github.com/${DEFAULT_REPO}/releases`, preferences,
    savePreferences(next) {
      fs.mkdirSync(path.dirname(prefsPath), { recursive: true });
      fs.writeFileSync(`${prefsPath}.tmp`, JSON.stringify(next), { mode: 0o600 });
      fs.renameSync(`${prefsPath}.tmp`, prefsPath);
    },
    releases: createReleaseService({ repo: DEFAULT_REPO, currentVersion, capabilities, fetchImpl: fetchElectronUpdate }),
    downloader,
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
