import { AppBackendClient, createTasksClient, type AppTaskSummary } from '@moss/app-sdk'
import { createExecutionClient, validateExecutionHostInput, type AppExecutionSummary } from '@moss/app-sdk/execution'
// @ts-expect-error The execution subpath must not claim to export the entire SDK.
import { AppBackendClient as InvalidExport } from '@moss/app-sdk/execution'

const backend = new AppBackendClient()
const tasks = createTasksClient(backend.host)
const execution = createExecutionClient(backend.host)
const task: AppTaskSummary = await tasks.request('task.create', { idempotencyKey: 'run', title: 'Run' })
const started: AppExecutionSummary = await execution.request('execution.start', {
  scopeRef: task.scopeRef, idempotencyKey: 'step', contextKey: 'node', prompt: 'Hello', outputSchema: true,
}, { signal: new AbortController().signal })
const { executions }: { executions: AppExecutionSummary[] } = await execution.request('execution.list', { taskId: task.id })
const { nextOffset }: { nextOffset: number | null } = await execution.request('execution.result.read', { resultRef: started.id })
const unsubscribe: () => void = execution.on('execution.changed', (data, context) => {
  const summary: AppExecutionSummary = data.execution
  const sequence: number = data.event.sequence
  const signal: AbortSignal = context.signal
})
tasks.on('task.changed', data => { const summary: AppTaskSummary = data.task })
validateExecutionHostInput('moss.tasks/v1', 'task.get', { taskId: task.id })
validateExecutionHostInput('moss.tasks/v1', 'task.get', { taskId: task.id })
// @ts-expect-error A revision is required for optimistic concurrency.
await tasks.request('task.update', { taskId: task.id, progress: 0.5 })
// @ts-expect-error Task methods do not belong to the execution protocol.
await execution.request('task.get', { taskId: task.id })
// @ts-expect-error Only declared task events are supported.
tasks.on('execution.changed', () => {})
// @ts-expect-error Result offsets use integers represented as numbers.
await execution.request('execution.result.read', { resultRef: started.id, offset: '0' })

import '../src/account/index.mjs'
import '../src/agent/index.mjs'
import '../src/client/index.mjs'
import '../src/cloud-storage/index.mjs'
import '../src/host/index.mjs'
import '../src/platform/index.mjs'
import '../src/protocol/index.mjs'
import '../src/schemas/index.mjs'
import '../src/testing/index.mjs'
import '../src/ui/index.mjs'
import '../src/mcp/index.mjs'
