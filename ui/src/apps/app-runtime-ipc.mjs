import { assertReviewedPackage, packageReviewRevision } from './app-package-review.mjs'
import { resolveAppResourceFile } from './app-resources.mjs'
import { installAppArchive } from './app-runtime.mjs'
import path from 'node:path'
import fs from 'node:fs/promises'
import { validateAppPackage } from '../../../packages/app-runtime/src/index.mjs'
import { confirmAppInstallation, describeAppTools } from './app-tool-disclosure.mjs'

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
    confirmInstallation = (manifest, permissions, details) => confirmAppInstallation(dialog, manifest, permissions, details),
  } = options
  const runtime = () => {
    const value = getRuntime()
    if (!value) throw new Error('App Runtime is not ready')
    return value
  }
  const changed = async (action, appId, result) => {
    result = await result
    await emitChanged?.({
      action,
      appId,
      ...(result?.currentVersion ? { app: result } : {}),
    })
    return result
  }

  ipcMain.handle('app:install-archive', async (context, payload = {}) => {
    let selection;
    if (context?.transport === 'web') {
      if (!context.principal?.userId || typeof payload.filePath !== 'string' || !path.isAbsolute(payload.filePath)
        || path.extname(payload.filePath).toLowerCase() !== '.zip') throw new Error('请选择云电脑上的 ZIP 安装包或上传 ZIP 文件。');
      const stat = await fs.stat(payload.filePath);
      if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('安装包必须是小于 100 MB 的 ZIP 文件。');
      selection = { filePaths: [payload.filePath] };
    } else selection = await dialog.showOpenDialog({
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
      let approvedGrants = []
      const app = await installArchive(runtime(), selection.filePaths[0], {
        onProgress: report,
        installPackage: async (packageRoot) => {
          report({ phase: 'validating' })
          const packageInfo = await validatePackage(packageRoot)
          const appId = packageInfo.manifest.id
          report({ appId, version: packageInfo.manifest.version })
          const installation = () => runtime().installations.list().find(item => item.appId === appId);
          const installationSnapshot = () => JSON.stringify([installation()?.activeVersion, [...(installation()?.grants || [])].sort()]);
          const expectedSnapshot = installationSnapshot();
          const installationRevision = options.getInstallationRevision?.(appId);
          const expectedBaseVersion = options.getInstalledApp?.(appId)?.currentVersion || null;
          const assertUnchanged = () => {
            if (installationSnapshot() !== expectedSnapshot || (installationRevision !== undefined && options.getInstallationRevision(appId) !== installationRevision)) {
              throw new Error('确认期间 App 的安装或授权状态已变化，请重新安装。');
            }
          };
          const currentGrants = installation()?.grants || []
          const addedPermissions = (packageInfo.manifest.permissions || [])
            .filter((permission) => !currentGrants.includes(permission))
          if (addedPermissions.length || describeAppTools(packageInfo.manifest).length || packageInfo.manifest.contributes?.skills?.length || packageInfo.manifest.nativeAdapter) {
            report({ phase: 'awaiting-permission' })
            if (!await confirmInstallation(packageInfo.manifest, addedPermissions, `安装包摘要：${packageReviewRevision(packageInfo)}`)) {
              throw Object.assign(new Error('App installation permission approval was canceled'), {
                code: INSTALL_PERMISSION_CANCELLED,
              })
            }
          }
          assertUnchanged();
          assertReviewedPackage(packageInfo, await validatePackage(packageRoot));
          const declaredPermissions = new Set(packageInfo.manifest.permissions || [])
          const retainedGrants = currentGrants.filter((permission) => declaredPermissions.has(permission))
          approvedGrants = [...new Set([...retainedGrants, ...addedPermissions])]
          report({ phase: 'installing' })
          return installArchivePackage(packageRoot, { validateCommit: assertUnchanged, expectedPackageChecksums: packageInfo.checksums,
            ...(installationRevision !== undefined ? { expectedInstallationRevision: installationRevision, expectedBaseVersion } : {}),
          })
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
  ipcMain.handle('app:open-resource', async (_event, { uri }) => {
    const file = await resolveAppResourceFile(runtime(), uri)
    const error = await options.shell.openPath(file.path)
    if (error) throw new Error(error)
    return { opened: true }
  })
  ipcMain.handle('app:get-runtime-state', (_event, { appId }) => runtime().getApp(appId))
  ipcMain.handle('app:inspect-mcp-tools', (_event, input) => {
    const host = options.getMcpHost?.()
    if (!host) throw new Error('MCP 工具目录尚未就绪。')
    return host.inspectTools(input)
  })
  ipcMain.handle('app:list-contributions', (_event, options = {}) => runtime().listContributions(options))
  ipcMain.handle('app:invoke-contribution', (_event, { kind, id, input, ...invokeOptions }) => {
    if (!['commands', 'resourceProviders'].includes(kind)) {
      throw new Error(`App UI cannot invoke contribution kind: ${kind}`)
    }
    return runtime().invokeContribution(kind, id, input, { instanceId: invokeOptions.instanceId, requestId: invokeOptions.requestId, timeoutMs: invokeOptions.timeoutMs, invocation: { surface: 'app' } })
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
