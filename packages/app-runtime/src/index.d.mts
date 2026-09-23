export type AppTarget = 'desktop' | 'server'
export type AppOwner = {
  scope: 'host' | 'org' | 'user'
  orgId: string | null
  userId: string | null
  key: string
}

export type AppHostCapabilityContext = {
  appId: string
  version: string
  instanceId: string
  generation: number
  target: { type: AppTarget; id: string }
  owner: AppOwner | null
  principal: AppOwner | null
  dataDir: string | null
  runtimeDir: string | null
  requestId: string
  protocol: string
  method: string
  permission: string | null
  signal?: AbortSignal
}

export interface AppPackageInfo {
  root: string
  manifest: Record<string, any>
  checksums: Record<string, string>
  files: Array<{ relativePath: string; absolutePath: string; size: number }>
  installed?: boolean
  trust?: Record<string, any>
}

export interface AppStateStore {
  initialize(): Promise<this>
  snapshot(): Record<string, any>
  transaction<T>(mutator: (state: Record<string, any>) => T | Promise<T>): Promise<T>
}

export class AppRuntimeHost {
  constructor(options: Record<string, any>)
  initialize(): Promise<this>
  currentOwner(): AppOwner
  withOwner<T>(owner: Partial<AppOwner>, operation: () => T): T
  installFromDirectory(sourceDir: string, options?: Record<string, any>): Promise<any>
  registerInstalled(appId: string, version: string, options?: Record<string, any>): Promise<any>
  getInstallation(appId: string): any | null
  getActivePackage(appId: string): Promise<AppPackageInfo>
  getApp(appId: string): Promise<any>
  listApps(): Promise<any[]>
  listContributions(options?: { appId?: string; kinds?: string[]; includeUnavailable?: boolean; loadSchemas?: boolean }): Promise<Record<string, any[]>>
  requireContribution(kind: string, id: string, options?: Record<string, any>): Promise<Record<string, any>>
  invokeContribution(kind: string, id: string, input?: unknown, options?: Record<string, any>): Promise<unknown>
  invokeToolContribution(id: string, input?: unknown, options?: Record<string, any>): Promise<unknown>
  invokeCommandContribution(id: string, input?: unknown, options?: Record<string, any>): Promise<unknown>
  resolveResource(uri: string, options?: Record<string, any>): Promise<unknown>
  setAppEnabled(appId: string, enabled: boolean): Promise<any>
  setAppGrants(appId: string, grants: string[]): Promise<any>
  listInstances(appId: string): Promise<any[]>
  createInstance(appId: string, input?: Record<string, any>): Promise<any>
  updateInstance(appId: string, instanceId: string, patch?: Record<string, any>): Promise<any>
  setInstanceEnabled(appId: string, instanceId: string, enabled: boolean): Promise<any>
  removeInstance(appId: string, instanceId: string, options?: Record<string, any>): Promise<void>
  clearInstanceCredentials(appId: string, instanceId: string): Promise<any>
  requireInstance(appId: string, instanceId: string): any
  getInstanceStatus(appId: string, instanceId: string): Promise<any[]>
  restartInstance(appId: string, instanceId: string): Promise<any>
  invoke(appId: string, instanceId: string, action: string, input: unknown, options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal; principal?: Partial<AppOwner> }): Promise<any>
  cancel(appId: string, instanceId: string, requestId: string): boolean
  registerHostProtocol(definition: Record<string, any>): () => void
  registerHostHandler(protocol: string, method: string, handler: (input: Record<string, unknown>, context: AppHostCapabilityContext) => unknown | Promise<unknown>): () => void
  requestHostCapability(appId: string, instanceId: string, protocol: string, method: string, input?: Record<string, unknown>, options?: { requestId?: string; signal?: AbortSignal; principal?: Partial<AppOwner> }): Promise<unknown>
  dispatchHostRequest(request: Record<string, any>): Promise<unknown>
  publishHostEvent(appId: string, instanceId: string, protocol: string, name: string, data?: Record<string, unknown>, options?: Record<string, any>): Promise<unknown>
  cancelHostEvent(appId: string, instanceId: string, protocol: string, eventId: string): boolean
  getLogs(appId: string, instanceId: string, options?: Record<string, any>): Promise<any[]>
  activateVersion(appId: string, version: string, options?: { grants?: string[] }): Promise<any>
  moveDeployment(appId: string, instanceId: string, targetType: string, targetId: string, options?: Record<string, any>): Promise<any>
  uninstall(appId: string, options?: Record<string, any>): Promise<boolean>
  shutdown(): Promise<void>
  readonly installations: InstallationStore
  readonly instances: InstanceStore
  readonly deployments: DeploymentStore
  readonly packages: AppPackageStore
  readonly actions: AppActionBroker
  readonly hostCapabilities: AppHostCapabilityRegistry
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
  constructor(state: AppStateStore, options?: { ownerResolver?: () => AppOwner })
  list(): any[]
  listAll(): any[]
  listOwners(): AppOwner[]
  get(appId: string): any | null
  upsert(appId: string, patch: Record<string, any>): Promise<any>
  remove(appId: string): Promise<void>
}

export class InstanceStore {
  constructor(state: AppStateStore, options?: { ownerResolver?: () => AppOwner })
  list(appId: string): any[]
  listAll(): any[]
  get(instanceId: string): any | null
  create(appId: string, input?: Record<string, any>, options?: Record<string, any>): Promise<any>
  update(instanceId: string, patch: Record<string, any>): Promise<any>
  remove(instanceId: string): Promise<void>
  removeForApp(appId: string): Promise<void>
}

export class DeploymentStore {
  constructor(state: AppStateStore, options?: { ownerResolver?: () => AppOwner })
  list(appId?: string): any[]
  listAll(): any[]
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
  constructor(options: { appsDir: string; hostApiVersion?: string; trustedPublishers?: Record<string, any> | Map<string, any>; requireTrustedPublisher?: boolean })
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
  publishHostEvent(key: string, protocol: string, name: string, data?: Record<string, unknown>, options?: Record<string, any>): Promise<unknown>
  cancelHostEvent(key: string, protocol: string, eventId: string): boolean
  shutdown(): Promise<void>
}

export class AppActionBroker {
  constructor(options: Record<string, any>)
  invoke(deployment: Record<string, any>, actionName: string, input: unknown, options?: { requestId?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<unknown>
  cancel(deploymentKey: string, requestId: string): boolean
  readonly pendingTotal: number
  readonly requests: Map<string, unknown>
}
export class AppHostCapabilityRegistry {
  constructor(options?: Record<string, any>)
  registerProtocol(definition: Record<string, any>): () => void
  registerHandler(protocol: string, method: string, handler: (input: Record<string, unknown>, context: AppHostCapabilityContext) => unknown | Promise<unknown>): () => void
  listProtocols(): string[]
  listMethods(protocol: string): string[]
  prepareEvent(request: Record<string, any>): Promise<Readonly<Record<string, any>>>
  dispatch(request: Record<string, any>): Promise<unknown>
  readonly activeByInstance: Map<string, number>
  readonly activeTotal: number
}
export function createAccountProtocolDefinition(options?: Record<string, any>): Record<string, any>
export function createAgentProtocolDefinition(options?: Record<string, any>): Record<string, any>
export function createDesktopProtocolDefinition(options?: Record<string, any>): Record<string, any>
export function createRemoteProtocolDefinition(options?: Record<string, any>): Record<string, any>
export const DEFAULT_AGENT_CHANNEL_POLICY: Readonly<Record<string, any>>
export const AGENT_CHANNEL_SYSTEM_PROMPT: string
export function createAgentChannelStore(db: any, options?: { now?: () => number }): any
export function createAgentChannelController(options: Record<string, any>): any
export function toPublicAgentChannelTurn(turn: any): any
export function validateAgentChannelDelegation(policy: any, toolName: string, input: any): string | null
export function resolveAgentChannelConnectorIds(policy: any, baseConnectorIds: string[]): string[]
export function resolveAgentChannelToolSelectors(policy: any, mcpServerNames?: string[]): string[] | null
export function validateAgentChannelConnectorTool(policy: any, toolName: string, input: any, resolveServerConnectorId?: (name: string) => string): string | null
export const APP_CONTRIBUTION_KINDS: readonly string[]
export function contributionId(appId: string, localId: string): string
export function appToolName(appId: string, localId: string): string
export function collectManifestContributions(manifest: Record<string, any>, options?: Record<string, any>): Record<string, any[]>
export function findContribution(contributions: Record<string, any[]>, kind: string, id: string): Record<string, any>
export class DirectoryAppCatalogSource {
  constructor(options: { id?: string; rootDir: string; trustedPublishers?: Record<string, any> | Map<string, any>; requireTrustedPublisher?: boolean })
  readonly id: string
  list(): Promise<any[]>
  resolve(appId: string, version: string): Promise<AppPackageInfo>
}
export class AppCatalog {
  constructor(options?: { sources?: Array<DirectoryAppCatalogSource | Record<string, any>> })
  registerSource(source: DirectoryAppCatalogSource | Record<string, any>): () => void
  list(): Promise<any[]>
  resolve(appId: string, version: string, options?: { sourceId?: string }): Promise<{ source: any; packageInfo: AppPackageInfo }>
  install(runtime: AppRuntimeHost, appId: string, version: string, options?: Record<string, any>): Promise<any>
}
export class AppEventBroker {
  on(eventName: string, listener: (event: any) => void): this
  publish(event: any): any
  subscribeApp(appId: string, listener: (event: any) => void, options?: { owner?: AppOwner }): () => void
}
export class AppLogStore {
  constructor(options: Record<string, any>)
  append(entry: Record<string, any>): Promise<any>
  list(appId: string, instanceId: string, options?: Record<string, any>): Promise<any[]>
  removeApp(appId: string, options?: { owner?: AppOwner }): Promise<void>
}

export const DEFAULT_PACKAGE_LIMITS: Readonly<{ maxFileBytes: number; maxPackageBytes: number; maxFiles: number }>
export function listPackageFiles(packageRoot: string, options?: Record<string, number>): Promise<AppPackageInfo['files']>
export function createPackageChecksums(packageRoot: string): Promise<Record<string, string>>
export function writePackageChecksums(packageRoot: string): Promise<Record<string, string>>
export function validateAppPackage(root: string, options?: Record<string, any>): Promise<AppPackageInfo>
export function createAppSignaturePayload(manifest: Record<string, any>, checksums: Record<string, string>, metadata: { publisherId: string; keyId: string }): Buffer
export function defaultInstanceId(appId: string): string
export const DEFAULT_APP_OWNER: AppOwner
export function normalizeAppOwner(owner?: Partial<AppOwner>): AppOwner
export function deploymentKey(instanceId: string, targetType: string, targetId: string, owner?: Partial<AppOwner>): string
export function validateConfiguration(packageRoot: string, backend: Record<string, any>, config: unknown, secrets?: unknown): true
export function redactAppValue(value: unknown, secretValues?: string[]): unknown
