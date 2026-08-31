import { installAppArchive } from './desktop-app-runtime.mjs'

const MOVE_HEALTH_STABILITY_MS = 250

async function waitForStableDeployment(readStatuses, label) {
  await new Promise((resolve) => setTimeout(resolve, MOVE_HEALTH_STABILITY_MS))
  const statuses = await readStatuses()
  if (!statuses.some((item) => item.runtime?.state === 'running')) {
    const detail = statuses.map((item) => item.runtime?.lastError).find(Boolean)
    throw new Error(`${label} App Backend did not remain healthy${detail ? `: ${detail}` : ''}`)
  }
}

export function registerAppRuntimeIpc(options) {
  const { ipcMain, dialog, getRuntime, emitChanged, installArchivePackage, remote } = options
  const runtime = () => {
    const value = getRuntime()
    if (!value) throw new Error('Desktop App Runtime is not ready')
    return value
  }
  const changed = async (action, appId, result) => {
    await emitChanged?.({
      action,
      appId,
      ...(result?.currentVersion ? { app: result } : {}),
    })
    return result
  }

  ipcMain.handle('app:install-archive', async () => {
    const selection = await dialog.showOpenDialog({
      title: 'Install Moss App', properties: ['openFile'], filters: [{ name: 'Moss App archive', extensions: ['zip'] }],
    })
    if (selection.canceled || !selection.filePaths[0]) return { ok: false, canceled: true }
    const app = await installAppArchive(runtime(), selection.filePaths[0], {
      installPackage: installArchivePackage,
    })
    const appId = app.id || app.manifest?.id
    return { ok: true, app: await changed('installed', appId, app) }
  })
  ipcMain.handle('app:install-server', async (_event, { appId, version }) => {
    const result = await remote.installApp(appId, version)
    return changed('server-installed', appId, result)
  })
  ipcMain.handle('app:uninstall-server', async (_event, { appId, ...removeOptions }) => {
    const result = await remote.uninstallApp(appId, removeOptions)
    return changed('server-uninstalled', appId, result)
  })
  ipcMain.handle('app:get-runtime-state', async (_event, { appId, target = 'desktop' }) => target === 'server'
    ? (await remote.listApps()).find((item) => item.installation?.appId === appId) || null
    : runtime().getApp(appId))
  ipcMain.handle('app:set-enabled', async (_event, { appId, enabled, target = 'desktop' }) => changed('enabled', appId,
    target === 'server' ? remote.updateApp(appId, { enabled }) : runtime().setAppEnabled(appId, enabled)))
  ipcMain.handle('app:list-instances', async (_event, { appId, target = 'desktop' }) => target === 'server'
    ? ((await remote.listApps()).find((item) => item.installation?.appId === appId)?.instances || [])
    : runtime().listInstances(appId))
  ipcMain.handle('app:create-instance', async (_event, { appId, target = 'desktop', ...input }) => changed('instance-created', appId,
    target === 'server' ? remote.createInstance(appId, input) : runtime().createInstance(appId, input)))
  ipcMain.handle('app:update-instance', async (_event, { appId, instanceId, target = 'desktop', ...patch }) => changed('instance-updated', appId,
    target === 'server' ? remote.updateInstance(appId, instanceId, patch) : runtime().updateInstance(appId, instanceId, patch)))
  ipcMain.handle('app:set-instance-enabled', async (_event, { appId, instanceId, enabled, target = 'desktop' }) => changed('instance-enabled', appId,
    target === 'server' ? remote.updateInstance(appId, instanceId, { enabled }) : runtime().setInstanceEnabled(appId, instanceId, enabled)))
  ipcMain.handle('app:clear-instance-credentials', async (_event, { appId, instanceId, target = 'desktop' }) => changed('instance-credentials-cleared', appId,
    target === 'server'
      ? remote.updateInstance(appId, instanceId, { clearCredentials: true })
      : runtime().clearInstanceCredentials(appId, instanceId)))
  ipcMain.handle('app:remove-instance', async (_event, { appId, instanceId, target = 'desktop', ...removeOptions }) => {
    if (target === 'server') await remote.removeInstance(appId, instanceId, removeOptions)
    else await runtime().removeInstance(appId, instanceId, removeOptions)
    return changed('instance-removed', appId, { ok: true })
  })
  ipcMain.handle('app:restart-instance', (_event, { appId, instanceId, target = 'desktop' }) => target === 'server'
    ? remote.restartInstance(appId, instanceId)
    : runtime().restartInstance(appId, instanceId))
  ipcMain.handle('app:get-instance-logs', (_event, { appId, instanceId, limit, target = 'desktop' }) => target === 'server'
    ? remote.getLogs(appId, instanceId, limit)
    : runtime().getLogs(appId, instanceId, { limit }))

  ipcMain.handle('app:move-instance', async (_event, payload) => {
    const { appId, instanceId, from, to, secrets = {}, deleteSourceCredentials = false } = payload
    if (from === to) throw new Error('Source and target App Hosts are the same')
    if (from === 'desktop' && to === 'server') {
      const app = await runtime().getApp(appId)
      if (!app) throw new Error('Desktop App is not installed')
      const instance = runtime().requireInstance(appId, instanceId)
      const shouldRunOnTarget = Boolean(app.installation.enabled && instance.enabled)
      let remoteApp = (await remote.listApps()).find((item) => item.installation?.appId === appId)
      if (remoteApp && remoteApp.installation.activeVersion !== app.installation.activeVersion) {
        throw new Error('Desktop and Server must use the same App version before moving the instance')
      }
      if (!remoteApp) {
        await remote.installApp(appId, app.installation.activeVersion)
        remoteApp = (await remote.listApps()).find((item) => item.installation?.appId === appId)
      }
      const secretValues = await runtime().credentials.get(appId, instanceId)
      const remoteInstance = remoteApp?.instances?.find((item) => item.id === instanceId)
      if (remoteInstance) await remote.updateInstance(appId, instanceId, { displayName: instance.displayName, config: instance.config, secrets: secretValues, enabled: false })
      else await remote.createInstance(appId, { id: instance.id, displayName: instance.displayName, config: instance.config, secrets: secretValues, enabled: false })
      if (instance.enabled) await runtime().setInstanceEnabled(appId, instanceId, false)
      try {
        if (shouldRunOnTarget) {
          await remote.updateApp(appId, { enabled: true })
          await remote.updateInstance(appId, instanceId, { enabled: true })
          if (remoteApp.manifest.backend?.lifecycle === 'persistent') {
            await waitForStableDeployment(async () => {
              const refreshed = (await remote.listApps()).find((item) => item.installation?.appId === appId)
              return refreshed?.deployments?.filter((item) => item.deployment?.instanceId === instanceId) || []
            }, 'Server')
          }
        }
      } catch (error) {
        await remote.updateInstance(appId, instanceId, { enabled: false }).catch(() => {})
        await runtime().setInstanceEnabled(appId, instanceId, instance.enabled).catch(() => {})
        throw error
      }
      if (app.manifest.backend?.instanceMode === 'multiple') {
        await runtime().removeInstance(appId, instanceId, { deleteCredentials: deleteSourceCredentials, deleteData: false })
      } else if (deleteSourceCredentials) {
        await runtime().clearInstanceCredentials(appId, instanceId)
      }
      return changed('instance-moved', appId, { ok: true, target: 'server', instanceId })
    }

    const localApp = await runtime().getApp(appId)
    if (!localApp) throw new Error('Install the same App version on Desktop before moving from Server')
    const remoteApp = (await remote.listApps()).find((item) => item.installation?.appId === appId)
    if (localApp.installation.activeVersion !== remoteApp?.installation?.activeVersion) {
      throw new Error('Desktop and Server must use the same App version before moving the instance')
    }
    const remoteInstance = remoteApp?.instances?.find((item) => item.id === instanceId)
    if (!remoteInstance) throw new Error('Server App instance was not found')
    const shouldRunOnTarget = Boolean(remoteApp.installation.enabled && remoteInstance.enabled)
    const localInstance = localApp.instances.find((item) => item.id === instanceId)
    const preservedSecrets = Object.keys(secrets).length
      ? secrets
      : await runtime().credentials.get(appId, instanceId)
    if (localInstance) {
      if (localInstance.enabled) await runtime().setInstanceEnabled(appId, instanceId, false)
      await runtime().updateInstance(appId, instanceId, {
        displayName: remoteInstance.displayName,
        config: remoteInstance.config,
        ...(Object.keys(preservedSecrets).length ? { secrets: preservedSecrets } : {}),
      })
    }
    else await runtime().createInstance(appId, {
      id: instanceId,
      displayName: remoteInstance.displayName,
      config: remoteInstance.config,
      ...(Object.keys(preservedSecrets).length ? { secrets: preservedSecrets } : {}),
      enabled: false,
    })
    if (remoteInstance.enabled) await remote.updateInstance(appId, instanceId, { enabled: false })
    try {
      if (shouldRunOnTarget) {
        await runtime().setAppEnabled(appId, true)
        await runtime().setInstanceEnabled(appId, instanceId, true)
        if (localApp.manifest.backend?.lifecycle === 'persistent') {
          await waitForStableDeployment(
            () => runtime().getInstanceStatus(appId, instanceId),
            'Desktop',
          )
        }
      }
    } catch (error) {
      await runtime().setInstanceEnabled(appId, instanceId, false).catch(() => {})
      await remote.updateInstance(appId, instanceId, { enabled: remoteInstance.enabled }).catch(() => {})
      throw error
    }
    if (remoteApp.manifest.backend?.instanceMode === 'multiple') {
      await remote.removeInstance(appId, instanceId, { deleteCredentials: deleteSourceCredentials, deleteData: false })
    } else if (deleteSourceCredentials) {
      await remote.updateInstance(appId, instanceId, { clearCredentials: true })
    }
    return changed('instance-moved', appId, { ok: true, target: 'desktop', instanceId })
  })
}
