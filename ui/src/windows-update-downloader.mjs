import path from 'node:path';
import updater from 'electron-updater';
import { downloadDifferential } from './update-differential.mjs';
import { fetchElectronUpdate } from './update-electron-fetch.mjs';

// Keep NSIS's installed-package cache, verification and install handoff. Use
// Moss's range transport for per-hop validation, progress and explicit fallback.
export class WindowsUpdateDownloader extends updater.NsisUpdater {
  async differentialDownloadInstaller(file, options, destination, _provider, oldInstallerFileName) {
    const token = options.cancellationToken;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    token.once('cancel', cancel);
    if (token.cancelled) cancel();
    let timer;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error('增量下载超时，请重试。')), 60_000);
      timer.unref();
    };
    try {
      touch();
      const url = file.url.href;
      const complete = await downloadDifferential({
        asset: { ...file.info, url, name: decodeURIComponent(path.posix.basename(file.url.pathname)) },
        version: options.updateInfoAndProvider.info.version, baseVersion: this.currentVersion.version,
        baseFile: path.join(this.downloadedUpdateHelper.cacheDir, oldInstallerFileName), destination,
        signal: controller.signal, fetchImpl: fetchElectronUpdate, touch,
        onProgress: progress => this.emit('download-progress', progress),
      });
      return !complete;
    } finally { clearTimeout(timer); token.off('cancel', cancel); }
  }
}
