import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function isInsideRoot(root, target) {
  const relative = path.posix.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.posix.isAbsolute(relative));
}

export function resolveRemoteWorkspaceFileUrl(rawUrl, remoteWorkspace) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return null;
  if (typeof remoteWorkspace !== 'string' || !remoteWorkspace.trim()) return null;

  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'file:') return null;
  if (parsed.hostname && parsed.hostname !== 'localhost') {
    throw new Error('Remote browser file URL cannot use a network host.');
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    throw new Error('Remote browser file URL is invalid.');
  }
  const root = path.posix.resolve(remoteWorkspace.trim());
  const remotePath = path.posix.resolve(decodedPath);
  if (!isInsideRoot(root, remotePath)) {
    throw new Error('Remote browser file must stay inside the session workspace.');
  }
  return {
    remotePath,
    relativePath: path.posix.relative(root, remotePath),
  };
}

export async function materializeRemoteBrowserFile({
  rawUrl,
  remoteWorkspace,
  cacheDir,
  sessionId,
  download,
}) {
  const resolved = resolveRemoteWorkspaceFileUrl(rawUrl, remoteWorkspace);
  if (!resolved) return null;

  const extension = path.extname(resolved.remotePath);
  const safeExtension = /^\.[a-z0-9]{1,12}$/i.test(extension)
    ? extension.toLowerCase()
    : '';
  const cacheKey = createHash('sha256')
    .update(`${sessionId}\0${resolved.remotePath}`)
    .digest('hex');
  const localPath = path.join(cacheDir, `${cacheKey}${safeExtension}`);
  await download(resolved.remotePath, localPath);

  return {
    ...resolved,
    localPath,
    localUrl: pathToFileURL(localPath).href,
  };
}
