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
  handle('group-room:list-pending-permissions', (controller) => controller.listPendingPermissions());
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
  handle('group-room:dispatch', (controller, payload) => controller.dispatch(payload.roomId, payload));
  handle('group-room:suggest-moderation', (controller, payload) => controller.suggestModeration(payload.roomId, payload.content));
  handle('group-room:intervene', (controller, payload) => controller.intervene(payload.roomId, payload));
  handle('group-room:stop', (controller, payload) => controller.stop(payload.roomId));
  handle('group-room:stop-member', (controller, payload) => controller.stopMember(payload.roomId, payload.memberId));
  handle('group-room:delete', async (controller, payload) => {
    await controller.deleteRoom(payload.roomId);
    return { roomId: payload.roomId };
  });
  handle('group-room:resolve-permission', (controller, payload) => {
    controller.resolvePermission(payload.requestId, payload.allowed === true);
    return { requestId: payload.requestId };
  });

  return { dispose: disposeFeature };
}
