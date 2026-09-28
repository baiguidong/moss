import { randomUUID } from 'node:crypto';

const message = error => error instanceof Error ? error.message : String(error);

export function createUpdateCoordinator({
  currentVersion, capabilities, releasePage, releases, downloader, nativeUpdater,
  openPath, showItemInFolder, prepareForInstall, getInstallBlockers = () => [],
  preferences = {}, savePreferences = () => {}, onState = () => {}, installTimeout = 15_000,
}) {
  let prefs = { autoDownload: preferences.autoDownload !== false, dismissedVersion: preferences.dismissedVersion || '' };
  let state = { revision: 0, currentVersion, capabilities, phase: capabilities.mode === 'development' || capabilities.mode === 'unsupported' ? 'unsupported' : 'idle', reason: capabilities.reason, releasePage, autoDownload: prefs.autoDownload };
  let candidate = null;
  let filePath = null;
  let checkPromise = null;
  let downloadPromise = null;
  let installPromise = null;
  let controller = null;
  let suppressedDownload = null;
  let opening = false;
  let installTimer;
  const snapshot = () => structuredClone(state);
  const publish = patch => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    state.prompt = Boolean(state.version && prefs.dismissedVersion !== state.version && (
      state.phase === 'downloaded' || (state.phase === 'available' && (capabilities.mode !== 'nativeUpdater' || !prefs.autoDownload))
    ));
    onState(snapshot());
    return snapshot();
  };
  const fail = (error, retry) => publish({ phase: 'error', error: message(error), retry });
  const requireCandidate = id => {
    if (!candidate || candidate.id !== id) throw new Error('更新候选已失效，请重新检查。');
  };
  const persist = next => { savePreferences(next); prefs = next; };

  const api = {
    getState: snapshot,
    check({ background = false } = {}) {
      if (checkPromise) return checkPromise;
      if (downloadPromise || installPromise || filePath || state.phase === 'installing') return Promise.resolve(snapshot());
      if (!['manual', 'nativeUpdater'].includes(capabilities.mode)) return Promise.resolve(snapshot());
      publish({ phase: 'checking', error: undefined, retry: undefined, reason: undefined, candidateId: undefined, version: undefined, notes: undefined, progress: undefined });
      checkPromise = (async () => {
        try {
          candidate = await releases.check();
          if (!candidate) return publish({ phase: 'upToDate', version: undefined, candidateId: undefined, notes: undefined });
          if (candidate.unsupported) return publish({ phase: 'unsupported', version: candidate.version, reason: candidate.reason, releasePage: candidate.htmlUrl, candidateId: undefined });
          publish({ phase: 'available', version: candidate.version, candidateId: candidate.id, notes: candidate.notes, fileName: candidate.asset.name, releasePage: candidate.htmlUrl, downloadId: undefined, progress: undefined });
          if (background && capabilities.mode === 'nativeUpdater' && prefs.autoDownload && suppressedDownload !== candidate.id) {
            // Run after checkPromise is cleared; failures remain visible in the snapshot.
            queueMicrotask(() => { void api.download(candidate.id); });
          }
          return snapshot();
        } catch (error) {
          candidate = null;
          return fail(error, 'check');
        } finally { checkPromise = null; }
      })();
      return checkPromise;
    },
    download(id) {
      try { requireCandidate(id); } catch (error) { return Promise.reject(error); }
      if (downloadPromise) return downloadPromise;
      if (installPromise || state.phase === 'installing' || filePath) return Promise.resolve(snapshot());
      if (candidate.unsupported || checkPromise) return Promise.reject(new Error('请等待版本检查完成。'));
      controller = new AbortController();
      const signal = controller.signal;
      publish({ phase: 'downloading', error: undefined, retry: undefined, progress: { transferred: 0, total: candidate.asset.size, percent: 0, bytesPerSecond: 0 } });
      downloadPromise = (async () => {
        try {
          const service = capabilities.mode === 'nativeUpdater' ? nativeUpdater : downloader;
          filePath = await service.download(candidate, {
            signal,
            onProgress: progress => publish({ progress }),
            onVerifying: () => publish({ phase: 'verifying' }),
          });
          signal.throwIfAborted();
          return publish({ phase: 'downloaded', downloadId: randomUUID(), error: undefined });
        } catch (error) {
          filePath = null;
          return signal.aborted ? publish({ phase: 'available', error: '下载已取消。', progress: undefined }) : fail(error, 'download');
        } finally { downloadPromise = null; controller = null; }
      })();
      return downloadPromise;
    },
    cancel() {
      if (controller) { suppressedDownload = candidate?.id; controller.abort(); }
      return snapshot();
    },
    dismiss(version) {
      if (version && version === state.version) persist({ ...prefs, dismissedVersion: version });
      return publish({});
    },
    setAutoDownload(enabled) {
      if (typeof enabled !== 'boolean') throw new Error('自动下载设置无效。');
      persist({ ...prefs, autoDownload: enabled });
      return publish({ autoDownload: enabled });
    },
    async open(downloadId, reveal = false) {
      if (installPromise || state.phase === 'installing') throw new Error('正在准备安装，请稍候。');
      if (!filePath || !downloadId || state.downloadId !== downloadId) throw new Error('下载记录已失效，请重新下载。');
      if (!reveal && (capabilities.platform !== 'darwin' || capabilities.packageType !== 'dmg')) throw new Error('当前安装包仅支持在文件夹中显示。');
      if (opening) return snapshot();
      opening = true;
      try {
        try { await downloader.verify(filePath, candidate.asset); }
        catch (error) { filePath = null; publish({ downloadId: undefined }); return fail(error, 'download'); }
        try {
          if (reveal) await showItemInFolder(filePath);
          else {
            const error = await openPath(filePath);
            if (error) throw new Error(error);
          }
          return publish({ phase: 'downloaded', error: undefined, retry: undefined });
        } catch (error) {
          // A shell failure doesn't invalidate a verified package.
          return publish({ phase: 'downloaded', error: `无法打开安装包：${message(error)}` });
        }
      } finally { opening = false; }
    },
    install(id) {
      try {
        requireCandidate(id);
        if (opening) throw new Error('正在校验安装包，请稍候。');
        if (capabilities.mode !== 'nativeUpdater' || !filePath) throw new Error('当前版本尚不能自动安装。');
      } catch (error) { return Promise.reject(error); }
      if (installPromise || state.phase === 'installing') return installPromise || Promise.resolve(snapshot());
      installPromise = Promise.resolve().then(async () => {
        try {
          const blockers = getInstallBlockers();
          if (blockers.length) return publish({ phase: 'downloaded', error: `请先结束以下工作，再安装更新：${blockers.join('、')}` });
          publish({ phase: 'verifying', error: undefined });
          try { await downloader.verify(filePath, candidate.asset); }
          catch (error) { filePath = null; publish({ downloadId: undefined }); return fail(error, 'download'); }
          publish({ phase: 'preparingInstall' });
          await prepareForInstall();
          publish({ phase: 'installing' });
          const failed = error => {
            clearTimeout(installTimer);
            fail(error, 'install');
          };
          installTimer = setTimeout(() => failed(new Error('安装请求后应用未退出。可重试安装，或退出 Moss 后手动运行安装包。')), installTimeout);
          installTimer.unref?.();
          nativeUpdater.install(candidate, failed);
          return snapshot();
        } catch (error) {
          clearTimeout(installTimer);
          return fail(error, 'install');
        } finally { installPromise = null; }
      });
      return installPromise;
    },
    dispose() { controller?.abort(); clearTimeout(installTimer); },
  };
  return api;
}
