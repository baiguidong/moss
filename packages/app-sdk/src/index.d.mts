export type AppTarget = 'desktop' | 'server'
export type AppBackendLifecycle = 'on-demand' | 'persistent'
export type AppInstanceMode = 'single' | 'multiple'

export interface AppActionManifest {
  name: string
  inputSchema?: string
  outputSchema?: string
  timeoutMs?: number
}

export interface AppManifestV2 {
  schemaVersion: 2
  id: string
  version: string
  displayName: string
  description: string
  icon: string
  hostApi: string
  ui?: { entry: string; window: { width: number; height: number; resizable: boolean } }
  backend?: {
    entry: string
    runtime: 'node'
    apiVersion: 1
    lifecycle: AppBackendLifecycle
    instanceMode: AppInstanceMode
    targets: AppTarget[]
    actions: AppActionManifest[]
    configuration?: { schema?: string; secrets?: string }
  }
  permissions: string[]
}

export interface AppServiceEnvelope<T = unknown> {
  version: 1
  id: string
  type: string
  timestamp: number
  payload: T
}

export interface AppBackendContext {
  appId: string
  version: string
  instanceId: string
  generation: number
  launchToken: string
  config: Record<string, unknown>
  secrets: Record<string, string>
  dataDir: string
  runtimeDir: string
  target: { type: AppTarget; id: string }
}

export interface AppActionContext extends AppBackendContext {
  signal: AbortSignal
  requestId: string
  emit(name: string, data?: unknown): void
  log(level: string, message: string, details?: unknown): void
}

export type AppActionHandler<Input = unknown, Output = unknown> =
  (input: Input, context: AppActionContext) => Output | Promise<Output>

export interface AppUiApi {
  app: {
    getInfo(): Promise<Record<string, unknown>>
    getVersions(): Promise<Array<Record<string, unknown>>>
    getInstallationState(): Promise<Record<string, unknown> | null>
  }
  instances: {
    list(): Promise<Array<Record<string, unknown>>>
    create(input?: Record<string, unknown>): Promise<Record<string, unknown>>
    update(instanceId: string, patch?: Record<string, unknown>): Promise<Record<string, unknown>>
    setEnabled(instanceId: string, enabled: boolean): Promise<unknown>
    clearCredentials(instanceId: string): Promise<Record<string, unknown>>
    remove(instanceId: string, options?: { deleteData?: boolean; deleteCredentials?: boolean }): Promise<{ ok: true }>
    getStatus(instanceId: string): Promise<Array<Record<string, unknown>>>
  }
  actions: {
    invoke<Output = unknown>(instanceId: string, name: string, input?: unknown, options?: { requestId?: string; timeoutMs?: number }): Promise<Output>
    cancel(instanceId: string, requestId: string): Promise<{ canceled: boolean }>
  }
  storage: {
    getItem<T = unknown>(key: string): Promise<T | undefined>
    setItem(key: string, value: unknown): Promise<{ ok: true; key: string }>
    removeItem(key: string): Promise<{ ok: true; key: string }>
    list(): Promise<string[]>
  }
  events: {
    on(eventName: string, callback: (payload: unknown) => void): () => void
  }
}

export class AppServiceError extends Error {
  code: string
  details?: unknown
  constructor(code: string, message: string, details?: unknown)
}

export class AppBackendClient {
  constructor(options?: Record<string, unknown>)
  registerAction(name: string, handler: AppActionHandler): this
  emit(name: string, data?: unknown): void
  log(level: string, message: string, details?: unknown): void
  status(state: string, details?: unknown): void
  start(actions?: Record<string, AppActionHandler>): this
  handleMessage(raw: unknown): Promise<void>
}

export const APP_SERVICE_PROTOCOL_VERSION: 1
export const APP_BACKEND_API_VERSION: 1
export const DEFAULT_MAX_MESSAGE_BYTES: number
export const APP_HOST_API_VERSION: string
export const APP_MANIFEST_SCHEMA: Record<string, unknown>
export const APP_ERROR_CODES: Readonly<Record<string, string>>
export const HOST_MESSAGE_TYPES: readonly string[]
export const BACKEND_MESSAGE_TYPES: readonly string[]

export function defineAppBackend(actions: Record<string, AppActionHandler>, options?: Record<string, unknown>): AppBackendClient
export function createEnvelope<T = unknown>(type: string, payload?: T, options?: { id?: string; timestamp?: number }): AppServiceEnvelope<T>
export function validateEnvelope<T = unknown>(raw: unknown, options?: { allowedTypes?: string[]; maxBytes?: number }): AppServiceEnvelope<T>
export function getEnvelopeByteLength(envelope: unknown): number
export function serializeError(error: unknown, fallbackCode?: string): { code: string; message: string; details?: unknown }
export function ensureSafeRelativePath(value: unknown, fieldName?: string): string
export function validateAppManifest(rawManifest: unknown, options?: { hostApiVersion?: string }): AppManifestV2
export function loadJsonSchema(packageRoot: string, relativePath: string, fieldName?: string): Record<string, unknown>
export function compileJsonSchema(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown[] }

export function createBackendTestHarness(actions?: Record<string, AppActionHandler>): {
  client: AppBackendClient
  received: AppServiceEnvelope[]
  host: unknown
  send(message: AppServiceEnvelope): void
}
