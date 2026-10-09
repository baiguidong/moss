import type { AgentHostRequestMap, AgentHostResultMap, AccountHostRequestMap, AccountHostResultMap } from '../index.mjs'
import type { HostInputMap, HostOutputMap, HostEventMap } from '../../../host-contracts/src/generated.mjs'
export interface HostInputs extends HostInputMap { 'moss.agent/v1': AgentHostRequestMap; 'moss.account/v1': AccountHostRequestMap }
export interface HostOutputs extends HostOutputMap { 'moss.agent/v1': AgentHostResultMap; 'moss.account/v1': AccountHostResultMap }
export interface AppRequestOptions { requestId?: string; timeoutMs?: number; signal?: AbortSignal }
export interface HostSubscriptionOptions { signal?: AbortSignal; onError?: (error: Error) => void }
export interface TypedHostRequests {
  request<P extends keyof HostInputs, M extends keyof HostInputs[P] & keyof HostOutputs[P]>(protocol: P, method: M, input: HostInputs[P][M], options?: AppRequestOptions): Promise<HostOutputs[P][M]>
  request<P extends string>(protocol: P extends keyof HostInputs ? never : P, method: string, input?: Record<string, unknown>, options?: AppRequestOptions): Promise<unknown>
}
export interface TypedHostSubscriptions<Context> {
  subscribe<P extends keyof HostEventMap, E extends keyof HostEventMap[P]>(protocol: P, name: E, listener: (data: HostEventMap[P][E], context: Context) => unknown, options?: HostSubscriptionOptions): Promise<() => void>
}
