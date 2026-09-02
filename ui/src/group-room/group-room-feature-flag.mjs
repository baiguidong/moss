export function isGroupRoomOnlySettingsUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const keys = Object.keys(payload);
  if (keys.length !== 1 || keys[0] !== 'advanced') return false;
  const advanced = payload.advanced;
  return Boolean(
    advanced
    && typeof advanced === 'object'
    && !Array.isArray(advanced)
    && Object.keys(advanced).length === 1
    && Object.prototype.hasOwnProperty.call(advanced, 'moss_group_rooms'),
  );
}
