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
        const serviceHost = getConnectorHost(), options = { deleteData, deleteCredentials }
        if (serviceHost?.uninstall) await serviceHost.uninstall(appId, options, () => runtime.uninstall(appId, options))
        else {
          await runtime.uninstall(appId, options)
          await serviceHost?.remove(appId, options)
        }
      }
      await removePackage(appId)
      await emitChanged({ action: 'deleted', name })
      return { ok: true }
    } catch (error) {
      return { ok: false, error: String(error) }
    }
  }
}
