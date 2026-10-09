import type { AppHostApi, HostEventContext } from '../index.mjs'

export const MOSS_AGENT_EXECUTION_PROTOCOL: 'moss.agent-execution/v1'
export const MOSS_TASKS_PROTOCOL: 'moss.tasks/v1'
export type ExecutionProtocol = typeof MOSS_AGENT_EXECUTION_PROTOCOL | typeof MOSS_TASKS_PROTOCOL
import type { TaskLimits, AppTaskSummary, AppExecutionSummary, AppExecutionEvent, ExecutionHostInputMap, ExecutionHostOutputMap, TasksHostInputMap, TasksHostOutputMap, TaskChangedEvent, ExecutionChangedEvent } from '../../../host-contracts/src/generated.mjs'
export type { TaskLimits, AppTaskSummary, AppExecutionSummary, AppExecutionEvent, ExecutionHostInputMap, ExecutionHostOutputMap, TasksHostInputMap, TasksHostOutputMap, TaskChangedEvent, ExecutionChangedEvent } from '../../../host-contracts/src/generated.mjs'
export type TaskStatus = AppTaskSummary['status']
export type ExecutionStatus = AppExecutionSummary['status']
export interface ExecutionRequestOptions { requestId?: string; timeoutMs?: number; signal?: AbortSignal }
export interface AppExecutionClient {
  request<Method extends keyof ExecutionHostInputMap>(method: Method, input: ExecutionHostInputMap[Method], options?: ExecutionRequestOptions): Promise<ExecutionHostOutputMap[Method]>
  on(name: 'execution.changed', handler: (data: ExecutionChangedEvent, context: HostEventContext) => unknown | Promise<unknown>): () => void
}
export interface AppTasksClient {
  request<Method extends keyof TasksHostInputMap>(method: Method, input: TasksHostInputMap[Method], options?: ExecutionRequestOptions): Promise<TasksHostOutputMap[Method]>
  on(name: 'task.changed', handler: (data: TaskChangedEvent, context: HostEventContext) => unknown | Promise<unknown>): () => void
}
export interface ExecutionProtocolDefinition {
  protocol: ExecutionProtocol
  methods: Record<string, {
    permission: string
    validateInput(input: unknown): Record<string, unknown>
    validateOutput(output: unknown): unknown
  }>
  events: Record<string, { permission: string; validateInput(data: unknown): unknown }>
}
export function validateExecutionHostInput(protocol: string, method: string, input: unknown): Record<string, unknown>
export function validateExecutionHostOutput(protocol: ExecutionProtocol, method: string, output: unknown): unknown
export function validateExecutionHostEvent(protocol: ExecutionProtocol, name: string, data: unknown): unknown
export function createExecutionProtocolDefinitions(): ExecutionProtocolDefinition[]
export function createExecutionClient(host: AppHostApi): AppExecutionClient
export function createTasksClient(host: AppHostApi): AppTasksClient

export const DEFAULT_EXECUTION_REFRESH_MS: number
export class ExecutionWatcher {
  constructor(client: AppExecutionClient, refreshMs?: number)
  wait(initial: AppExecutionSummary, signal: AbortSignal, onProgress: (state: AppExecutionSummary) => void): Promise<AppExecutionSummary>
  close(): void
}

export class TaskChangesWatcher {
  constructor(client: AppTasksClient, onTask: (task: AppTaskSummary) => unknown | Promise<unknown>, options?: { refreshMs?: number; onReset?: () => unknown | Promise<unknown>; onError?: (error: Error) => void })
  readonly ready: Promise<void>; refresh(): Promise<void>; close(): void
}
