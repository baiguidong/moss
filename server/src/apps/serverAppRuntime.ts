import { existsSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import type { ServerConfig } from '../types.js'
import {
  AppRuntimeHost,
  SqliteAppStateStore,
  validateAppPackage,
} from '../../../packages/app-runtime/src/index.mjs'
import { APP_ERROR_CODES, AppServiceError, resolveBackendProtocols } from '../../../packages/app-sdk/src/index.mjs'
import { ServerAppCredentialAdapter } from './serverAppCredentialAdapter.js'

function safeId(value: string, field: string): string {
  const normalized = String(value || '').trim()
  if (!/^[a-z0-9](?:[a-z0-9._-]{0,78}[a-z0-9])?$/.test(normalized)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid ${field}`)
  }
  return normalized
}

function safeVersion(value: string): string {
  const normalized = String(value || '').trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$/.test(normalized)) {
    throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid App version')
  }
  return normalized
}

function inside(root: string, target: string): string {
  const rel = relative(resolve(root), resolve(target))
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('App source path escapes the configured source')
  return target
}

export class ServerAppRuntime {
  readonly runtime: AppRuntimeHost
  readonly state: SqliteAppStateStore
  readonly sourceDir: string | null

  private constructor(runtime: AppRuntimeHost, state: SqliteAppStateStore, sourceDir?: string) {
    this.runtime = runtime
    this.state = state
    this.sourceDir = sourceDir ? resolve(sourceDir) : null
  }

  static async create(
    config: ServerConfig,
    serverInstanceId: string,
    options: {
      hostProtocols?: Array<Record<string, unknown>>
      hostHandlers?: Record<string, Record<string, (input: Record<string, unknown>, context: Record<string, unknown>) => unknown>>
      onEvent?: (event: Record<string, unknown>) => void
      beforeInitialize?: (runtime: AppRuntimeHost) => void
    } = {},
  ): Promise<ServerAppRuntime> {
    const state = await new SqliteAppStateStore(config.dbPath).initialize()
    const runtime = new AppRuntimeHost({
      rootDir: config.rootDir,
      appsDir: join(config.rootDir, 'apps'),
      dataDir: join(config.dataDir, 'apps-data'),
      runtimeDir: join(config.runDir, 'apps-runtime'),
      target: 'server',
      hostId: serverInstanceId,
      deploymentTargetId: 'server-default',
      nodeExecutable: process.env.MOSS_NODE_PATH || process.execPath,
      stateStore: state,
      credentialAdapter: new ServerAppCredentialAdapter(config.rootDir),
      hostCapabilityOptions: { protocols: options.hostProtocols || [] },
    })
    for (const [protocol, handlers] of Object.entries(options.hostHandlers || {})) {
      for (const [method, handler] of Object.entries(handlers)) {
        runtime.registerHostHandler(protocol, method, handler)
      }
    }
    runtime.events.on('event', (event: Record<string, unknown>) => options.onEvent?.(event))
    options.beforeInitialize?.(runtime)
    await runtime.initialize()
    return new ServerAppRuntime(runtime, state, config.appSourceDir)
  }

  resolveKnownPackage(appId: string, version: string): string {
    if (!this.sourceDir) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, 'Server App source is not configured')
    const id = safeId(appId, 'App id')
    const release = safeVersion(version)
    const candidates = [
      join(this.sourceDir, id, 'versions', release),
      join(this.sourceDir, id, release),
    ].map(candidate => inside(this.sourceDir!, candidate))
    const packageRoot = candidates.find(candidate => existsSync(join(candidate, 'app.moss.json')))
    if (!packageRoot) throw new AppServiceError(APP_ERROR_CODES.invalidPackage, `Known App package is unavailable: ${id}@${release}`)
    return packageRoot
  }

  async getKnownPackageAvailability(appId: string, version: string): Promise<{
    appId: string
    version: string
    available: boolean
    reason?: string
  }> {
    const normalizedAppId = safeId(appId, 'App id')
    const normalizedVersion = safeVersion(version)
    let packageRoot: string
    try {
      packageRoot = this.resolveKnownPackage(normalizedAppId, normalizedVersion)
    } catch (error) {
      return {
        appId: normalizedAppId,
        version: normalizedVersion,
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
    try {
      const packageInfo = await validateAppPackage(packageRoot)
      if (packageInfo.manifest.id !== normalizedAppId || packageInfo.manifest.version !== normalizedVersion) {
        return { appId: normalizedAppId, version: normalizedVersion, available: false, reason: 'App package identity mismatch' }
      }
      if (!packageInfo.manifest.backend?.targets.includes('server')) {
        return { appId: normalizedAppId, version: normalizedVersion, available: false, reason: 'App does not support Server deployment' }
      }
      return { appId: normalizedAppId, version: normalizedVersion, available: true }
    } catch (error) {
      return {
        appId: normalizedAppId,
        version: normalizedVersion,
        available: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async installKnown(appId: string, version: string, activate = false, grants?: string[]): Promise<unknown> {
    const normalizedAppId = safeId(appId, 'App id')
    const normalizedVersion = safeVersion(version)
    const packageRoot = this.resolveKnownPackage(normalizedAppId, normalizedVersion)
    const packageInfo = await validateAppPackage(packageRoot)
    if (packageInfo.manifest.id !== normalizedAppId || packageInfo.manifest.version !== normalizedVersion) {
      throw new AppServiceError(
        APP_ERROR_CODES.invalidPackage,
        `Known App package identity mismatch: expected ${normalizedAppId}@${normalizedVersion}`,
      )
    }
    if (!packageInfo.manifest.backend?.targets.includes('server')) {
      throw new AppServiceError(
        APP_ERROR_CODES.invalidPackage,
        `App does not support Server deployment: ${normalizedAppId}@${normalizedVersion}`,
      )
    }
    const installed = await this.runtime.installFromDirectory(packageRoot, { grants })
    if (activate) await this.runtime.activateVersion(normalizedAppId, normalizedVersion, { grants })
    return installed
  }

  async publishAccountEvent(orgId: string, name: string, data: Record<string, unknown>): Promise<void> {
    const owners = this.runtime.installations.listOwners()
      .filter(owner => owner.orgId === orgId)
    await Promise.all(owners.map(owner => this.runtime.withOwner(owner, async () => {
      const apps = await this.runtime.listApps()
      await Promise.all(apps.flatMap(app => {
        if (!app.installation?.enabled
          || !resolveBackendProtocols(app.manifest?.backend, 'server').includes('moss.account/v1')
          || !app.installation?.grants?.includes('account:directory:read')) return []
        return (app.instances || [])
          .filter((instance: { enabled?: boolean }) => instance.enabled)
          .map((instance: { id: string }) => this.runtime.publishHostEvent(
            app.manifest.id,
            instance.id,
            'moss.account/v1',
            name,
            data,
          ))
      }))
    })))
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown()
    this.state.close()
  }
}
