import type { AppUiApi, AppBackendProtocol } from '../index.mjs'
export interface AppRequestOptions { requestId?: string; timeoutMs?: number; signal?: AbortSignal }
export interface BoundAppClient extends Omit<AppUiApi, 'actions' | 'host'> {
  actions: { invoke<Output = unknown>(name: string, input?: unknown, options?: AppRequestOptions): Promise<Output> }
  host: { request<Output = unknown>(protocol: AppBackendProtocol, method: string, input?: Record<string, unknown>, options?: AppRequestOptions): Promise<Output> }
  dispose(): void
}
export function createAppClient(bridge: AppUiApi): BoundAppClient
