import { installAppArchive } from './desktop-app-runtime.mjs'
import { validateAppPackage } from '../../../packages/app-runtime/src/index.mjs'

const MOVE_HEALTH_STABILITY_MS = 250
const INSTALL_PERMISSION_CANCELLED = 'MOSS_APP_INSTALL_PERMISSION_CANCELLED'

function remoteOptionsForApp(app) {
  return { ownerScope: app?.manifest?.backend?.serverOwnerScope || 'user' }
}

async function waitForStableDeployment(readStatuses, label) {
  await new Promise((resolve) => setTimeout(resolve, MOVE_HEALTH_STABILITY_MS))
  const statuses = await readStatuses()
  if (!statuses.some((item) => item.runtime?.state === 'running')) {
    const detail = statuses.map((item) => item.runtime?.lastError).find(Boolean)
    throw new Error(`${label} App Backend did not remain healthy${detail ? `: ${detail}` : ''}`)
  }
}

export function registerAppRuntimeIpc(options) {
  const {
    ipcMain,
    dialog,
    getRuntime,
    emitChanged,
    installArchivePackage,
    remote,
    installArchive = installAppArchive,
    validatePackage = validateAppPackage,
  } = options
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
    const previousGrants = new Map(runtime().installations.list().map((installation) => [
      installation.appId,
      installation.grants || [],
    ]))
    let approvedGrants = []
    let app
    try {
      app = await installArchive(runtime(), selection.filePaths[0], {
        installPackage: async (packageRoot) => {
          const packageInfo = await validatePackage(packageRoot)
          const appId = packageInfo.manifest.id
          const currentGrants = previousGrants.get(appId) || []
          const addedPermissions = (packageInfo.manifest.permissions || [])
            .filter((permission) => !currentGrants.includes(permission))
          if (addedPermissions.length) {
            const confirmation = await dialog.showMessageBox({
              type: 'question',
              title: '安装 Moss App',
              message: `“${packageInfo.manifest.displayName || appId}”需要以下权限`,
              detail: addedPermissions.map((permission) => `• ${permission}`).join('\n'),
              buttons: ['取消', '安装并授权'],
              defaultId: 1,
              cancelId: 0,
              noLink: true,
            })
            if (confirmation.response !== 1) {
              throw Object.assign(new Error('App installation permission approval was canceled'), {
                code: INSTALL_PERMISSION_CANCELLED,
              })
            }
          }
          const declaredPermissions = new Set(packageInfo.manifest.permissions || [])
          const retainedGrants = currentGrants.filter((permission) => declaredPermissions.has(permission))
          approvedGrants = [...new Set([...retainedGrants, ...addedPermissions])]
          return installArchivePackage(packageRoot)
        },
      })
    } catch (error) {
      if (error?.code === INSTALL_PERMISSION_CANCELLED) return { ok: false, canceled: true }
      throw error
    }
    const appId = app.id || app.manifest?.id
    const version = app.currentVersion || app.version || app.manifest?.version
    if (!appId || !version) throw new Error('Installed App package did not return an identity and version')
    await runtime().registerInstalled(appId, version, { grants: approvedGrants })
    return { ok: true, app: await changed('installed', appId, app) }
  })
  ipcMain.handle('app:install-server', async (_event, { appId, version }) => {
    const local = await runtime().getApp(appId)
    const result = await remote.installApp(
      appId,
      version,
      local?.installation?.grants || [],
      remoteOptionsForApp(local),
    )
    return changed('server-installed', appId, result)
  })
  ipcMain.handle('app:uninstall-server', async (_event, { appId, ...removeOptions }) => {
    const local = await runtime().getApp(appId)
    const result = await remote.uninstallApp(appId, { ...removeOptions, ...remoteOptionsForApp(local) })
    return changed('server-uninstalled', appId, result)
  })
  ipcMain.handle('app:get-runtime-state', async (_event, { appId, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return target === 'server'
      ? (await remote.listApps(remoteOptionsForApp(local))).find((item) => item.installation?.appId === appId) || null
      : local
  })
  ipcMain.handle('app:list-contributions', (_event, options = {}) => runtime().listContributions(options))
  ipcMain.handle('app:invoke-contribution', (_event, { kind, id, input, ...invokeOptions }) => {
    if (!['commands', 'resourceProviders'].includes(kind)) {
      throw new Error(`Desktop UI cannot invoke App contribution kind: ${kind}`)
    }
    return runtime().invokeContribution(kind, id, input, invokeOptions)
  })
  ipcMain.handle('app:set-enabled', async (_event, { appId, enabled, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return changed('enabled', appId, target === 'server'
      ? remote.updateApp(appId, { enabled }, remoteOptionsForApp(local))
      : runtime().setAppEnabled(appId, enabled))
  })
  ipcMain.handle('app:set-grants', async (_event, { appId, grants, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return changed('grants', appId, target === 'server'
      ? remote.updateApp(appId, { grants }, remoteOptionsForApp(local))
      : runtime().setAppGrants(appId, grants))
  })
  ipcMain.handle('app:list-instances', async (_event, { appId, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return target === 'server'
      ? ((await remote.listApps(remoteOptionsForApp(local))).find((item) => item.installation?.appId === appId)?.instances || [])
      : runtime().listInstances(appId)
  })
  ipcMain.handle('app:create-instance', async (_event, { appId, target = 'desktop', ...input }) => {
    const local = await runtime().getApp(appId)
    return changed('instance-created', appId, target === 'server'
      ? remote.createInstance(appId, input, remoteOptionsForApp(local))
      : runtime().createInstance(appId, input))
  })
  ipcMain.handle('app:update-instance', async (_event, { appId, instanceId, target = 'desktop', ...patch }) => {
    const local = await runtime().getApp(appId)
    return changed('instance-updated', appId, target === 'server'
      ? remote.updateInstance(appId, instanceId, patch, remoteOptionsForApp(local))
      : runtime().updateInstance(appId, instanceId, patch))
  })
  ipcMain.handle('app:set-instance-enabled', async (_event, { appId, instanceId, enabled, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return changed('instance-enabled', appId, target === 'server'
      ? remote.updateInstance(appId, instanceId, { enabled }, remoteOptionsForApp(local))
      : runtime().setInstanceEnabled(appId, instanceId, enabled))
  })
  ipcMain.handle('app:clear-instance-credentials', async (_event, { appId, instanceId, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return changed('instance-credentials-cleared', appId, target === 'server'
      ? remote.updateInstance(appId, instanceId, { clearCredentials: true }, remoteOptionsForApp(local))
      : runtime().clearInstanceCredentials(appId, instanceId))
  })
  ipcMain.handle('app:remove-instance', async (_event, { appId, instanceId, target = 'desktop', ...removeOptions }) => {
    const local = await runtime().getApp(appId)
    if (target === 'server') await remote.removeInstance(appId, instanceId, { ...removeOptions, ...remoteOptionsForApp(local) })
    else await runtime().removeInstance(appId, instanceId, removeOptions)
    return changed('instance-removed', appId, { ok: true })
  })
  ipcMain.handle('app:restart-instance', async (_event, { appId, instanceId, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return target === 'server'
      ? remote.restartInstance(appId, instanceId, remoteOptionsForApp(local))
      : runtime().restartInstance(appId, instanceId)
  })
  ipcMain.handle('app:get-instance-logs', async (_event, { appId, instanceId, limit, target = 'desktop' }) => {
    const local = await runtime().getApp(appId)
    return target === 'server'
      ? remote.getLogs(appId, instanceId, limit, remoteOptionsForApp(local))
      : runtime().getLogs(appId, instanceId, { limit })
  })

  ipcMain.handle('app:move-instance', async (_event, payload) => {
    const { appId, instanceId, from, to, secrets = {}, deleteSourceCredentials = false } = payload
    if (from === to) throw new Error('Source and target App Hosts are the same')
    if (from === 'desktop' && to === 'server') {
      const app = await runtime().getApp(appId)
      if (!app) throw new Error('Desktop App is not installed')
      const instance = runtime().requireInstance(appId, instanceId)
      const shouldRunOnTarget = Boolean(app.installation.enabled && instance.enabled)
      const remoteOptions = remoteOptionsForApp(app)
      let remoteApp = (await remote.listApps(remoteOptions)).find((item) => item.installation?.appId === appId)
      if (remoteApp && remoteApp.installation.activeVersion !== app.installation.activeVersion) {
        throw new Error('Desktop and Server must use the same App version before moving the instance')
      }
      if (!remoteApp) {
        await remote.installApp(appId, app.installation.activeVersion, app.installation.grants || [], remoteOptions)
        remoteApp = (await remote.listApps(remoteOptions)).find((item) => item.installation?.appId === appId)
      }
      const secretValues = await runtime().credentials.get(appId, instanceId)
      const remoteInstance = remoteApp?.instances?.find((item) => item.id === instanceId)
      if (remoteInstance) await remote.updateInstance(appId, instanceId, { displayName: instance.displayName, config: instance.config, secrets: secretValues, enabled: false }, remoteOptions)
      else await remote.createInstance(appId, { id: instance.id, displayName: instance.displayName, config: instance.config, secrets: secretValues, enabled: false }, remoteOptions)
      if (instance.enabled) await runtime().setInstanceEnabled(appId, instanceId, false)
      try {
        if (shouldRunOnTarget) {
          await remote.updateApp(appId, { enabled: true }, remoteOptions)
          await remote.updateInstance(appId, instanceId, { enabled: true }, remoteOptions)
          if (remoteApp.manifest.backend?.lifecycle === 'persistent') {
            await waitForStableDeployment(async () => {
              const refreshed = (await remote.listApps(remoteOptions)).find((item) => item.installation?.appId === appId)
              return refreshed?.deployments?.filter((item) => item.deployment?.instanceId === instanceId) || []
            }, 'Server')
          }
        }
      } catch (error) {
        await remote.updateInstance(appId, instanceId, { enabled: false }, remoteOptions).catch(() => {})
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
    const remoteOptions = remoteOptionsForApp(localApp)
    const remoteApp = (await remote.listApps(remoteOptions)).find((item) => item.installation?.appId === appId)
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
    if (remoteInstance.enabled) await remote.updateInstance(appId, instanceId, { enabled: false }, remoteOptions)
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
      await remote.updateInstance(appId, instanceId, { enabled: remoteInstance.enabled }, remoteOptions).catch(() => {})
      throw error
    }
    if (remoteApp.manifest.backend?.instanceMode === 'multiple') {
      await remote.removeInstance(appId, instanceId, { deleteCredentials: deleteSourceCredentials, deleteData: false, ...remoteOptions })
    } else if (deleteSourceCredentials) {
      await remote.updateInstance(appId, instanceId, { clearCredentials: true }, remoteOptions)
    }
    return changed('instance-moved', appId, { ok: true, target: 'desktop', instanceId })
  })
}
