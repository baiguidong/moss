import { connectorIdFromApp } from '../../../packages/app-sdk/src/discovery.mjs'
import { activateConnectorApp, removeConnectorAppData } from '../connector-hub-ipc.mjs'

/** Runs packages installed from moss-apps. No catalog, installation or migration. */
export function createConnectorAppHost({ getRuntime, isCurrentActivation = () => false }) {
  const queues = new Map()
  const identities = new Map()
  function enqueue(appId, action) {
    const task = (queues.get(appId) || Promise.resolve()).catch(() => {}).then(action)
    queues.set(appId, task)
    void task.finally(() => { if (queues.get(appId) === task) queues.delete(appId) }).catch(() => {})
    return task
  }
  async function refresh(appId, manifestHint = null) {
    const runtime = getRuntime()
    if (!runtime) return
    for (const installation of runtime.installations.list()) {
      if (appId && installation.appId !== appId) continue
      await enqueue(installation.appId, async () => {
        if (!runtime.getInstallation(installation.appId)) return
        const hintedConnectorId = connectorIdFromApp(manifestHint)
        if (hintedConnectorId && isCurrentActivation(installation.appId, installation.activeVersion, hintedConnectorId)) {
          identities.set(installation.appId, hintedConnectorId)
          return
        }
        const pkg = await runtime.getActivePackage(installation.appId)
        const id = connectorIdFromApp(pkg.manifest)
        if (!id) return
        identities.set(installation.appId, id)
        await activateConnectorApp(pkg,
          () => runtime.getInstallation(installation.appId)?.activeVersion === pkg.manifest.version)
      })
    }
  }
  async function remove(appId, options = {}) {
    await enqueue(appId, async () => {
      const runtime = getRuntime()
      const pkg = await runtime?.getActivePackage?.(appId).catch(() => null)
      const id = connectorIdFromApp(pkg?.manifest) || identities.get(appId)
      if (!id) return
      await removeConnectorAppData(id, options)
      identities.delete(appId)
    })
  }
  return { refresh, remove }
}
