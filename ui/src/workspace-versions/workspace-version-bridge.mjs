import fs from 'node:fs';
import path from 'node:path';

export function workspacePathsOverlap(left, right) {
  if (!left || !right) return false;
  const normalize = value => {
    let result;
    try { result = fs.realpathSync(value); } catch { result = path.resolve(value); }
    return process.platform === 'win32' ? result.toLowerCase() : result;
  };
  const a = normalize(left);
  const b = normalize(right);
  const contains = (root, child) => {
    const relative = path.relative(root, child);
    return !relative || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  };
  return contains(a, b) || contains(b, a);
}

export function registerWorkspaceVersionIpcHandlers({ ipcMain, service, getSessionRecord, readWorkspaceFile, busyReason, onChanged }) {
  const local = sessionId => {
    const record = getSessionRecord(sessionId);
    if (record.agentMode === 'remote-direct') throw new Error('远程工作区暂不支持版本管理。');
    if (!record.workspace) throw new Error('当前会话没有工作区。');
    return record;
  };
  ipcMain.handle('workspace-versions:status', async (_event, { sessionId }) => {
    const record = getSessionRecord(sessionId);
    if (record.agentMode === 'remote-direct') return { supported: false, reason: '远程工作区暂不支持版本管理。' };
    return { ...await service.status(local(sessionId).workspace), supported: true, busyReason: busyReason(record.workspace) };
  });
  ipcMain.handle('workspace-versions:save', async (_event, { sessionId, label }) => {
    const record = local(sessionId);
    const result = await service.save(record.workspace, label);
    if (result.created) await onChanged(record.workspace, 'version-saved', result);
    return result;
  });
  ipcMain.handle('workspace-versions:files', async (_event, { sessionId, versionId }) => service.listFiles(local(sessionId).workspace, versionId));
  ipcMain.handle('workspace-versions:preview-file', async (_event, { sessionId, versionId, filePath }) => {
    const record = local(sessionId);
    const preview = await service.previewFile(record.workspace, versionId, filePath);
    const file = await readWorkspaceFile({ ...record, workspace: preview.root }, preview.path);
    return { ...file, metadata: { ...file.metadata, workspace: preview.root, previewEditable: false, previewSaveable: false, workspaceVersionId: versionId } };
  });
  ipcMain.handle('workspace-versions:preview-restore', async (_event, { sessionId, versionId }) => service.previewRestore(local(sessionId).workspace, versionId));
  ipcMain.handle('workspace-versions:restore', async (_event, { sessionId, versionId, token }) => {
    const record = local(sessionId);
    try {
      const result = await service.restore(record.workspace, versionId, token);
      await onChanged(record.workspace, 'version-restored', result);
      return result;
    } catch (error) {
      // A failed recovery can still have created a durable backup or changed disk contents.
      await onChanged(record.workspace, 'version-restore-failed');
      throw error;
    }
  });
}
