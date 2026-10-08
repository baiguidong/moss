import path from 'node:path';
import fs from 'node:fs';

export function ensureInsideRoot(rootPath, targetPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the active workspace.');
  }
  return resolvedTarget;
}

export function getSessionWorkspaceRoot(sessionRecord) {
  const candidate = sessionRecord.agentMode === 'remote-direct'
    ? sessionRecord.remoteWorkspace
    : sessionRecord.workspace;
  return typeof candidate === 'string' && candidate.trim()
    ? path.resolve(candidate.trim())
    : null;
}

export function applyRemoteSessionWorkspace(sessionRecord, workspace) {
  if (typeof workspace !== 'string' || !workspace.trim()) {
    return false;
  }
  const normalized = workspace.trim();
  const changed =
    sessionRecord.workspace !== normalized ||
    sessionRecord.remoteWorkspace !== normalized;
  sessionRecord.workspace = normalized;
  sessionRecord.remoteWorkspace = normalized;
  return changed;
}

export function isAccessibleDirectory(dirPath) {
  if (!dirPath) return false;
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}
