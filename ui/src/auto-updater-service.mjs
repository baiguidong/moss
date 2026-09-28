import { verifyUpdateFile } from './update-download-service.mjs';

// The Electron instance is injected so this module can be tested without launching an app.
export function createAutoUpdaterService({ updater, logger, verify = verifyUpdateFile }) {
  if (logger) updater.logger = logger;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;
  updater.disableDifferentialDownload = true;
  let downloaded = null;
  let installError = null;
  let onInstallError = null;
  updater.on('error', error => {
    installError = error;
    onInstallError?.(error);
  });

  return {
    async download(candidate, { signal, onProgress, onVerifying } = {}) {
      downloaded = null;
      onInstallError = null;
      // Pin electron-updater to the exact release already selected by the coordinator.
      updater.setFeedURL({ provider: 'generic', url: candidate.feedUrl, channel: 'latest', useMultipleRangeRequest: false });
      updater.allowPrerelease = false;
      updater.allowDowngrade = false;
      const result = await updater.checkForUpdates();
      signal?.throwIfAborted();
      const info = result?.updateInfo;
      const files = info?.files || [];
      if (info?.version !== candidate.version || files.length !== 1
        || ![candidate.asset.name, encodeURIComponent(candidate.asset.name)].includes(files[0].url)
        || files[0].size !== candidate.asset.size || files[0].sha512 !== candidate.asset.sha512) {
        throw new Error('自动更新元数据与已选版本不一致，请重新检查。');
      }
      const token = result.cancellationToken;
      if (!token) throw new Error('自动更新未提供可下载的版本。');
      const cancel = () => token.cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      const progress = value => onProgress?.(value);
      updater.on('download-progress', progress);
      try {
        signal?.throwIfAborted();
        const paths = await updater.downloadUpdate(token);
        signal?.throwIfAborted();
        if (!paths?.[0]) throw new Error('自动更新未返回安装包。');
        onVerifying?.();
        await verify(paths[0], candidate.asset, signal);
        downloaded = { id: candidate.id, filePath: paths[0] };
        return paths[0];
      } finally {
        signal?.removeEventListener('abort', cancel);
        updater.off('download-progress', progress);
      }
    },
    install(candidate, onError) {
      if (downloaded?.id !== candidate.id) throw new Error('请先下载并校验当前版本。');
      installError = null;
      onInstallError = onError;
      updater.quitAndInstall(true, true);
      if (installError) throw installError;
    },
  };
}
