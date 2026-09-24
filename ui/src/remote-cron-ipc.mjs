export function registerRemoteCronIpc({ ipcMain, request, syncSessions, findSession }) {
  ipcMain.handle('agent:cloud-cron-list', async () => {
    const result = await request('list');
    await syncSessions();
    return { tasks: (result.tasks || []).map(task => ({
      ...task,
      // Renderer navigation uses desktop record IDs, not server session IDs.
      ownerSessionId: findSession(task.ownerSessionId)?.id ?? null,
      executionSessionId: task.executionSessionId ? findSession(task.executionSessionId)?.id ?? null : null,
    })) };
  });
  for (const [action, operation] of [['toggle', 'enabled'], ['remove', 'delete'], ['run-now', 'run']]) {
    ipcMain.handle(`agent:cloud-cron-${action}`, (_event, payload) => request(operation, payload));
  }
}
