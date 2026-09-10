import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  SUPPORTED_LIBRARY_EXTENSIONS,
} from './library-config.mjs';

const DIRECTORY_SELECTION_TTL_MS = 60 * 60 * 1_000;

export function registerLibraryIpcHandlers({
  ipcMain,
  dialog,
  shell,
  getWindow,
  service,
  extensions,
  prepareDirectoryImport,
  getExtensionGuideAcknowledged = () => false,
  acknowledgeExtensionGuide = () => {},
  log = () => {},
}) {
  let backgroundInstallation = null;
  const pendingDirectorySelections = new Map();
  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (_event, payload = {}) => handler(payload || {}));
  };

  handle('library:get-overview', () => service.getOverview());
  handle('library:get-extension-status', async () => ({
    ...await extensions.getStatus(),
    guideAcknowledged: getExtensionGuideAcknowledged() === true,
  }));
  handle('library:acknowledge-extension-guide', async () => {
    await acknowledgeExtensionGuide();
    return { acknowledged: true };
  });
  handle('library:install-extensions', async (payload) => {
    await acknowledgeExtensionGuide();
    if (!backgroundInstallation) {
      backgroundInstallation = extensions.install(payload.packageIds)
        .then(async () => {
          try {
            const repairJob = await service.repairIndex();
            return { repairJobId: repairJob.id };
          } catch (error) {
            log('error', 'library', 'Library index rebuild after extension installation failed', {
              error: error instanceof Error ? error.message : String(error),
            });
            return null;
          }
        })
        .catch((error) => {
          log('error', 'library', 'Background Library extension installation failed', {
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        })
        .finally(() => {
          backgroundInstallation = null;
        });
    }
    return {
      ...await extensions.getStatus(),
      guideAcknowledged: true,
      background: true,
    };
  });
  handle('library:list-collections', () => service.listCollections());
  handle('library:create-collection', (payload) => service.createCollection(payload));
  handle('library:update-collection', (payload) => service.updateCollection(payload));
  handle('library:delete-collection', (payload) => service.deleteCollection(payload));

  handle('library:list-sources', (payload) => service.listSources(payload));
  handle('library:add-project-source', (payload) => service.addProjectSource(payload));
  handle('library:remove-source', (payload) => service.removeSource(payload));
  handle('library:refresh-source', (payload) => service.refreshSource(payload));

  handle('library:pick-sources', async (payload) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '选择资料文件',
      properties: ['openFile', 'multiSelections'],
      filters: [{
        name: '支持的资料文件',
        extensions: SUPPORTED_LIBRARY_EXTENSIONS.map((extension) => extension.slice(1)),
      }],
    });
    if (result.canceled) return [];
    const sources = [];
    for (const filePath of result.filePaths) {
      sources.push(await service.addLocalSource({
        collectionId: payload.collectionId,
        path: filePath,
      }));
    }
    return sources;
  });

  handle('library:select-directory', async () => {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: '选择资料目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const directoryPath = path.resolve(result.filePaths[0]);
    const selectionId = randomUUID();
    const expiresAt = Date.now() + DIRECTORY_SELECTION_TTL_MS;
    pendingDirectorySelections.set(selectionId, {
      path: directoryPath,
      expiresAt,
    });
    const expiryTimer = setTimeout(() => pendingDirectorySelections.delete(selectionId), DIRECTORY_SELECTION_TTL_MS);
    expiryTimer.unref?.();
    return {
      selectionId,
      name: path.basename(directoryPath) || directoryPath,
      path: directoryPath,
    };
  });

  handle('library:prepare-directory-import', async (payload) => {
    const selectionId = String(payload.selectionId || '');
    const selection = pendingDirectorySelections.get(selectionId);
    if (!selection || selection.expiresAt < Date.now()) {
      pendingDirectorySelections.delete(selectionId);
      throw new Error('目录选择已失效，请重新选择目录。');
    }
    const collectionId = String(payload.collectionId || '');
    const collection = service.listCollections({ personalOnly: true })
      .find((entry) => entry.id === collectionId && entry.scope?.kind === 'personal');
    if (!collection) throw new Error('目标个人资料集不存在。');
    if (typeof prepareDirectoryImport !== 'function') throw new Error('资料整理任务暂不可用。');
    const prepared = prepareDirectoryImport({
      directoryPath: selection.path,
      directoryName: path.basename(selection.path) || selection.path,
      collection,
    });
    pendingDirectorySelections.delete(selectionId);
    return prepared;
  });

  handle('library:list-resources', (payload) => service.listResources(payload));
  handle('library:get-resource', (payload) => service.getResource(payload));
  handle('library:search', (payload) => service.search(payload));
  handle('library:diagnose-search', (payload) => service.diagnoseSearch(payload));
  handle('library:get-evaluation-overview', () => service.getEvaluationOverview());
  handle('library:save-evaluation-case', (payload) => service.saveEvaluationCase(payload));
  handle('library:delete-evaluation-case', (payload) => service.deleteEvaluationCase(payload));
  handle('library:run-evaluation', (payload) => service.runEvaluation(payload));
  handle('library:open-resource', async (payload) => {
    const resolved = await service.openResource({ resourceId: payload.resourceId });
    const error = await shell.openPath(resolved.path);
    if (error) throw new Error(error);
    return { ok: true };
  });
  handle('library:show-resource-in-folder', async (payload) => {
    const resolved = await service.openResource({ resourceId: payload.resourceId });
    shell.showItemInFolder(resolved.path);
    return { ok: true };
  });

  handle('library:list-jobs', (payload) => service.listJobs(payload));
  handle('library:cancel-job', (payload) => service.cancelJob(payload));
  handle('library:repair-index', () => service.repairIndex());
  handle('library:export', async (payload) => {
    const result = await dialog.showSaveDialog(getWindow(), {
      title: '导出资料库',
      defaultPath: payload.includeIndex ? 'moss-library-full-index.json' : 'moss-library-registrations.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const data = service.exportData({ includeIndex: payload.includeIndex === true });
    await fsp.writeFile(result.filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return { canceled: false };
  });
  handle('library:save-task-artifact', (payload) => service.saveTaskArtifact(payload));

  handle('library:get-migration-preview', () => service.getMigrationPreview());
  handle('library:migrate-legacy', () => service.migrateLegacy());
  handle('library:dismiss-legacy-migration', () => service.dismissLegacyMigration());
}
