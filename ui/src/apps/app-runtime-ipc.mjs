import { installAppArchive } from './app-runtime.mjs'
import path from 'node:path'
import { validateAppPackage } from '../../../packages/app-runtime/src/index.mjs'

const INSTALL_PERMISSION_CANCELLED = 'MOSS_APP_INSTALL_PERMISSION_CANCELLED'

export function registerAppRuntimeIpc(options) {
  const {
    ipcMain,
    dialog,
    getRuntime,
    emitChanged,
    emitProgress,
    installArchivePackage,
    installArchive = installAppArchive,
    validatePackage = validateAppPackage,
  } = options
  const runtime = () => {
    const value = getRuntime()
    if (!value) throw new Error('App Runtime is not ready')
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
    let progress = { source: 'local', appId: '', fileName: path.basename(selection.filePaths[0]) }
    const report = (patch) => {
      progress = { ...progress, ...patch }
      emitProgress?.(progress)
    }
    try {
      report({ phase: 'preparing' })
      const previousGrants = new Map(runtime().installations.list().map((installation) => [
        installation.appId,
        installation.grants || [],
      ]))
      let approvedGrants = []
      const app = await installArchive(runtime(), selection.filePaths[0], {
        onProgress: report,
        installPackage: async (packageRoot) => {
          report({ phase: 'validating' })
          const packageInfo = await validatePackage(packageRoot)
          const appId = packageInfo.manifest.id
          report({ appId, version: packageInfo.manifest.version })
          const currentGrants = previousGrants.get(appId) || []
          const addedPermissions = (packageInfo.manifest.permissions || [])
            .filter((permission) => !currentGrants.includes(permission))
          if (addedPermissions.length) {
            report({ phase: 'awaiting-permission' })
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
          report({ phase: 'installing' })
          return installArchivePackage(packageRoot)
        },
      })
      const appId = app.id || app.manifest?.id
      const version = app.currentVersion || app.version || app.manifest?.version
      if (!appId || !version) throw new Error('Installed App package did not return an identity and version')
      report({ phase: 'activating', appId, version })
      await runtime().registerInstalled(appId, version, { grants: approvedGrants })
      const result = { ok: true, app: await changed('installed', appId, app) }
      report({ phase: 'completed' })
      return result
    } catch (error) {
      if (error?.code === INSTALL_PERMISSION_CANCELLED) {
        report({ phase: 'canceled' })
        return { ok: false, canceled: true }
      }
      report({ phase: 'error', error: error.message || String(error) })
      throw error
    }
  })
  ipcMain.handle('app:get-runtime-state', (_event, { appId }) => runtime().getApp(appId))
  ipcMain.handle('app:list-contributions', (_event, options = {}) => runtime().listContributions(options))
  ipcMain.handle('app:invoke-contribution', (_event, { kind, id, input, ...invokeOptions }) => {
    if (!['commands', 'resourceProviders'].includes(kind)) {
      throw new Error(`App UI cannot invoke contribution kind: ${kind}`)
    }
    return runtime().invokeContribution(kind, id, input, invokeOptions)
  })
  ipcMain.handle('app:set-enabled', async (_event, { appId, enabled }) => (
    changed('enabled', appId, runtime().setAppEnabled(appId, enabled))
  ))
  ipcMain.handle('app:set-grants', async (_event, { appId, grants }) => (
    changed('grants', appId, runtime().setAppGrants(appId, grants))
  ))
  ipcMain.handle('app:list-instances', (_event, { appId }) => runtime().listInstances(appId))
  ipcMain.handle('app:update-instance', async (_event, { appId, instanceId, ...patch }) => (
    changed('instance-updated', appId, runtime().updateInstance(appId, instanceId, patch))
  ))
  ipcMain.handle('app:set-instance-enabled', async (_event, { appId, instanceId, enabled }) => (
    changed('instance-enabled', appId, runtime().setInstanceEnabled(appId, instanceId, enabled))
  ))
  ipcMain.handle('app:clear-instance-credentials', async (_event, { appId, instanceId }) => (
    changed('instance-credentials-cleared', appId, runtime().clearInstanceCredentials(appId, instanceId))
  ))
  ipcMain.handle('app:restart-instance', (_event, { appId, instanceId }) => runtime().restartInstance(appId, instanceId))
  ipcMain.handle('app:get-instance-logs', (_event, { appId, instanceId, limit }) => runtime().getLogs(appId, instanceId, { limit }))
}
