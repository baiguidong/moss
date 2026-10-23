export function createAppUninstallHandler({ listApps, closeViews, appWindows, getRuntime, getConnectorHost, clearConnectorAuth, removePackage, emitChanged }) {
  return async (_event, { name, deleteData = false, deleteCredentials = false } = {}) => {
    try {
      if (typeof name !== 'string' || !name.trim()) throw new Error('Invalid App id')
      const entry = listApps().find(app => app.name === name || app.id === name)
      const appId = entry?.id || name
      if (typeof appId !== 'string' || !/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(appId)) throw new Error('Invalid App id')
      closeViews(appId)
      for (const [key, window] of appWindows.entries()) {
        if (key.startsWith(`${appId}:`) && !window.isDestroyed()) window.close()
      }
      const runtime = getRuntime()
      if (runtime) {
        if (deleteCredentials) await clearConnectorAuth(appId)
        await runtime.uninstall(appId, { deleteData, deleteCredentials })
        await getConnectorHost()?.remove(appId, { deleteData, deleteCredentials })
      }
      await removePackage(appId)
      await emitChanged({ action: 'deleted', name })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }
}
