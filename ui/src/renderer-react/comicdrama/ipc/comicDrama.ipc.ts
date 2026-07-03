/**
 * 漫剧模块 - IPC 客户端
 */

import type { ComicDramaAPI } from './types';

const invoke = <T>(channel: string, params?: unknown): Promise<T> =>
  window.agentDesktop.ipcInvoke(channel, params ?? {}) as Promise<T>;

function subscribe<T>(channel: string, cb: (data: T) => void): () => void {
  const wrapped = (window.agentDesktop.ipcOn as unknown as (
    channel: string,
    cb: (data: T) => void,
  ) => unknown)(channel, (data) => cb(data));
  return () => window.agentDesktop.ipcOff(channel, wrapped);
}

export const comicDramaAPI: ComicDramaAPI = {
  getComfyConfig: () => invoke('comicDrama:getComfyConfig'),
  saveComfyConfig: (patch) => invoke('comicDrama:saveComfyConfig', { patch }),
  pingComfy: (url) => invoke('comicDrama:pingComfy', { url }),
  listModels: (url) => invoke('comicDrama:listModels', { url }),
  checkSetup: (url) => invoke('comicDrama:checkSetup', { url }),
  pickAsset: (projectId, kind) => invoke('comicDrama:pickAsset', { projectId, kind }),

  listProjects: () => invoke('comicDrama:listProjects'),
  getProject: (projectId) => invoke('comicDrama:getProject', { projectId }),
  deleteProject: (projectId) => invoke('comicDrama:deleteProject', { projectId }),
  updateProject: (projectId, fields) => invoke('comicDrama:updateProject', { projectId, fields }),
  generateScript: (params) => invoke('comicDrama:generateScript', params),
  regenerateScript: (params) => invoke('comicDrama:regenerateScript', params),

  addCharacter: (projectId, fields) => invoke('comicDrama:addCharacter', { projectId, fields }),
  updateCharacter: (characterId, fields) => invoke('comicDrama:updateCharacter', { characterId, fields }),
  deleteCharacter: (characterId) => invoke('comicDrama:deleteCharacter', { characterId }),

  updateShot: (shotId, fields) => invoke('comicDrama:updateShot', { shotId, fields }),
  addShot: (projectId, fields) => invoke('comicDrama:addShot', { projectId, fields }),
  deleteShot: (shotId) => invoke('comicDrama:deleteShot', { shotId }),
  reorderShots: (projectId, orderedIds) => invoke('comicDrama:reorderShots', { projectId, orderedIds }),
  generateArt: (projectId, only) => invoke('comicDrama:generateArt', { projectId, only }),
  cancelArt: (projectId) => invoke('comicDrama:cancelArt', { projectId }),
  generateShot: (shotId) => invoke('comicDrama:generateShot', { shotId }),

  compose: (projectId, options) => invoke('comicDrama:compose', { projectId, options }),
  cancelCompose: (projectId) => invoke('comicDrama:cancelCompose', { projectId }),
  pickBgm: (projectId) => invoke('comicDrama:pickBgm', { projectId }),

  onArtProgress: (cb) => subscribe('comicDrama:artProgress', cb),
  onShotUpdated: (cb) => subscribe('comicDrama:shotUpdated', cb),
  onArtDone: (cb) => subscribe('comicDrama:artDone', cb),
  onComposeProgress: (cb) => subscribe('comicDrama:composeProgress', cb),
  onComposeDone: (cb) => subscribe('comicDrama:composeDone', cb),
  onComposeError: (cb) => subscribe('comicDrama:composeError', cb),
};

if (typeof window !== 'undefined') {
  (window as unknown as { comicDrama: ComicDramaAPI }).comicDrama = comicDramaAPI;
}

export default comicDramaAPI;
