import { AppBackendClient, createAppCapabilitiesClient, createTasksClient, type AppTaskSummary } from '@moss/app-sdk'
import { createExecutionClient, validateExecutionHostInput, type AppExecutionSummary } from '@moss/app-sdk/execution'
import { createAppCapabilitiesClient as createCapabilitiesSubpath, type AppCapabilitiesClient, type AppCapabilitiesDiscoveryClient, type AppCapabilityProvider, type AppToolDescriptor } from '@moss/app-sdk/app-capabilities'
// @ts-expect-error The capability subpath must not claim to export the entire SDK.
import { AppBackendClient as InvalidCapabilityExport } from '@moss/app-sdk/app-capabilities'
// @ts-expect-error The execution subpath must not claim to export the entire SDK.
import { AppBackendClient as InvalidExport } from '@moss/app-sdk/execution'

const backend = new AppBackendClient()
const tasks = createTasksClient(backend.host)
const execution = createExecutionClient(backend.host)
const appCapabilities = createAppCapabilitiesClient(backend.host)
const subpathCapabilities: AppCapabilitiesClient = createCapabilitiesSubpath(backend.host)
const provider: AppCapabilityProvider = (await appCapabilities.list({ protocol: 'moss.dataset/v1' })).providers[0]
const dataset = await appCapabilities.invoke<{ columns: Array<{ name: string }> }>(provider.providerRef!, 'describe', { sourceId: 'source-1' })
const columnName: string = dataset.columns[0].name
const chunk: { text: string; nextOffset?: number | null } = await appCapabilities.read('resource-ref', 0, 100)
const tool: AppToolDescriptor = (await appCapabilities.listTools({ appId: 'moss.database' })).tools[0]
const toolResult: { content: Array<{ type: string; text?: string }> } = await appCapabilities.invokeTool(tool.toolRef, { sql: 'SELECT 1' })
const directlyTyped = await backend.host.request('moss.app-capabilities/v1', 'tools.list', { appId: 'moss.database' })
const toolName: string = directlyTyped.tools[0].name
// @ts-expect-error Tool discovery requires an explicit target App.
await backend.host.request('moss.app-capabilities/v1', 'tools.list', {})
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

import { createAppClient } from '@moss/app-sdk/ui'
import type { AppUiApi } from '@moss/app-sdk'
declare const bridge: AppUiApi
const ui = createAppClient(bridge)
const uiCapabilities = createCapabilitiesSubpath(ui.host)
const uiDiscovery: AppCapabilitiesDiscoveryClient = uiCapabilities
const uiProvider: AppCapabilityProvider = (await uiCapabilities.list({ protocol: 'moss.dataset/v1' })).providers[0]
const uiTool: AppToolDescriptor = (await uiCapabilities.listTools({ appId: 'moss.database' })).tools[0]
await uiCapabilities.invoke(uiProvider.providerRef!, 'describe', {})
await uiCapabilities.invokeTool(uiTool.toolRef, {})
await uiCapabilities.read('resource-ref', 0, 100)
const uiFullCapabilities: AppCapabilitiesClient = uiCapabilities
const runtimePath: string | null = (await ui.host.request('moss.runtimes/v1', 'python.get', {})).path
const capabilities = await backend.host.request('moss.host/v1', 'capabilities.get', {})
const allowed: boolean = capabilities.capabilities[0].allowed
await backend.host.subscribe('moss.tasks/v1', 'task.changed', data => { const id: string = data.task.id })
await ui.host.subscribe('moss.tasks/v1', 'task.changed', data => { const revision: number = data.task.revision })
// @ts-expect-error Known protocols cannot bypass method checking through the custom overload.
await ui.host.request('moss.tasks/v1', 'misspelled', {})
// @ts-expect-error Backend inputs come from the same contracts.
await backend.host.request('moss.local-files/v1', 'open', { path: 12 })
// @ts-expect-error UI event payloads are typed.
await ui.host.subscribe('moss.tasks/v1', 'task.changed', data => data.execution)
