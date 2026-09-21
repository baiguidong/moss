import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import OpenIMSDKMain from '@openim/electron-client-sdk';
import { parseOpenIMDirectConversationId } from '../../../packages/app-sdk/src/index.mjs';

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
const MAX_RENDERER_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const OPENIM_SDK_METHOD_PERMISSIONS = Object.freeze({
  initSDK: 'openim:client',
  getLoginStatus: 'openim:client',
  getSelfUserInfo: 'openim:client',
  login: 'openim:client',
  logout: 'openim:client',
  networkStatusChanged: 'openim:client',
  getAllConversationList: 'openim:client',
  getOneConversation: 'openim:client',
  getGroupMemberList: 'openim:client',
  getAdvancedHistoryMessageList: 'openim:messages',
  searchLocalMessages: 'openim:messages',
  createTextMessage: 'openim:messages',
  createTextAtMessage: 'openim:messages',
  createQuoteMessage: 'openim:messages',
  createForwardMessage: 'openim:messages',
  createMergerMessage: 'openim:messages',
  createCardMessage: 'openim:messages',
  createLocationMessage: 'openim:messages',
  createCustomMessage: 'openim:messages',
  createImageMessageFromFullPath: 'openim:files',
  createVideoMessageFromFullPath: 'openim:files',
  createSoundMessageFromFullPath: 'openim:files',
  createFileMessageFromFullPath: 'openim:files',
  sendMessage: 'openim:messages',
  markConversationMessageAsRead: 'openim:messages',
  revokeMessage: 'openim:messages',
  deleteMessageFromLocalStorage: 'openim:messages',
  clearConversationAndDeleteAllMsg: 'openim:messages',
  deleteConversationAndDeleteAllMsg: 'openim:messages',
  setConversation: 'openim:messages',
  setConversationDraft: 'openim:messages',
  typingStatusUpdate: 'openim:messages',
  createGroup: 'openim:messages',
  inviteUserToGroup: 'openim:messages',
  kickGroupMember: 'openim:messages',
  setGroupInfo: 'openim:messages',
});

function localMediaUrl(filePath) {
  return `moss-media://local/${encodeURIComponent(filePath)}`;
}

function deterministicMessageId(idempotencyKey) {
  const hash = createHash('sha256').update(String(idempotencyKey)).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function directorySnapshot(root) {
  const snapshot = { files: 0, bytes: 0 };
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile()) {
        snapshot.files += 1;
        snapshot.bytes += fs.statSync(entryPath).size;
      }
    }
  };
  visit(root);
  return snapshot;
}

export function migrateLegacyOpenIMData(mossHome, targetRoot, log = () => {}) {
  const legacyRoot = path.join(mossHome, 'openim');
  const markerPath = path.join(targetRoot, '.legacy-migration-v1.json');
  if (fs.existsSync(markerPath)) return { migrated: false, markerPath };
  fs.mkdirSync(targetRoot, { recursive: true, mode: 0o700 });
  const copied = [];
  for (const name of ['sdk', 'logs', 'media']) {
    const source = path.join(legacyRoot, name);
    const destination = path.join(targetRoot, name);
    if (!fs.existsSync(source) || fs.existsSync(destination)) continue;
    const temporary = `${destination}.migrating`;
    fs.rmSync(temporary, { recursive: true, force: true });
    fs.cpSync(source, temporary, { recursive: true, errorOnExist: true });
    const sourceSnapshot = directorySnapshot(source);
    const destinationSnapshot = directorySnapshot(temporary);
    if (
      sourceSnapshot.files !== destinationSnapshot.files
      || sourceSnapshot.bytes !== destinationSnapshot.bytes
    ) {
      fs.rmSync(temporary, { recursive: true, force: true });
      throw new Error(`OpenIM ${name} migration verification failed`);
    }
    fs.renameSync(temporary, destination);
    copied.push(name);
  }
  const marker = {
    schemaVersion: 1,
    migratedAt: Date.now(),
    source: legacyRoot,
    copied,
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (copied.length) log('info', 'openim', 'Migrated legacy OpenIM data into the moss.openim instance', { copied });
  return { migrated: copied.length > 0, markerPath, copied };
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
  allowMediaFile = (filePath) => allowMediaRoot(path.dirname(filePath)),
  resolveMossServerConnection,
  authorizeClient = () => {},
  isTrustedClient = () => false,
  log,
  fetchImpl = fetch,
  createSdkMain = (libraryPath, webContents) => new OpenIMSDKMain(libraryPath, webContents),
}) {
  const appInstanceDataDir = path.join(
    mossHome,
    'apps-data',
    'moss.openim',
    'instances',
    'moss.openim--default',
    'openim',
  );
  migrateLegacyOpenIMData(mossHome, appInstanceDataDir, log);
  const dataDir = path.join(appInstanceDataDir, 'sdk');
  const logFilePath = path.join(appInstanceDataDir, 'logs');
  const mediaCacheDir = path.join(appInstanceDataDir, 'media');
  const sentMessagesPath = path.join(appInstanceDataDir, 'sent-messages.json');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logFilePath, { recursive: true });
  fs.mkdirSync(mediaCacheDir, { recursive: true });

  let sdkMain = null;
  let sdkError = '';
  let sdkInitialized = false;
  let activeSession = null;
  let issuedSession = null;
  let sessionPromise = null;
  const attachedWebContents = new Map();
  const nativeEventListeners = new Set();
  const sentMessages = new Map();
  const pendingSends = new Map();
  const approvedLocalFiles = new Set();
  try {
    const entries = JSON.parse(fs.readFileSync(sentMessagesPath, 'utf8'));
    if (Array.isArray(entries)) {
      for (const [key, value] of entries.slice(-1_000)) {
        if (typeof key === 'string' && value && typeof value === 'object') sentMessages.set(key, value);
      }
    }
  } catch {}

  function persistSentMessages() {
    const temporaryPath = `${sentMessagesPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify([...sentMessages]), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporaryPath, sentMessagesPath);
  }

  function approveLocalFile(filePath) {
    const resolved = fs.realpathSync(path.resolve(String(filePath || '')));
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error('附件路径不是文件');
    approvedLocalFiles.add(resolved);
    allowMediaFile(resolved);
    return { path: resolved, stat };
  }

  function requireApprovedLocalFile(filePath) {
    let resolved;
    try {
      resolved = fs.realpathSync(path.resolve(String(filePath || '')));
    } catch {
      throw new Error('附件未通过用户选择或 App 缓存授权');
    }
    if (!approvedLocalFiles.has(resolved)) throw new Error('附件未通过用户选择或 App 缓存授权');
    return resolved;
  }

  function safeSdkArguments(method, args) {
    if (method === 'createImageMessageFromFullPath') {
      return [requireApprovedLocalFile(args[0])];
    }
    if (method === 'createVideoMessageFromFullPath') {
      const input = args[0] && typeof args[0] === 'object' ? args[0] : {};
      return [{
        ...input,
        videoPath: requireApprovedLocalFile(input.videoPath),
        snapshotPath: requireApprovedLocalFile(input.snapshotPath),
      }];
    }
    if (method === 'createSoundMessageFromFullPath') {
      const input = args[0] && typeof args[0] === 'object' ? args[0] : {};
      return [{ ...input, soundPath: requireApprovedLocalFile(input.soundPath) }];
    }
    if (method === 'createFileMessageFromFullPath') {
      const input = args[0] && typeof args[0] === 'object' ? args[0] : {};
      return [{ ...input, filePath: requireApprovedLocalFile(input.filePath) }];
    }
    return args;
  }

  const eventSink = {
    isDestroyed: () => false,
    send(channel, event, data) {
      if (channel !== 'openim-sdk-ipc-event') return;
      for (const listener of nativeEventListeners) {
        try { listener(event, data); } catch (error) {
          log('error', 'openim', 'OpenIM native event listener failed', { error: errorMessage(error) });
        }
      }
    },
  };

  function ensureSdk() {
    if (sdkMain) return sdkMain;
    try {
      sdkMain = createSdkMain(nativeLibraryLocation(app.isPackaged), null);
      sdkMain.addWebContent(eventSink);
      sdkError = '';
      return sdkMain;
    } catch (error) {
      sdkError = errorMessage(error);
      log('error', 'openim', 'Failed to initialize OpenIM Electron SDK', { error: sdkError });
      throw error;
    }
  }

  function handle(channel, permission, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      const requiredPermission = typeof permission === 'function' ? permission(...args) : permission;
      authorizeClient(event, requiredPermission, channel);
      return handler(event, ...args);
    });
  }

  async function requestMossServer(pathname, { method = 'GET', body } = {}) {
    const connection = await resolveMossServerConnection();
    const response = await fetchImpl(`${connection.serverUrl}${pathname}`, {
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

  async function ensureSession() {
    if (sessionPromise) return sessionPromise;
    sessionPromise = (async () => {
      if (sdkError) throw new Error(sdkError);
      const profile = await requestMossServer('/api/v1/im/session', {
        method: 'POST',
        body: { platform_id: platformID() },
      });
      issuedSession = profile;
      const sdk = ensureSdk().sdk;
      if (!sdkInitialized) {
        const initialized = await sdk.initSDK({
          platformID: platformID(),
          apiAddr: profile.apiAddr,
          wsAddr: profile.wsAddr,
          dataDir,
          logFilePath,
          logLevel: 4,
          isLogStandardOutput: false,
          systemType: 'electron',
        });
        if (!initialized) {
          const status = await sdk.getLoginStatus();
          if (![2, 3].includes(Number(status?.data))) throw new Error('OpenIM SDK 初始化失败');
        }
        sdkInitialized = true;
      }

      const status = await sdk.getLoginStatus();
      let currentUserId = '';
      if (Number(status?.data) === 3) {
        currentUserId = String((await sdk.getSelfUserInfo())?.data?.userID || '');
      }
      if (
        Number(status?.data) !== 3
        || currentUserId !== String(profile.userID || '')
        || (activeSession?.imToken && activeSession.imToken !== profile.imToken)
      ) {
        if ([2, 3].includes(Number(status?.data))) await sdk.logout().catch(() => {});
        await sdk.login({ userID: profile.userID, token: profile.imToken });
      }
      activeSession = profile;
      return {
        connected: true,
        userId: String(profile.userID || ''),
        expiresIn: Math.max(0, Number(profile.expiresIn) || 0),
      };
    })().catch((error) => {
      activeSession = null;
      throw error;
    }).finally(() => {
      sessionPromise = null;
    });
    return sessionPromise;
  }

  async function sendText({ recipientId, conversationId, text, idempotencyKey }) {
    const existing = sentMessages.get(idempotencyKey);
    if (existing) return { ...existing, duplicate: true };
    if (pendingSends.has(idempotencyKey)) return pendingSends.get(idempotencyKey);
    const operation = (async () => {
      const session = await ensureSession();
      const conversation = parseOpenIMDirectConversationId(conversationId);
      if (!conversation || conversation.userId !== session.userId || conversation.peerUserId !== recipientId) {
        throw new Error('OpenIM conversation does not belong to the active account');
      }
      const sdk = ensureSdk().sdk;
      const created = await sdk.createTextMessage(text);
      const message = {
        ...created.data,
        clientMsgID: deterministicMessageId(idempotencyKey),
      };
      const sent = await sdk.sendMessage({
        recvID: recipientId,
        groupID: '',
        message,
      });
      const result = {
        sent: true,
        conversationId,
        clientMessageId: String(sent?.data?.clientMsgID || message.clientMsgID),
        serverMessageId: String(sent?.data?.serverMsgID || ''),
      };
      sentMessages.set(idempotencyKey, result);
      while (sentMessages.size > 1_000) sentMessages.delete(sentMessages.keys().next().value);
      try { persistSentMessages(); } catch (error) {
        log('warn', 'openim', 'Unable to persist OpenIM delivery receipt', { error: errorMessage(error) });
      }
      return result;
    })().finally(() => pendingSends.delete(idempotencyKey));
    pendingSends.set(idempotencyKey, operation);
    return operation;
  }

  handle('openim:sdk-call', (method) => {
    const normalized = String(method || '').trim();
    return OPENIM_SDK_METHOD_PERMISSIONS[normalized] || 'openim:denied';
  }, async (_event, method, ...args) => {
    const normalized = String(method || '').trim();
    if (!Object.hasOwn(OPENIM_SDK_METHOD_PERMISSIONS, normalized)) {
      throw new Error(`OpenIM SDK method is not available to Apps: ${normalized || '<empty>'}`);
    }
    const sdk = ensureSdk().sdk;
    if (normalized === 'initSDK') {
      const profile = issuedSession || activeSession;
      if (!profile) throw new Error('请先创建 OpenIM 会话');
      const result = await sdk.initSDK({
        platformID: platformID(),
        apiAddr: profile.apiAddr,
        wsAddr: profile.wsAddr,
        dataDir,
        logFilePath,
        logLevel: 4,
        isLogStandardOutput: false,
        systemType: 'electron',
      });
      if (!result) {
        const status = await sdk.getLoginStatus();
        if (![2, 3].includes(Number(status?.data))) throw new Error('OpenIM SDK 初始化失败');
      }
      sdkInitialized = true;
      return result;
    }
    if (normalized === 'login') {
      const profile = issuedSession;
      const requested = args[0] && typeof args[0] === 'object' ? args[0] : {};
      if (!profile
        || String(requested.userID || '') !== String(profile.userID || '')
        || String(requested.token || '') !== String(profile.imToken || '')) {
        throw new Error('OpenIM 登录凭据与当前 Moss 账号不匹配');
      }
      const result = await sdk.login({ userID: profile.userID, token: profile.imToken });
      activeSession = profile;
      return result;
    }
    if (normalized === 'logout') {
      const result = await sdk.logout();
      activeSession = null;
      return result;
    }
    return sdk[normalized](...safeSdkArguments(normalized, args));
  });

  handle('openim:get-config', 'openim:client', () => ({
    available: !sdkError,
    error: sdkError,
    platformID: platformID(),
    dataDir,
    logFilePath,
    mediaCacheDir,
  }));

  handle('openim:create-session', 'openim:client', async () => {
    await ensureSession();
    return activeSession;
  });

  handle('openim:list-directory', 'openim:client', () => requestMossServer('/api/v1/directory'));

  handle('openim:prepare-direct-session', 'openim:client', (_event, payload = {}) => {
    const userID = String(payload.userID || '').trim();
    if (!userID) throw new Error('请选择联系人');
    return requestMossServer('/api/v1/im/direct-session', {
      method: 'POST',
      body: { user_id: userID },
    });
  });

  handle('openim:prepare-group-session', 'openim:client', (_event, payload = {}) => {
    const userIDs = Array.isArray(payload.userIDs)
      ? payload.userIDs.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    return requestMossServer('/api/v1/im/group-session', {
      method: 'POST',
      body: { user_ids: userIDs },
    });
  });

  handle('openim:pick-files', 'openim:files', async (_event, payload = {}) => {
    const kind = String(payload.kind || 'file');
    const response = await dialog.showOpenDialog({
      properties: ['openFile', ...(kind === 'file' || kind === 'image' ? ['multiSelections'] : [])],
      ...(FILE_FILTERS[kind] ? { filters: FILE_FILTERS[kind] } : {}),
    });
    if (response.canceled) return [];
    return response.filePaths.map((filePath) => {
      const approved = approveLocalFile(filePath);
      return {
        name: path.basename(approved.path),
        path: approved.path,
        size: approved.stat.size,
        mediaUrl: localMediaUrl(approved.path),
      };
    });
  });

  handle('openim:prepare-local-files', 'openim:files', (_event, payload = {}) => {
    if (!isTrustedClient(_event)) throw new Error('App 必须通过文件选择器或受控缓存使用本地附件');
    const files = Array.isArray(payload.files) ? payload.files.slice(0, 20) : [];
    return files.map((item) => {
      const approved = approveLocalFile(item?.path);
      return {
        name: path.basename(String(item?.name || path.basename(approved.path))),
        path: approved.path,
        size: approved.stat.size,
        mediaUrl: localMediaUrl(approved.path),
      };
    });
  });

  handle('openim:materialize-file', 'openim:files', (_event, payload = {}) => {
    const fileName = path.basename(String(payload.fileName || `openim-${Date.now()}`))
      .replaceAll(/[^\p{L}\p{N}._ -]/gu, '_')
      .slice(0, 240) || `openim-${Date.now()}`;
    let buffer;
    if (payload.data instanceof ArrayBuffer) buffer = Buffer.from(payload.data);
    else if (ArrayBuffer.isView(payload.data)) {
      buffer = Buffer.from(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength);
    } else if (Array.isArray(payload.data)) {
      if (payload.data.length > MAX_RENDERER_ATTACHMENT_BYTES) throw new Error('附件不能超过 100 MB');
      buffer = Buffer.from(payload.data);
    } else {
      throw new Error('附件内容无效');
    }
    if (!buffer.length || buffer.length > MAX_RENDERER_ATTACHMENT_BYTES) throw new Error('附件大小必须在 1 B 到 100 MB 之间');
    const targetPath = path.join(mediaCacheDir, `upload-${randomUUID()}-${fileName}`);
    fs.writeFileSync(targetPath, buffer, { mode: 0o600 });
    approveLocalFile(targetPath);
    return {
      name: fileName,
      path: targetPath,
      size: buffer.length,
      mediaUrl: localMediaUrl(targetPath),
    };
  });

  handle('openim:create-video-thumbnail', 'openim:files', async (_event, payload = {}) => {
    const filePath = requireApprovedLocalFile(payload.path);
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
    approveLocalFile(targetPath);
    return { path: targetPath, mediaUrl: localMediaUrl(targetPath) };
  });

  handle('openim:capture-screen', 'openim:screen-capture', async () => {
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
    approveLocalFile(targetPath);
    return {
      name: path.basename(targetPath),
      path: targetPath,
      size: buffer.length,
      mediaUrl: localMediaUrl(targetPath),
    };
  });

  handle('openim:download', 'openim:files', async (_event, payload = {}) => {
    const url = String(payload.url || '');
    const fileName = path.basename(String(payload.fileName || 'OpenIM-download'));
    if (!/^https?:\/\//i.test(url)) throw new Error('下载地址无效');
    const selected = await dialog.showSaveDialog({ defaultPath: fileName });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    const response = await fetchImpl(url);
    if (!response.ok) throw new Error(`下载失败 (${response.status})`);
    fs.writeFileSync(selected.filePath, Buffer.from(await response.arrayBuffer()));
    return { canceled: false, filePath: selected.filePath };
  });

  handle('openim:open-external', 'openim:client', (_event, rawUrl) => {
    const url = new URL(String(rawUrl || ''));
    if (!['http:', 'https:'].includes(url.protocol) || url.href.length > 4096) {
      throw new Error('只能打开 HTTP 或 HTTPS 链接');
    }
    return shell.openExternal(url.href);
  });

  handle('openim:get-rtc-token', 'openim:media', () => {
    throw new Error('音视频服务尚未配置');
  });

  return {
    ensureSession,
    sendText,
    getCurrentUserId() {
      return String(activeSession?.userID || '');
    },
    onEvent(listener) {
      if (typeof listener !== 'function') throw new TypeError('OpenIM event listener must be a function.');
      nativeEventListeners.add(listener);
      return () => nativeEventListeners.delete(listener);
    },
    attach(webContents) {
      if (!webContents || webContents.isDestroyed() || attachedWebContents.has(webContents.id)) return;
      const gatedTarget = {
        isDestroyed: () => webContents.isDestroyed(),
        send(channel, ...args) {
          try {
            authorizeClient({ sender: webContents }, 'openim:client', 'openim-sdk-ipc-event');
          } catch {
            return;
          }
          webContents.send(channel, ...args);
        },
      };
      attachedWebContents.set(webContents.id, gatedTarget);
      webContents.once('destroyed', () => {
        attachedWebContents.delete(webContents.id);
        if (sdkMain?.webContents) {
          sdkMain.webContents = sdkMain.webContents.filter((entry) => entry !== gatedTarget);
        }
      });
      try {
        ensureSdk().addWebContent(gatedTarget);
      } catch (error) {
        attachedWebContents.delete(webContents.id);
        sdkError = errorMessage(error);
        log('error', 'openim', 'Failed to initialize OpenIM Electron SDK', { error: sdkError });
      }
    },
  };
}
