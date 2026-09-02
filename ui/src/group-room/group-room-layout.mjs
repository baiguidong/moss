import path from 'node:path';

function normalizeId(value, label) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(normalized)) {
    throw new Error(`Invalid ${label}.`);
  }
  return normalized;
}

export function createGroupRoomDataPaths(mossHome) {
  const root = path.join(path.resolve(mossHome), 'group-rooms');
  const roomDir = (roomId) => path.join(root, normalizeId(roomId, 'room id'));

  return Object.freeze({
    root,
    databasePath: path.join(root, 'rooms.sqlite'),
    roomDir,
    resourcesDir: (roomId) => path.join(roomDir(roomId), 'resources'),
  });
}
