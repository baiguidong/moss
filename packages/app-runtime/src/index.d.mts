export interface AppPackageInfo {
  root: string
  manifest: Record<string, any>
  checksums: Record<string, string>
  files: Array<{ relativePath: string; absolutePath: string; size: number }>
  installed?: boolean
}

export interface AppStateStore {
  initialize(): Promise<this>
  snapshot(): Record<string, any>
  transaction<T>(mutator: (state: Record<string, any>) => T | Promise<T>): Promise<T>
}

export class AppRuntimeHost {
  constructor(options: Record<string, any>)
  initialize(): Promise<this>
  installFromDirectory(sourceDir: string): Promise<any>
  registerInstalled(appId: string, version: string, options?: Record<string, any>): Promise<any>
  getActivePackage(appId: string): Promise<AppPackageInfo>
  getApp(appId: string): Promise<any>
  listApps(): Promise<any[]>
  setAppEnabled(appId: string, enabled: boolean): Promise<any>
  listInstances(appId: string): Promise<any[]>
  createInstance(appId: string, input?: Record<string, any>): Promise<any>
  updateInstance(appId: string, instanceId: string, patch?: Record<string, any>): Promise<any>
  setInstanceEnabled(appId: string, instanceId: string, enabled: boolean): Promise<any>
  removeInstance(appId: string, instanceId: string, options?: Record<string, any>): Promise<void>
  clearInstanceCredentials(appId: string, instanceId: string): Promise<any>
  requireInstance(appId: string, instanceId: string): any
  getInstanceStatus(appId: string, instanceId: string): Promise<any[]>
  restartInstance(appId: string, instanceId: string): Promise<any>
  invoke(appId: string, instanceId: string, action: string, input: unknown, options?: Record<string, any>): Promise<any>
  cancel(appId: string, instanceId: string, requestId: string): boolean
  getLogs(appId: string, instanceId: string, options?: Record<string, any>): Promise<any[]>
  activateVersion(appId: string, version: string): Promise<any>
  moveDeployment(appId: string, instanceId: string, targetType: string, targetId: string, options?: Record<string, any>): Promise<any>
  uninstall(appId: string, options?: Record<string, any>): Promise<boolean>
  shutdown(): Promise<void>
  readonly installations: InstallationStore
  readonly instances: InstanceStore
  readonly deployments: DeploymentStore
  readonly packages: AppPackageStore
  readonly actions: AppActionBroker
  readonly events: AppEventBroker
  readonly logs: AppLogStore
  readonly supervisor: AppProcessSupervisor
  readonly credentials: MemoryCredentialAdapter | Record<string, any>
  readonly appsDir: string
  readonly dataDir: string
  readonly runtimeDir: string
  readonly rootDir: string
  readonly target: AppTarget
  readonly hostId: string
  readonly deploymentTargetId: string
}

export class JsonAppStateStore implements AppStateStore {
  constructor(filePath: string)
  initialize(): Promise<this>
  snapshot(): Record<string, any>
  transaction<T>(mutator: (state: Record<string, any>) => T | Promise<T>): Promise<T>
}

export class SqliteAppStateStore implements AppStateStore {
  constructor(databasePath: string)
  initialize(): Promise<this>
  snapshot(): Record<string, any>
  transaction<T>(mutator: (state: Record<string, any>) => T | Promise<T>): Promise<T>
  close(): void
}

export class InstallationStore {
  constructor(state: AppStateStore)
  list(): any[]
  get(appId: string): any | null
  upsert(appId: string, patch: Record<string, any>): Promise<any>
  remove(appId: string): Promise<void>
}

export class InstanceStore {
  constructor(state: AppStateStore)
  list(appId: string): any[]
  get(instanceId: string): any | null
  create(appId: string, input?: Record<string, any>, options?: Record<string, any>): Promise<any>
  update(instanceId: string, patch: Record<string, any>): Promise<any>
  remove(instanceId: string): Promise<void>
  removeForApp(appId: string): Promise<void>
}

export class DeploymentStore {
  constructor(state: AppStateStore)
  list(appId?: string): any[]
  get(key: string): any | null
  upsert(input: Record<string, any>): Promise<any>
  bumpGeneration(key: string, patch?: Record<string, any>): Promise<any>
  acquireLease(key: string, owner: string, ttlMs: number, now?: number): Promise<any | null>
  releaseLease(key: string, owner: string): Promise<void>
  remove(key: string): Promise<void>
  removeForApp(appId: string): Promise<void>
}

export class MemoryCredentialAdapter {
  get(appId: string, instanceId: string): Promise<Record<string, unknown>>
  set(appId: string, instanceId: string, values: Record<string, unknown>): Promise<void>
  remove(appId: string, instanceId: string): Promise<void>
  removeApp(appId: string): Promise<void>
}

export class AppPackageStore {
  constructor(options: { appsDir: string; hostApiVersion?: string })
  appRoot(appId: string): string
  versionRoot(appId: string, version: string): string
  get(appId: string, version: string): Promise<AppPackageInfo>
  installFromDirectory(sourceDir: string, options?: Record<string, any>): Promise<AppPackageInfo>
  removeVersion(appId: string, version: string): Promise<void>
  removeApp(appId: string): Promise<void>
}

export class AppProcessSupervisor {
  constructor(options?: Record<string, any>)
  register(definition: Record<string, any>): any
  unregister(key: string): void
  status(key: string): any
  listStatuses(): any[]
  start(key: string, options?: Record<string, any>): Promise<any>
  stop(key: string): Promise<any>
  restart(key: string): Promise<any>
  invoke(key: string, actionName: string, input: unknown, options?: Record<string, any>): Promise<any>
  cancel(key: string, requestId: string): boolean
  shutdown(): Promise<void>
}

export class AppActionBroker { constructor(options: Record<string, any>) }
export class AppEventBroker {
  on(eventName: string, listener: (event: any) => void): this
  publish(event: any): any
  subscribeApp(appId: string, listener: (event: any) => void): () => void
}
export class AppLogStore {
  constructor(options: Record<string, any>)
  append(entry: Record<string, any>): Promise<any>
  list(appId: string, instanceId: string, options?: Record<string, any>): Promise<any[]>
  removeApp(appId: string): Promise<void>
}

export const DEFAULT_PACKAGE_LIMITS: Readonly<{ maxFileBytes: number; maxPackageBytes: number; maxFiles: number }>
export function listPackageFiles(packageRoot: string, options?: Record<string, number>): Promise<AppPackageInfo['files']>
export function createPackageChecksums(packageRoot: string): Promise<Record<string, string>>
export function writePackageChecksums(packageRoot: string): Promise<Record<string, string>>
export function validateAppPackage(root: string, options?: Record<string, any>): Promise<AppPackageInfo>
export function defaultInstanceId(appId: string): string
export function deploymentKey(instanceId: string, targetType: string, targetId: string): string
export function validateConfiguration(packageRoot: string, backend: Record<string, any>, config: unknown, secrets?: unknown): true
export function redactAppValue(value: unknown, secretValues?: string[]): unknown
