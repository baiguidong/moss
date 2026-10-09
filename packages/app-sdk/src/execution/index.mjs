export const MOSS_AGENT_EXECUTION_PROTOCOL = 'moss.agent-execution/v1'
export const MOSS_TASKS_PROTOCOL = 'moss.tasks/v1'

const METHODS = {
  [MOSS_AGENT_EXECUTION_PROTOCOL]: {
    capabilities: [[], 'execution:read'],
    'execution.start': [
      [
        'scopeRef',
        'idempotencyKey',
        'contextKey',
        'prompt',
        'outputSchema',
        'agentType',
        'resources',
        'timeoutMs',
      ],
      'execution:run',
    ],
    'execution.get': [['executionId'], 'execution:read'],
    'execution.list': [['taskId'], 'execution:read'],
    'execution.cancel': [['executionId', 'reason'], 'execution:cancel'],
    'execution.events': [
      ['executionId', 'afterSequence', 'limit'],
      'execution:read',
    ],
    'execution.result.read': [
      ['resultRef', 'offset', 'limit'],
      'execution:read',
    ],
  },
  [MOSS_TASKS_PROTOCOL]: {
    'task.create': [
      ['idempotencyKey', 'title', 'route', 'limits'],
      'tasks:write',
    ],
    'task.get': [['taskId'], 'tasks:read'],
    'task.list': [['offset', 'limit'], 'tasks:read'],
    'task.update': [
      ['taskId', 'revision', 'summary', 'progress'],
      'tasks:write',
    ],
    'task.finish': [
      ['taskId', 'revision', 'status', 'summary', 'result'],
      'tasks:write',
    ],
    'task.cancel': [['taskId', 'reason'], 'tasks:cancel'],
    'task.resume': [['taskId', 'revision'], 'tasks:write'],
  },
}
function text(input, field, max = 512) {
  if (
    typeof input[field] !== 'string' ||
    !input[field].trim() ||
    input[field].length > max ||
    input[field].includes('\0')
  )
    throw new Error('Invalid ' + field)
}
function object(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
export function validateExecutionInput(protocol, method, input) {
  const definition = METHODS[protocol]?.[method]
  if (!definition || !object(input))
    throw new Error('Unsupported execution request')
  for (const key of Object.keys(input))
    if (!definition[0].includes(key)) throw new Error('Unknown field: ' + key)
  for (const field of [
    'scopeRef',
    'idempotencyKey',
    'contextKey',
    'executionId',
    'taskId',
    'resultRef',
    'title',
  ]) {
    if (
      definition[0].includes(field) &&
      !(method === 'task.update' && field === 'title')
    )
      text(input, field)
  }
  if (method === 'execution.start') {
    text(input, 'prompt', 100_000)
    if (!object(input.outputSchema) && typeof input.outputSchema !== 'boolean')
      throw new Error('outputSchema is required')
  }
  for (const field of ['reason', 'summary', 'agentType', 'route'])
    if (input[field] !== undefined)
      text(input, field, field === 'summary' ? 20_000 : 1024)
  if (
    input.route !== undefined &&
    !/^#\/[a-zA-Z0-9/_?=&.%+-]*$/.test(input.route)
  )
    throw new Error('Expected an App-local route')
  for (const field of [
    'revision',
    'offset',
    'afterSequence',
    'limit',
    'timeoutMs',
  ]) {
    if (
      input[field] !== undefined &&
      (!Number.isSafeInteger(input[field]) ||
        input[field] < (['offset', 'afterSequence'].includes(field) ? 0 : 1))
    )
      throw new Error('Invalid ' + field)
  }
  if (
    ['task.update', 'task.finish', 'task.resume'].includes(method) &&
    input.revision === undefined
  )
    throw new Error('revision is required')
  if (
    method === 'task.finish' &&
    !['completed', 'failed'].includes(input.status)
  )
    throw new Error('Invalid task result status')
  if (
    input.progress !== undefined &&
    (typeof input.progress !== 'number' ||
      !Number.isFinite(input.progress) ||
      input.progress < 0 ||
      input.progress > 1)
  )
    throw new Error('Invalid progress')
  if (input.limits !== undefined) {
    if (!object(input.limits)) throw new Error('Invalid limits')
    for (const [key, value] of Object.entries(input.limits))
      if (
        !['maxConcurrency', 'maxCalls', 'maxDurationMs', 'maxTokens'].includes(
          key,
        ) ||
        !Number.isSafeInteger(value) ||
        value < 1
      )
        throw new Error('Invalid task limit: ' + key)
  }
  if (input.resources !== undefined) {
    if (
      !object(input.resources) ||
      Object.keys(input.resources).some((key) => key !== 'tools')
    )
      throw new Error('Only tool resource selection is supported')
    if (
      !Array.isArray(input.resources.tools) ||
      input.resources.tools.length > 512 ||
      input.resources.tools.some((item) => typeof item !== 'string' || !item)
    )
      throw new Error('Invalid tools')
  }
  if (input.result !== undefined && new TextEncoder().encode(JSON.stringify(input.result)).length > 32768) throw new Error('Task result exceeds 32 KiB; store it in the App and send a preview with a resource reference')
  return input
}
export function createExecutionProtocolDefinitions() {
  return Object.entries(METHODS).map(([protocol, methods]) => ({
    protocol,
    methods: Object.fromEntries(
      Object.entries(methods).map(([method, [, permission]]) => [
        method,
        {
          permission,
          validateInput: (input) =>
            validateExecutionInput(protocol, method, input),
        },
      ]),
    ),
    events:
      protocol === MOSS_TASKS_PROTOCOL
        ? { 'task.changed': { permission: 'tasks:read' } }
        : { 'execution.changed': { permission: 'execution:read' } },
  }))
}
