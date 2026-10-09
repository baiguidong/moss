const string = { type: 'string', minLength: 1 }
const count = { type: 'integer', minimum: 0 }
const positive = { type: 'integer', minimum: 1 }
const record = (properties, required = Object.keys(properties)) => ({
  type: 'object', properties, required, additionalProperties: false,
})
const settled = ['completed', 'failed', 'cancelled', 'interrupted']
const limits = record({ maxConcurrency: positive, maxCalls: positive, maxDurationMs: positive, maxTokens: positive })
const task = record({
  id: string, appId: string, instanceId: string, title: string, route: string,
  status: { enum: ['running', ...settled] }, revision: positive, scopeRef: string, attempt: positive,
  limits, createdAt: positive, updatedAt: positive, deadlineAt: positive,
  sessionId: string, workspace: { type: 'string' }, executionCount: count, tokens: count,
  summary: { type: 'string' }, progress: { type: 'number', minimum: 0, maximum: 1 }, result: {}, error: { type: 'string' },
}, ['id', 'appId', 'instanceId', 'title', 'route', 'status', 'revision', 'scopeRef', 'attempt',
  'limits', 'createdAt', 'updatedAt', 'deadlineAt', 'sessionId', 'executionCount', 'tokens'])
const execution = record({
  id: string, key: string, taskId: string, contextKey: string, contextRef: string,
  status: { enum: ['queued', 'running', ...settled] }, sequence: count, tokens: count, toolCalls: count,
  createdAt: positive, attempt: positive, resultRef: string, error: { type: 'string' },
}, ['id', 'key', 'taskId', 'contextKey', 'contextRef', 'status', 'sequence', 'tokens', 'toolCalls', 'createdAt', 'attempt'])
const event = record({
  eventId: string, executionId: string, sequence: positive, timestamp: positive,
  type: { enum: ['queued', 'running', 'progress', ...settled] },
  tokens: count, toolCalls: count, lastToolName: { type: ['string', 'null'] }, error: { type: 'string' },
}, ['eventId', 'executionId', 'sequence', 'timestamp', 'type'])
export const executionOutputs = {
  capabilities: record({ environment: { const: 'local' }, structuredOutput: { type: 'boolean' },
    contextReuse: { type: 'boolean' }, maxConcurrency: positive, events: { type: 'boolean' } }),
  task,
  'task.list': record({ tasks: { type: 'array', items: task, maxItems: 10 } }),
  execution,
  'execution.list': record({ executions: { type: 'array', items: execution, maxItems: 256 } }),
  'execution.events': record({ events: { type: 'array', items: event, maxItems: 200 }, earliestSequence: count }),
  'execution.result.read': record({ text: { type: 'string', maxLength: 100_000 }, nextOffset: { anyOf: [count, { type: 'null' }] } }),
  'task.changed': record({ task }),
  'execution.changed': record({ taskId: string, execution, event }),
}

export const executionTypes = { TaskLimits: limits, AppTaskSummary: task, AppExecutionSummary: execution, AppExecutionEvent: event, TaskChangedEvent: executionOutputs['task.changed'], ExecutionChangedEvent: executionOutputs['execution.changed'] }

export const executionLimits = Object.freeze({ maxConcurrency: 16, maxCalls: 256, maxDurationMs: 1_800_000, maxTokens: 2_000_000, resultPreviewBytes: 32768, resultChunkUnits: 100_000, eventHistory: 2000 })
const text = (maxLength = 512) => ({ type: 'string', minLength: 1, maxLength, pattern: '^(?=[\\s\\S]*\\S)[^\\u0000]*$' })
const taskId = { taskId: text() }, executionId = { executionId: text() }
const partialLimits = record(Object.fromEntries(['maxConcurrency', 'maxCalls', 'maxDurationMs', 'maxTokens'].map(key => [key, { ...positive, maximum: executionLimits[key] }])), [])
const route = { ...text(1024), pattern: '^#/[a-zA-Z0-9/_?=&.%+-]*$' }
const summary = text(20_000), reason = text(1024)
const method = (permission, input, output, extra = {}) => ({ permission, input, output, surfaces: ['ui', 'backend'], errors: ['APP_PERMISSION_DENIED', 'APP_INVALID_ACTION_INPUT', 'APP_HOST_TIMEOUT', 'APP_ACTION_CANCELED', 'APP_CONFLICT', 'APP_NOT_FOUND', 'APP_RESOURCE_EXHAUSTED'], ...extra })

export const executionContracts = {
  'moss.tasks/v1': {
    types: 'Tasks',
    methods: {
      'task.create': method('tasks:write', record({ idempotencyKey: text(), title: text(), route, limits: partialLimits }, ['idempotencyKey', 'title']), task, { idempotency: 'key' }),
      'task.get': method('tasks:read', record(taskId), task),
      'task.list': method('tasks:read', record({ offset: count, limit: { ...positive, maximum: 10 } }, []), executionOutputs['task.list']),
      'task.update': method('tasks:write', record({ ...taskId, revision: positive, summary, progress: { type: 'number', minimum: 0, maximum: 1 } }, ['taskId', 'revision']), task),
      'task.finish': method('tasks:write', record({ ...taskId, revision: positive, status: { enum: ['completed', 'failed'] }, summary, result: {} }, ['taskId', 'revision', 'status']), task, { limits: { resultPreviewBytes: executionLimits.resultPreviewBytes } }),
      'task.cancel': method('tasks:cancel', record({ ...taskId, reason }, ['taskId']), task),
      'task.resume': method('tasks:write', record({ ...taskId, revision: positive }), task),
    },
    events: { 'task.changed': { permission: 'tasks:read', input: executionOutputs['task.changed'] } },
  },
  'moss.agent-execution/v1': {
    types: 'Execution',
    methods: {
      capabilities: method('execution:read', record({}), executionOutputs.capabilities),
      'execution.start': method('execution:run', record({ scopeRef: text(), idempotencyKey: text(), contextKey: text(), prompt: text(100_000), outputSchema: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'boolean' }] }, agentType: text(1024), resources: record({ tools: { type: 'array', maxItems: 512, items: text() } }), timeoutMs: { ...positive, maximum: executionLimits.maxDurationMs } }, ['scopeRef', 'idempotencyKey', 'contextKey', 'prompt', 'outputSchema']), execution, { idempotency: 'key' }),
      'execution.get': method('execution:read', record(executionId), execution),
      'execution.list': method('execution:read', record(taskId), executionOutputs['execution.list']),
      'execution.cancel': method('execution:cancel', record({ ...executionId, reason }, ['executionId']), execution),
      'execution.events': method('execution:read', record({ ...executionId, afterSequence: count, limit: { ...positive, maximum: 200 } }, ['executionId']), executionOutputs['execution.events'], { limits: { eventHistory: executionLimits.eventHistory } }),
      'execution.result.read': method('execution:read', record({ resultRef: text(), offset: count, limit: { ...positive, maximum: executionLimits.resultChunkUnits } }, ['resultRef']), executionOutputs['execution.result.read'], { limits: { chunkUnits: executionLimits.resultChunkUnits }, offsetUnit: 'utf16-code-unit' }),
    },
    events: { 'execution.changed': { permission: 'execution:read', input: executionOutputs['execution.changed'] } },
  },
}
