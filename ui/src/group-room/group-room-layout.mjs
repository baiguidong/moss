import path from 'node:path';

export const GROUP_ROOM_LAYOUT_VERSION = 1;

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
  const memberDir = (roomId, memberId) => path.join(
    roomDir(roomId),
    'members',
    normalizeId(memberId, 'member id'),
  );

  return Object.freeze({
    root,
    databasePath: path.join(root, 'rooms.sqlite'),
    roomDir,
    memberDir,
    memberEngineDir: (roomId, memberId) => path.join(memberDir(roomId, memberId), 'engine'),
    resourcesDir: (roomId) => path.join(roomDir(roomId), 'resources'),
  });
}
