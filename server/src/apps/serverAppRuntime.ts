import { existsSync } from 'node:fs'
import { resolve, join, relative, isAbsolute } from 'node:path'
import type { ServerConfig } from '../types.js'
import {
  AppRuntimeHost,
  SqliteAppStateStore,
  validateAppPackage,
} from '../../../packages/app-runtime/src/index.mjs'
import { APP_ERROR_CODES, AppServiceError } from '../../../packages/app-sdk/src/index.mjs'
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

  static async create(config: ServerConfig, serverInstanceId: string): Promise<ServerAppRuntime> {
    const state = await new SqliteAppStateStore(config.dbPath).initialize()
    const runtime = await new AppRuntimeHost({
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
    }).initialize()
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

  async installKnown(appId: string, version: string, activate = false): Promise<unknown> {
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
    const installed = await this.runtime.installFromDirectory(packageRoot)
    if (activate) await this.runtime.activateVersion(normalizedAppId, normalizedVersion)
    return installed
  }

  async shutdown(): Promise<void> {
    await this.runtime.shutdown()
    this.state.close()
  }
}
