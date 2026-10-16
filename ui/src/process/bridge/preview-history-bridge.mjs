import { hostIpc as ipcMain } from '../../host/ipc.mjs';
import electron from 'electron';
import { previewHistoryService } from '../services/preview-history-service.mjs';



export function registerPreviewHistoryIpcHandlers() {
  ipcMain.handle('previewHistory.list', async (_event, { target }) => {
    return await previewHistoryService.list(target);
  });

  ipcMain.handle('previewHistory.save', async (_event, { target, content }) => {
    return await previewHistoryService.save(target, content);
  });

  ipcMain.handle('previewHistory.getContent', async (_event, { target, snapshotId }) => {
    return await previewHistoryService.getContent(target, snapshotId);
  });
}
