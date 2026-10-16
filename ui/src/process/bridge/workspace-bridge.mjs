import { hostIpc as ipcMain } from '../../host/ipc.mjs';
import electron from 'electron';



export function registerWorkspaceIpcHandlers({
  getSessionRecord,
  writeWorkspaceFile,
}) {
  ipcMain.handle('workspace.write-file', async (_event, { sessionId, filePath, content }) => {
    const sessionRecord = getSessionRecord(sessionId);
    return writeWorkspaceFile(sessionRecord, filePath, content);
  });
}
