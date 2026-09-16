import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import OpenIMSDKMain from '@openim/electron-client-sdk';

const require = createRequire(import.meta.url);

function platformID() {
  if (process.platform === 'darwin') return 4;
  if (process.platform === 'win32') return 3;
  return 7;
}

function nativeLibraryLocation(isPackaged) {
  const packageDir = path.dirname(require.resolve('@openim/electron-client-sdk/package.json'));
  const target = process.platform === 'darwin'
    ? `mac_${process.arch}/libopenimsdk.dylib`
    : process.platform === 'win32'
      ? `win_${process.arch}/libopenimsdk.dll`
      : `linux_${process.arch}/libopenimsdk.so`;
  const libraryPath = path.join(packageDir, 'assets', target);
  return isPackaged ? libraryPath.replace('app.asar', 'app.asar.unpacked') : libraryPath;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    return String(error.errDlt || error.errMsg || error.message || JSON.stringify(error));
  }
  return String(error || 'OpenIM 请求失败');
}

const FILE_FILTERS = {
  image: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'] }],
  video: [{ name: '视频', extensions: ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi'] }],
  audio: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'amr'] }],
};

function localMediaUrl(filePath) {
  return `moss-media://local/${encodeURIComponent(filePath)}`;
}

export function createOpenIMIntegration({
  app,
  ipcMain,
  desktopCapturer,
  dialog,
  nativeImage,
  screen,
  shell,
  systemPreferences,
  mossHome,
  allowMediaRoot,
  resolveMossServerConnection,
  log,
}) {
  const dataDir = path.join(mossHome, 'openim', 'sdk');
  const logFilePath = path.join(mossHome, 'openim', 'logs');
  const mediaCacheDir = path.join(mossHome, 'openim', 'media');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logFilePath, { recursive: true });
  fs.mkdirSync(mediaCacheDir, { recursive: true });

  let sdkMain = null;
  let sdkError = '';

  async function requestMossServer(pathname, { method = 'GET', body } = {}) {
    const connection = await resolveMossServerConnection();
    const response = await fetch(`${connection.serverUrl}${pathname}`, {
      method,
      signal: AbortSignal.timeout(20_000),
      headers: {
        authorization: `Bearer ${connection.authToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        if (typeof payload?.error === 'string' && payload.error.trim()) detail = payload.error.trim();
      } catch {}
      throw new Error(detail);
    }
    return response.json();
  }

  ipcMain.handle('openim:get-config', () => ({
    available: !sdkError,
    error: sdkError,
    platformID: platformID(),
    dataDir,
    logFilePath,
    mediaCacheDir,
  }));

  ipcMain.handle('openim:create-session', async () => {
    if (sdkError) throw new Error(sdkError);
    return requestMossServer('/api/v1/im/session', {
      method: 'POST',
      body: { platform_id: platformID() },
    });
  });

  ipcMain.handle('openim:list-directory', () => requestMossServer('/api/v1/directory'));

  ipcMain.handle('openim:prepare-direct-session', (_event, payload = {}) => {
    const userID = String(payload.userID || '').trim();
    if (!userID) throw new Error('请选择联系人');
    return requestMossServer('/api/v1/im/direct-session', {
      method: 'POST',
      body: { user_id: userID },
    });
  });

  ipcMain.handle('openim:prepare-group-session', (_event, payload = {}) => {
    const userIDs = Array.isArray(payload.userIDs)
      ? payload.userIDs.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    return requestMossServer('/api/v1/im/group-session', {
      method: 'POST',
      body: { user_ids: userIDs },
    });
  });

  ipcMain.handle('openim:pick-files', async (_event, payload = {}) => {
    const kind = String(payload.kind || 'file');
    const response = await dialog.showOpenDialog({
      properties: ['openFile', ...(kind === 'file' || kind === 'image' ? ['multiSelections'] : [])],
      ...(FILE_FILTERS[kind] ? { filters: FILE_FILTERS[kind] } : {}),
    });
    if (response.canceled) return [];
    return response.filePaths.map((filePath) => {
      allowMediaRoot(path.dirname(filePath));
      const stat = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        size: stat.size,
        mediaUrl: localMediaUrl(filePath),
      };
    });
  });

  ipcMain.handle('openim:prepare-local-files', (_event, payload = {}) => {
    const files = Array.isArray(payload.files) ? payload.files.slice(0, 20) : [];
    return files.map((item) => {
      const filePath = path.resolve(String(item?.path || ''));
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) throw new Error('附件路径不是文件');
      allowMediaRoot(path.dirname(filePath));
      return {
        name: path.basename(String(item?.name || path.basename(filePath))),
        path: filePath,
        size: stat.size,
        mediaUrl: localMediaUrl(filePath),
      };
    });
  });

  ipcMain.handle('openim:create-video-thumbnail', async (_event, payload = {}) => {
    const filePath = String(payload.path || '');
    if (!filePath || !fs.existsSync(filePath)) throw new Error('视频文件不存在');
    const targetPath = path.join(mediaCacheDir, `${randomUUID()}.png`);
    let image;
    try {
      image = await nativeImage.createThumbnailFromPath(filePath, { width: 640, height: 360 });
    } catch {
      image = nativeImage.createFromDataURL(
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#171717"/><path d="M270 105l130 75-130 75z" fill="#fff"/></svg>',
        ),
      );
    }
    fs.writeFileSync(targetPath, image.toPNG());
    allowMediaRoot(mediaCacheDir);
    return { path: targetPath, mediaUrl: localMediaUrl(targetPath) };
  });

  ipcMain.handle('openim:capture-screen', async () => {
    const permission = process.platform === 'darwin'
      ? systemPreferences.getMediaAccessStatus('screen')
      : 'granted';
    if (permission === 'denied' || permission === 'restricted') {
      if (process.platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
      }
      throw new Error(permission === 'restricted'
        ? '系统限制了屏幕录制权限，请联系设备管理员'
        : '已打开屏幕录制权限设置，授权 Moss 后请重新截图');
    }

    const display = screen.getPrimaryDisplay();
    const thumbnailSize = {
      width: Math.min(4096, Math.max(1, Math.round(display.size.width * display.scaleFactor))),
      height: Math.min(4096, Math.max(1, Math.round(display.size.height * display.scaleFactor))),
    };
    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
        fetchWindowIcons: false,
      });
    } catch (error) {
      if (process.platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        throw new Error('无法获取屏幕录制权限，已打开系统设置，请授权 Moss 后重试');
      }
      throw error;
    }

    const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      if (process.platform === 'darwin') {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
        throw new Error('未获得屏幕录制权限，已打开系统设置，请授权 Moss 后重试');
      }
      throw new Error('未找到可截图的显示器');
    }

    const targetPath = path.join(mediaCacheDir, `screenshot-${Date.now()}-${randomUUID()}.png`);
    const buffer = source.thumbnail.toPNG();
    fs.writeFileSync(targetPath, buffer);
    allowMediaRoot(mediaCacheDir);
    return {
      name: path.basename(targetPath),
      path: targetPath,
      size: buffer.length,
      mediaUrl: localMediaUrl(targetPath),
    };
  });

  ipcMain.handle('openim:download', async (_event, payload = {}) => {
    const url = String(payload.url || '');
    const fileName = path.basename(String(payload.fileName || 'OpenIM-download'));
    if (!/^https?:\/\//i.test(url)) throw new Error('下载地址无效');
    const selected = await dialog.showSaveDialog({ defaultPath: fileName });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    const response = await fetch(url);
    if (!response.ok) throw new Error(`下载失败 (${response.status})`);
    fs.writeFileSync(selected.filePath, Buffer.from(await response.arrayBuffer()));
    return { canceled: false, filePath: selected.filePath };
  });

  ipcMain.handle('openim:get-rtc-token', () => {
    throw new Error('音视频服务尚未配置');
  });

  return {
    attach(webContents) {
      try {
        if (sdkMain) {
          sdkMain.addWebContent(webContents);
          return;
        }
        sdkMain = new OpenIMSDKMain(nativeLibraryLocation(app.isPackaged), webContents);
        sdkError = '';
      } catch (error) {
        sdkError = errorMessage(error);
        log('error', 'openim', 'Failed to initialize OpenIM Electron SDK', { error: sdkError });
      }
    },
  };
}
