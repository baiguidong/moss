import { assertReviewedPackage, packageReviewRevision } from './app-package-review.mjs'
import { resolveAppResourceFile } from './app-resources.mjs'
import { installAppArchive } from './app-runtime.mjs'
import path from 'node:path'
import fs from 'node:fs/promises'
import { validateAppPackage } from '../../../packages/app-runtime/src/index.mjs'
import { loadJsonSchema } from '../../../packages/app-sdk/src/index.mjs'
import { appCapabilityDeclarationChanged, confirmAppInstallation, describeAppTools, describePreviousAppCapabilities } from './app-tool-disclosure.mjs'

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
      if (!stat.isFile() || stat.size > 250 * 1024 * 1024) throw new Error('安装包必须是小于 250 MB 的 ZIP 文件。');
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
    let committed = null
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
          const installedApp = options.getInstalledApp?.(appId) || null;
          const expectedBaseVersion = installedApp?.currentVersion || null;
          const previousRuntime = runtime().getInstallation?.(appId) || null;
          const previousRuntimeVersion = previousRuntime?.activeVersion || null;
          const previousRuntimeGrants = [...(previousRuntime?.grants || [])];
          let previousManifest = installedApp?.manifest || null;
          try { previousManifest = (await runtime().getApp?.(appId))?.manifest || previousManifest; } catch {}
          const previousCapabilitiesUnknown = Boolean((expectedBaseVersion || previousRuntimeVersion) && !previousManifest);
          const capabilityChange = previousCapabilitiesUnknown || appCapabilityDeclarationChanged(previousManifest, packageInfo.manifest);
          const assertUnchanged = () => {
            if (installationSnapshot() !== expectedSnapshot || (installationRevision !== undefined && options.getInstallationRevision(appId) !== installationRevision)) {
              throw new Error('确认期间 App 的安装或授权状态已变化，请重新安装。');
            }
          };
          const currentGrants = installation()?.grants || []
          const addedPermissions = (packageInfo.manifest.permissions || [])
            .filter((permission) => !currentGrants.includes(permission))
          if (addedPermissions.length || describeAppTools(packageInfo.manifest).length || packageInfo.manifest.contributes?.skills?.length
            || packageInfo.manifest.nativeAdapter || packageInfo.manifest.appCapabilities?.requires?.length
            || packageInfo.manifest.appCapabilities?.provides?.length
            || packageInfo.manifest.appCapabilities?.usesTools?.length || capabilityChange) {
            report({ phase: 'awaiting-permission' })
            const reviewDetails = [`安装包摘要：${packageReviewRevision(packageInfo)}`,
              previousCapabilitiesUnknown ? '无法读取原版本的跨 App 能力声明，请确认新版本的能力。'
                : describePreviousAppCapabilities(previousManifest, packageInfo.manifest)].filter(Boolean).join('\n\n');
            if (!await confirmInstallation(packageInfo.manifest, addedPermissions, reviewDetails)) {
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
            activateInstallation: app => emitChanged?.({ action: 'install', app, grants: approvedGrants }),
            onCommit: ({ installationRevision: committedRevision }) => {
              committed = { appId, version: packageInfo.manifest.version, revision: committedRevision,
                previousVersion: expectedBaseVersion, previousRuntimeVersion, previousRuntimeGrants,
                approvedGrants: [...approvedGrants] }
            },
            ...(installationRevision !== undefined ? { expectedInstallationRevision: installationRevision, expectedBaseVersion } : {}),
          })
        },
      })
      const appId = app.id || app.manifest?.id
      const version = app.currentVersion || app.version || app.manifest?.version
      if (!appId || !version) throw new Error('Installed App package did not return an identity and version')
      report({ phase: 'activating', appId, version })
      await runtime().registerInstalled(appId, version, { grants: approvedGrants })
      await emitChanged?.({ action: 'installed', appId })
      const result = { ok: true, app }
      report({ phase: 'completed' })
      return result
    } catch (error) {
      if (error?.code === INSTALL_PERMISSION_CANCELLED) {
        report({ phase: 'canceled' })
        return { ok: false, canceled: true }
      }
      if (committed?.revision !== undefined && options.rollbackPackage) {
        let packageRolledBack = false
        try {
          const rolledBack = await options.rollbackPackage({ appId: committed.appId, previousVersion: committed.previousVersion,
            failedVersion: committed.version, expectedInstallationRevision: committed.revision })
          if (rolledBack === true) {
            packageRolledBack = true
            report({ phase: 'rolling-back' })
            const host = runtime()
            const restoredRevision = options.getInstallationRevision?.(committed.appId)
            const restoreRuntime = async (insideTransition = false) => {
              // A newer installation can commit after the registry rollback.
              // Leave its Runtime ownership to that installation's activation.
              if (restoredRevision !== undefined && options.getInstallationRevision(committed.appId) !== restoredRevision) return
              if (options.getInstalledApp && (options.getInstalledApp(committed.appId)?.currentVersion || null) !== committed.previousVersion) return
              const installation = host.getInstallation?.(committed.appId)
              const activeVersion = installation?.activeVersion || null
              if (activeVersion !== committed.version) return
              const currentGrants = [...(installation.grants || [])]
              const sameGrants = JSON.stringify(currentGrants.sort()) === JSON.stringify([...committed.approvedGrants].sort())
              if (activeVersion === committed.previousRuntimeVersion) {
                if (sameGrants && JSON.stringify(currentGrants) !== JSON.stringify([...committed.previousRuntimeGrants].sort())) {
                  if (insideTransition) await host.setAppGrantsNow(committed.appId, committed.previousRuntimeGrants)
                  else await host.setAppGrants(committed.appId, committed.previousRuntimeGrants)
                }
                return
              }
              if (committed.previousRuntimeVersion) {
                const restoreOptions = sameGrants ? { grants: committed.previousRuntimeGrants } : {}
                if (insideTransition) await host.activateVersionNow(committed.appId, committed.previousRuntimeVersion, restoreOptions)
                else await host.activateVersion(committed.appId, committed.previousRuntimeVersion, restoreOptions)
              } else if (insideTransition) await host.uninstallNow(committed.appId)
              else await host.uninstall(committed.appId)
            }
            const restoreMethod = !committed.previousRuntimeVersion ? 'uninstallNow'
              : committed.previousRuntimeVersion === committed.version ? 'setAppGrantsNow' : 'activateVersionNow'
            const canTransition = typeof host.transitionApp === 'function' && typeof host[restoreMethod] === 'function'
            if (canTransition) await host.transitionApp(committed.appId, () => restoreRuntime(true))
            else await restoreRuntime()
          }
        } catch (rollbackError) {
          error = new Error(`${error.message || String(error)}；安装回滚失败：${rollbackError.message || String(rollbackError)}`, { cause: error })
        }
        if (packageRolledBack) {
          try { await emitChanged?.({ action: 'install-rollback', appId: committed.appId }) }
          catch (refreshError) {
            error = new Error(`${error.message || String(error)}；回滚后刷新失败：${refreshError.message || String(refreshError)}`, { cause: error })
          }
        }
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
  ipcMain.handle('app:read-skill', async (_event, { appId, skillId }) => {
    const pkg = await runtime().getActivePackage(appId)
    const skill = pkg.manifest.contributes?.skills?.find(item => item.id === skillId)
    if (!skill) throw new Error('App 未提供此技能')
    const root = await fs.realpath(pkg.root)
    const file = await fs.realpath(path.resolve(root, skill.path))
    const relative = path.relative(root, file)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('技能文件超出 App 目录')
    const handle = await fs.open(file, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('技能文件不可用或超过 256 KiB')
      const buffer = Buffer.alloc(256 * 1024 + 1)
      let bytesRead = 0
      while (bytesRead < buffer.length) {
        const next = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
        if (!next.bytesRead) break
        bytesRead += next.bytesRead
      }
      if (bytesRead > 256 * 1024) throw new Error('技能文件超过 256 KiB')
      return { title: skill.title, content: buffer.subarray(0, bytesRead).toString('utf8') }
    } finally { await handle.close() }
  })
  ipcMain.handle('app:settings-form', async (_event, { appId, version, settingId, operation, values }) => {
    if (!['read', 'save'].includes(operation)) throw new Error('无效的设置操作。')
    const host = runtime(), pkg = await host.getActivePackage(appId)
    const setting = pkg.manifest.contributes?.settings?.find(item => item.id === settingId && item.form)
    if (!setting) throw new Error('App 未声明此设置表单。')
    const assertCurrent = () => {
      const installation = host.getInstallation(appId)
      if (!installation?.enabled || installation.activeVersion !== version || pkg.manifest.version !== version) throw new Error('App 状态或版本已变化，请重新打开设置。')
      if (setting.permission && !installation.grants?.includes(setting.permission)) throw new Error('请先授予此设置所需的权限。')
    }
    assertCurrent()
    const action = pkg.manifest.backend.actions.find(item => item.name === setting.form.saveAction)
    const schema = loadJsonSchema(pkg.root, action.inputSchema, 'settings form')
    const instance = await host.ensureDefaultInstance(appId)
    const invoke = (name, input) => host.invoke(appId, instance.id, name, input, { authorizeDispatch: assertCurrent, invocation: { surface: 'app', origin: 'settings' } })
    if (operation === 'save') {
      await invoke(setting.form.saveAction, values)
      assertCurrent()
      await emitChanged?.({ action: 'settings-saved', appId })
    }
    const result = await invoke(setting.form.readAction, {})
    assertCurrent()
    if (!result?.values || typeof result.values !== 'object' || Array.isArray(result.values)) throw new Error('App 返回的设置格式无效。')
    const publicValues = { ...result.values }
    // A declared secret never reaches the renderer, even if an App returns it.
    const redact = node => {
      for (const [key, field] of Object.entries(node?.properties || {})) if (field.writeOnly) delete publicValues[key]
      for (const branch of [...(node?.allOf || []), ...(node?.oneOf || []), node?.then, node?.else].filter(Boolean)) redact(branch)
    }
    redact(schema)
    return { schema, values: publicValues, configuredFields: (result.configuredFields || []).filter(key => typeof key === 'string') }
  })
  ipcMain.handle('app:set-tool-scope', async (_event, { appId, scope, loading }) => {
    if (scope !== null && scope !== 'global' && scope !== 'session') throw new Error('无效的工具使用范围')
    const host = runtime()
    const pkg = await host.getActivePackage(appId)
    if (pkg.manifest.connectorApp || pkg.manifest.nativeAdapter) throw new Error('此 App 的使用范围由宿主固定')
    const version = host.getInstallation(appId)?.activeVersion
    const result = host.toolScopeSettings({ appId, assertCurrent() {
      if (!version || host.getInstallation(appId)?.activeVersion !== version) throw new Error('App 已更新，请重试')
    } }, scope, loading)
    return changed('tool-scope', appId, result)
  })
  ipcMain.handle('app:inspect-mcp-tools', (_event, input) => {
    const host = options.getMcpHost?.()
    if (!host) throw new Error('MCP 工具目录尚未就绪。')
    return host.inspectTools(input)
  })
  ipcMain.handle('app:manage-mcp', (_event, input) => {
    const host = options.getMcpHost?.()
    if (!host) throw new Error('MCP 服务尚未就绪。')
    return host.manage(input)
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
