import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { decodeWorkspaceTextBuffer, getWorkspaceFilePreviewInfo, isBinaryPreviewContentType, isLikelyBinaryBuffer, MAX_WORKSPACE_TEXT_PREVIEW_BYTES } from '../../shared/workspace-preview.mjs';
import { ensureInsideRoot, getSessionWorkspaceRoot, isAccessibleDirectory } from './workspace-paths.mjs';
import { toRemoteWorkspaceUrl } from './remote-workspace-protocol.mjs';
import { downloadRemoteDirectWorkspaceFile } from './remote-direct-client.mjs';

export function createWorkspaceFileService({
  MAX_IMAGE_BASE64_BYTES,
  REMOTE_PREVIEW_CACHE_DIR,
  allowMediaRoot,
  assertWorkspaceVersionIdle,
  emitWorkspaceChanged,
  ensureRuntime,
  fetchRemoteDirectWorkspaceContent,
  fetchRemoteDirectWorkspaceDir,
  fetchRemoteDirectWorkspaceFile,
  mossLog,
  resolveRemoteDirectConnection,
  uploadRemoteDirectWorkspaceData,
  uploadRemoteDirectWorkspaceFile,
  writeRemoteDirectWorkspaceFile,
}) {
  const remoteAttachmentSources = new Map();
  const MAX_REMOTE_ATTACHMENT_SOURCE_BYTES = 64 * 1024 * 1024;
  let remoteAttachmentSourceBytes = 0;

  function remoteAttachmentKey(sessionRecord, remoteReference) {
    return `${sessionRecord.id}\0${remoteReference}`;
  }

  function rememberRemoteAttachmentSource(sessionRecord, remoteReference, source) {
    const key = remoteAttachmentKey(sessionRecord, remoteReference);
    const previous = remoteAttachmentSources.get(key);
    remoteAttachmentSourceBytes -= previous?.data?.byteLength || 0;
    remoteAttachmentSources.delete(key);
    remoteAttachmentSources.set(key, source);
    remoteAttachmentSourceBytes += source?.data?.byteLength || 0;
  }

  function takeRemoteAttachmentSource(sessionRecord, remoteReference) {
    const key = remoteAttachmentKey(sessionRecord, remoteReference);
    const source = remoteAttachmentSources.get(key);
    remoteAttachmentSources.delete(key);
    remoteAttachmentSourceBytes -= source?.data?.byteLength || 0;
    return source;
  }

  async function ensureRemoteSessionConnection(sessionRecord) {
    if (sessionRecord.agentMode !== 'remote-direct') {
      throw new Error('Session is not using Remote Direct mode.');
    }
    const runtime = await ensureRuntime(sessionRecord);
    if (typeof runtime?.ensureSession !== 'function') {
      throw new Error('Remote session runtime is not ready.');
    }
    const prepared = await runtime.ensureSession();
    if (!prepared?.config?.sessionId) {
      throw new Error('Remote session did not provide a session id.');
    }
    return prepared.config;
  }

  function getRemoteWorkspacePreviewUrls(sessionRecord, remoteFile) {
    const relativePath = String(remoteFile?.relativePath || '').replace(/\\/g, '/');
    if (!relativePath) return {};
    const directory = path.posix.dirname(relativePath);
    return {
      remoteContentUrl: toRemoteWorkspaceUrl(sessionRecord.id, relativePath),
      previewBaseUrl: toRemoteWorkspaceUrl(
        sessionRecord.id,
        directory === '.' ? '' : directory,
        { directory: true },
      ),
    };
  }

  function decorateRemoteWorkspaceFile(sessionRecord, remoteFile) {
    return {
      ...remoteFile,
      metadata: {
        ...(remoteFile?.metadata || {}),
        ...getRemoteWorkspacePreviewUrls(sessionRecord, remoteFile),
        remote: true,
      },
    };
  }

  async function fetchRemoteWorkspaceProtocolContent(sessionRecord, filePath, request) {
    const { serverUrl, authToken } = await resolveRemoteDirectConnection();
    const range = request.headers.get('range');
    return fetchRemoteDirectWorkspaceContent({
      serverUrl,
      authToken,
      sessionId: sessionRecord.underlyingSessionId,
      filePath,
      headers: range ? { range } : {},
    });
  }

  function pruneRemoteAttachmentSources() {
    while (
      remoteAttachmentSources.size > 100 ||
      remoteAttachmentSourceBytes > MAX_REMOTE_ATTACHMENT_SOURCE_BYTES
    ) {
      const key = remoteAttachmentSources.keys().next().value;
      if (typeof key !== 'string') break;
      const source = remoteAttachmentSources.get(key);
      remoteAttachmentSources.delete(key);
      remoteAttachmentSourceBytes -= source?.data?.byteLength || 0;
    }
  }

  async function uploadFileToRemoteSessionWorkspace(sessionRecord, {
    sourcePath,
    fileName,
    data,
  }) {
    const config = await ensureRemoteSessionConnection(sessionRecord);
    const remoteFile = data === undefined
      ? await uploadRemoteDirectWorkspaceFile({
          ...config,
          sourcePath,
          fileName: fileName || path.basename(sourcePath),
        })
      : await uploadRemoteDirectWorkspaceData({
          ...config,
          fileName,
          data,
        });
    const displayPath = toRemoteWorkspaceUrl(sessionRecord.id, remoteFile.relativePath);
    rememberRemoteAttachmentSource(sessionRecord, displayPath, data === undefined
      ? { sourcePath }
      : { data: Buffer.isBuffer(data) ? data : Buffer.from(data || []) });
    pruneRemoteAttachmentSources();
    emitWorkspaceChanged(sessionRecord, 'upload', remoteFile.path);
    return {
      ...remoteFile,
      path: displayPath,
      remotePath: remoteFile.path,
    };
  }

  async function writeWorkspaceFile(sessionRecord, filePath, content) {
    assertWorkspaceVersionIdle(sessionRecord);
    if (sessionRecord.agentMode === 'remote-direct') {
      const config = await ensureRemoteSessionConnection(sessionRecord);
      const remoteFile = await writeRemoteDirectWorkspaceFile({
        ...config,
        filePath,
        content,
      });
      emitWorkspaceChanged(sessionRecord, 'change', remoteFile.path);
      return decorateRemoteWorkspaceFile(sessionRecord, remoteFile);
    }
    const targetPath = ensureInsideRoot(sessionRecord.workspace, filePath);
    await fsp.writeFile(targetPath, String(content ?? ''), 'utf8');
    return readWorkspaceFile(sessionRecord, targetPath);
  }

  async function listDirectoryEntries(sessionRecord, dirPath) {
    if (sessionRecord.agentMode === 'remote-direct' && sessionRecord.underlyingSessionId) {
      try {
        const { serverUrl, authToken } = await resolveRemoteDirectConnection();
        return await fetchRemoteDirectWorkspaceDir({
          serverUrl,
          authToken,
          sessionId: sessionRecord.underlyingSessionId,
          dirPath,
        });
      } catch (error) {
        mossLog('warn', 'workspace', 'Remote workspace list failed', {
          sessionId: sessionRecord.id,
          underlyingSessionId: sessionRecord.underlyingSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const root = getSessionWorkspaceRoot(sessionRecord);
    if (sessionRecord.agentMode === 'remote-direct' && !isAccessibleDirectory(root)) {
      const remoteRoot = sessionRecord.remoteWorkspace || '(remote workspace)';
      return {
        root: remoteRoot,
        path: remoteRoot,
        relativePath: '.',
        items: [],
        remote: true,
        message: 'Remote Direct mode does not support browsing the remote workspace from this UI yet.',
      };
    }

    if (!root) {
      throw new Error('Session workspace is required.');
    }
    const targetPath = ensureInsideRoot(root, dirPath || root);
    const dirents = await fsp.readdir(targetPath, { withFileTypes: true });

    const items = dirents
      .filter((entry) => !entry.name.startsWith('.'))
      .map((entry) => {
        const fullPath = path.join(targetPath, entry.name);
        return {
          name: entry.name,
          path: fullPath,
          relativePath: path.relative(root, fullPath) || entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
        };
      })
      .sort((a, b) => {
        if (a.type !== b.type) {
          return a.type === 'directory' ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });

    return {
      root,
      path: targetPath,
      relativePath: path.relative(root, targetPath) || '.',
      items,
    };
  }

  async function readWorkspaceTextPrefix(targetPath, size) {
    const handle = await fsp.open(targetPath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(size, MAX_WORKSPACE_TEXT_PREVIEW_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async function readWorkspaceFile(sessionRecord, filePath) {
    if (sessionRecord.agentMode === 'remote-direct' && sessionRecord.underlyingSessionId) {
      try {
        const { serverUrl, authToken } = await resolveRemoteDirectConnection();
        const remoteFile = await fetchRemoteDirectWorkspaceFile({
          serverUrl,
          authToken,
          sessionId: sessionRecord.underlyingSessionId,
          filePath,
        });
        const decoratedRemoteFile = decorateRemoteWorkspaceFile(sessionRecord, remoteFile);
        const metadata = decoratedRemoteFile.metadata;
        if (isBinaryPreviewContentType(remoteFile.contentType)) {
          if (remoteFile.contentType === 'image' && remoteFile.size > MAX_IMAGE_BASE64_BYTES) {
            return {
              ...decoratedRemoteFile,
              contentType: 'unsupported',
              language: 'binary',
              metadata: { ...metadata, previewReason: 'too-large' },
              content: `Image is too large to preview (${remoteFile.size} bytes).`,
            };
          }
          const sourcePath = String(remoteFile.path || filePath);
          const rawExtension = path.extname(sourcePath);
          const extension = /^\.[a-z0-9]{1,12}$/i.test(rawExtension) ? rawExtension.toLowerCase() : '';
          const cacheKey = createHash('sha256')
            .update(`${sessionRecord.underlyingSessionId}\0${filePath}\0${remoteFile.size || 0}\0${metadata.modifiedAt || 0}`)
            .digest('hex');
          const localPreviewPath = path.join(REMOTE_PREVIEW_CACHE_DIR, `${cacheKey}${extension}`);
          let cached = false;
          try {
            const localStat = await fsp.stat(localPreviewPath);
            cached = localStat.isFile() && localStat.size === remoteFile.size;
          } catch {}
          if (!cached) {
            await downloadRemoteDirectWorkspaceFile({
              serverUrl,
              authToken,
              sessionId: sessionRecord.underlyingSessionId,
              filePath,
              destinationPath: localPreviewPath,
            });
          }
          metadata.localPreviewPath = localPreviewPath;
        }
        return { ...decoratedRemoteFile, metadata };
      } catch (error) {
        mossLog('warn', 'workspace', 'Remote workspace read failed', {
          sessionId: sessionRecord.id,
          underlyingSessionId: sessionRecord.underlyingSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `Failed to read remote workspace file: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    }

    const root = getSessionWorkspaceRoot(sessionRecord);
    if (sessionRecord.agentMode === 'remote-direct' && !isAccessibleDirectory(root)) {
      throw new Error('Remote Direct mode does not support reading remote workspace files from this UI yet.');
    }
    if (!root) {
      throw new Error('Session workspace is required.');
    }

    const targetPath = ensureInsideRoot(root, filePath);
    const [realRoot, realTargetPath] = await Promise.all([
      fsp.realpath(root),
      fsp.realpath(targetPath),
    ]);
    ensureInsideRoot(realRoot, realTargetPath);
    allowMediaRoot(realRoot);
    const stat = await fsp.stat(targetPath);
    if (!stat.isFile()) {
      throw new Error('Target is not a file.');
    }
    const previewInfo = getWorkspaceFilePreviewInfo(targetPath);
    const baseResult = {
      path: targetPath,
      relativePath: path.relative(root, targetPath),
      size: stat.size,
      truncated: false,
      contentType: previewInfo.contentType,
      language: previewInfo.language,
      mimeType: previewInfo.mimeType,
      metadata: {
        modifiedAt: stat.mtimeMs,
        ...(previewInfo.previewEngine ? { previewEngine: previewInfo.previewEngine } : {}),
        ...(previewInfo.previewFamily ? { previewFamily: previewInfo.previewFamily } : {}),
        ...(previewInfo.previewCapability ? { previewCapability: previewInfo.previewCapability } : {}),
        ...(previewInfo.contentType === 'ofv' && previewInfo.binary === false ? { ofvText: true } : {}),
      },
    };

    if (previewInfo.contentType === 'image' && stat.size > MAX_IMAGE_BASE64_BYTES) {
      return {
        ...baseResult,
        contentType: 'unsupported',
        language: 'binary',
        metadata: {
          ...baseResult.metadata,
          previewEditable: false,
          previewSaveable: false,
          previewReason: 'too-large',
        },
        content: `Image is too large to preview (${stat.size} bytes).`,
      };
    }

    const isBinaryPreview = typeof previewInfo.binary === 'boolean'
      ? previewInfo.binary
      : isBinaryPreviewContentType(previewInfo.contentType);
    if (isBinaryPreview) {
      return {
        ...baseResult,
        metadata: {
          ...baseResult.metadata,
          previewEditable: false,
          previewSaveable: false,
        },
        content: '',
      };
    }

    const buffer = await readWorkspaceTextPrefix(targetPath, stat.size);
    if (isLikelyBinaryBuffer(buffer)) {
      return {
        ...baseResult,
        contentType: 'unsupported',
        language: 'binary',
        metadata: {
          ...baseResult.metadata,
          previewEditable: false,
          previewSaveable: false,
          previewReason: 'binary',
        },
        content: 'Binary file preview is not supported in this app.',
      };
    }

    return {
      ...baseResult,
      truncated: stat.size > MAX_WORKSPACE_TEXT_PREVIEW_BYTES,
      metadata: stat.size > MAX_WORKSPACE_TEXT_PREVIEW_BYTES
        ? {
            ...baseResult.metadata,
            previewEditable: false,
            previewSaveable: false,
            previewReason: 'truncated',
          }
        : baseResult.metadata,
      content: decodeWorkspaceTextBuffer(buffer, stat.size > MAX_WORKSPACE_TEXT_PREVIEW_BYTES),
    };
  }

  return {
    ensureRemoteSessionConnection,
    fetchRemoteWorkspaceProtocolContent,
    listDirectoryEntries,
    readWorkspaceFile,
    uploadFileToRemoteSessionWorkspace,
    writeWorkspaceFile,
    takeRemoteAttachmentSource,
  };
}
