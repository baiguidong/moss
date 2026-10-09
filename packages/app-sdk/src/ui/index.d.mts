import type { AppUiApi } from '../index.mjs'
import type { TypedHostRequests, TypedHostSubscriptions, AppRequestOptions } from '../host/types.mjs'
export type { AppRequestOptions, HostSubscriptionOptions } from '../host/types.mjs'
export interface BoundAppClient extends Omit<AppUiApi, 'actions' | 'host'> {
  actions: { invoke<Output = unknown>(name: string, input?: unknown, options?: AppRequestOptions): Promise<Output> }
  host: TypedHostRequests & TypedHostSubscriptions<{ eventId: string; protocol: string; name: string }>
  dispose(): void
}
export function createAppClient(bridge: AppUiApi): BoundAppClient
