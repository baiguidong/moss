import type { StoredApp } from '../types'

export type AppRuntimeTarget = 'desktop' | 'server'

export function backendForTarget(app: StoredApp, target: AppRuntimeTarget): StoredApp['backend'] {
  const backend = target === 'server'
    ? app.remoteInstalled ? app.serverBackend || null : app.backend || null
    : app.remoteOnly ? null : app.backend || null
  return backend?.targets.includes(target) ? backend : null
}

export function appCanDeployToServer(app: StoredApp): boolean {
  return Boolean(app.currentVersion)
    && Boolean(app.backend?.targets.includes('server'))
    && (!app.remoteInstalled || app.serverVersion !== app.currentVersion)
}

export function appCanCreateServerInstance(app: StoredApp): boolean {
  const backend = backendForTarget(app, 'server')
  return Boolean(
    app.serverAvailable
    && backend?.instanceMode === 'multiple'
    && (app.remoteInstalled || app.serverPackageAvailable),
  )
}

export function appCanMoveInstance(app: StoredApp, from: AppRuntimeTarget): boolean {
  if (!app.serverAvailable || app.remoteOnly || !app.currentVersion) return false
  if (from === 'server') {
    return Boolean(app.backend?.targets.includes('desktop'))
      && app.serverVersion === app.currentVersion
  }
  if (!app.backend?.targets.includes('server')) return false
  return app.remoteInstalled
    ? app.serverVersion === app.currentVersion
    : Boolean(app.serverPackageAvailable)
}

export function availableInstanceTargets(app: StoredApp): AppRuntimeTarget[] {
  const targets: AppRuntimeTarget[] = []
  const desktop = backendForTarget(app, 'desktop')
  if (desktop?.instanceMode === 'multiple') targets.push('desktop')
  if (appCanCreateServerInstance(app)) targets.push('server')
  return targets
}
