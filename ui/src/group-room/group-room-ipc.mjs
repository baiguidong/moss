function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown Group Room error');
}

export function registerGroupRoomIpcHandlers({ ipcMain, isEnabled, createFeature }) {
  let feature = null;

  const disposeFeature = () => {
    try { feature?.dispose?.(); } catch {}
    feature = null;
  };

  const requireFeature = () => {
    if (!isEnabled()) {
      disposeFeature();
      throw new Error('Group Rooms are disabled in advanced settings.');
    }
    if (!feature) feature = createFeature();
    return feature.controller;
  };

  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (_event, payload = {}) => {
      try {
        return { success: true, data: await handler(requireFeature(), payload || {}) };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    });
  };

  ipcMain.handle('group-room:status', () => ({
    success: true,
    data: { enabled: Boolean(isEnabled()) },
  }));
  handle('group-room:list', (controller) => controller.listRooms());
  handle('group-room:get', (controller, payload) => controller.getRoom(payload.roomId));
  handle('group-room:list-resources', (controller) => controller.listResources());
  handle('group-room:create', (controller, payload) => controller.createRoom(payload));
  handle('group-room:update', (controller, payload) => controller.updateRoom(
    payload.roomId,
    payload.updates,
    payload.expectedRevision,
  ));
  handle('group-room:update-member-grants', (controller, payload) => controller.updateMemberGrants(
    payload.roomId,
    payload.memberId,
    payload.grants,
    payload.expectedRevision,
  ));
  handle('group-room:refresh-member-source', (controller, payload) => controller.refreshMemberSource(
    payload.roomId,
    payload.memberId,
    payload.expectedRevision,
  ));
  handle('group-room:add-members', (controller, payload) => controller.addMembers(
    payload.roomId,
    payload.members,
    payload.expectedRevision,
  ));
  handle('group-room:remove-member', (controller, payload) => controller.removeMember(
    payload.roomId,
    payload.memberId,
    payload.expectedRevision,
  ));
  handle('group-room:reorder', (controller, payload) => controller.reorder(payload.roomIds));
  handle('group-room:delete', async (controller, payload) => {
    await controller.deleteRoom(payload.roomId);
    return { roomId: payload.roomId };
  });

  return { dispose: disposeFeature };
}
